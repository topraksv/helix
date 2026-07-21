import { deterministicId, naturalKeys } from "../../db/ids";
import { readSetting, settingRow, writeRows, writeSetting, type RowWrite } from "../../db/mutations";
import { isMonthKey, monthKeyOf, todayISO, type MonthKey } from "../../domain/dates";
import { assertSupportedMinorAmount, type Minor } from "../../domain/money";
import { assertInputWithinLimit } from "../../domain/input";
import type { PaymentSourceType } from "../../domain/types";
import { isValidCardCycle } from "../../domain/card-statements";
import { CreditCardCycleRequiredError } from "./errors";
import { tr } from "../../i18n/tr";

// ---------------------------------------------------------------------------
// Onboarding seed
// ---------------------------------------------------------------------------

export interface TemplateCategory {
  name: string;
  kind: "expense" | "income";
  isColumn: boolean;
  isTransfer?: boolean;
  icon?: string;
}

/**
 * Starter category set offered on first run. Broad, everyday items that fit
 * most people (no assumptions like a mortgage or a car) — all fully editable
 * and deletable later. Extra, less-universal examples live in
 * `TEMPLATE_EXTRA_CATEGORIES` and are offered separately.
 */
export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  { name: tr.template.categoryNames.creditCard, kind: "expense", isColumn: true, icon: "💳" },
  { name: tr.template.categoryNames.bills, kind: "expense", isColumn: true, icon: "🧾" },
  { name: tr.template.categoryNames.groceries, kind: "expense", isColumn: true, icon: "🛒" },
  { name: tr.template.categoryNames.carFuel, kind: "expense", isColumn: true, icon: "⛽" },
  { name: tr.template.categoryNames.rent, kind: "expense", isColumn: true, icon: "🏠" },
  { name: tr.template.categoryNames.transport, kind: "expense", isColumn: true, icon: "🚌" },
  { name: tr.template.categoryNames.health, kind: "expense", isColumn: true, icon: "🩺" },
  { name: tr.template.categoryNames.entertainment, kind: "expense", isColumn: true, icon: "🎬" },
  { name: tr.template.categoryNames.extraExpenses, kind: "expense", isColumn: true, icon: "🧺" },
  { name: tr.template.categoryNames.salary, kind: "income", isColumn: true, icon: "💰" },
  { name: tr.template.categoryNames.extraIncome, kind: "income", isColumn: true, icon: "➕" },
];

/** Less-universal example columns, offered as optional extras (not default). */
export const TEMPLATE_EXTRA_CATEGORIES: TemplateCategory[] = [
  { name: tr.template.categoryNames.mortgage, kind: "expense", isColumn: true, icon: "🏦" },
  { name: tr.template.categoryNames.carLoan, kind: "expense", isColumn: true, icon: "🚗" },
  { name: tr.template.categoryNames.investment, kind: "expense", isColumn: true, isTransfer: true, icon: "📈" },
  { name: tr.template.categoryNames.subscriptions, kind: "expense", isColumn: true, icon: "🔁" },
  { name: tr.template.categoryNames.clothing, kind: "expense", isColumn: true, icon: "👕" },
  { name: tr.template.categoryNames.education, kind: "expense", isColumn: true, icon: "🎓" },
  { name: tr.template.categoryNames.rentalIncome, kind: "income", isColumn: true, icon: "🏘️" },
];

export interface SeedInput {
  /** Template categories to create; empty = start blank. */
  templateCategories: TemplateCategory[];
  startMonth: MonthKey;
  openingBalanceMinor: Minor;
  persons: { name: string; isSelf: boolean }[];
  sources: {
    name: string;
    type: PaymentSourceType;
    personIndex: number;
    dueDay?: number | null;
    statementDay?: number | null;
  }[];
}

/**
 * Seed (or re-seed) the onboarding workspace. Fully idempotent: every seeded
 * row gets a DETERMINISTIC id (self person, watch-only persons by slot, sources
 * by slot, template categories by name), so re-entering setup — after a reload,
 * or opening an importer then committing — upserts the same rows instead of
 * duplicating the whole workspace (the old `newId()` seed multiplied everything
 * on every re-run). The opening balance / start month are applied through the
 * earlier-wins rule so a re-seed on commit never clobbers an earlier ledger
 * anchor set by an Excel import.
 */
export async function seedWorkspace(userId: string, input: SeedInput): Promise<void> {
  if (input.persons.length === 0 || input.persons.filter((person) => person.isSelf).length !== 1) {
    throw new Error("Onboarding requires exactly one self person");
  }
  assertSupportedMinorAmount(input.openingBalanceMinor);
  input.persons.forEach((person) => assertInputWithinLimit(person.name, "text"));
  input.sources.forEach((source) => assertInputWithinLimit(source.name, "text"));
  const writes: RowWrite[] = [];
  const personIds = await Promise.all(
    input.persons.map((p, i) =>
      p.isSelf ? deterministicId(naturalKeys.selfPerson(userId)) : deterministicId(naturalKeys.onboardingPerson(userId, i)),
    ),
  );
  input.persons.forEach((p, i) => {
    writes.push({ table: "persons", row: { id: personIds[i], name: p.name, isSelf: p.isSelf, deletedAt: null } });
  });
  const sourceIds = await Promise.all(input.sources.map((_, i) => deterministicId(naturalKeys.onboardingSource(userId, i))));
  input.sources.forEach((s, i) => {
    const personId = personIds[s.personIndex];
    if (!personId) throw new Error("Onboarding payment source owner does not exist");
    if (
      s.type === "credit_card" &&
      !isValidCardCycle({ statementDay: s.statementDay, dueDay: s.dueDay })
    ) throw new CreditCardCycleRequiredError();
    writes.push({
      table: "payment_sources",
      row: {
        id: sourceIds[i],
        name: s.name,
        type: s.type,
        personId,
        dueDay: s.dueDay ?? null,
        statementDay: s.statementDay ?? null,
        color: null,
        logoSource: "initials",
        logoRef: null,
        isActive: true,
        deletedAt: null,
        sortOrder: i,
      },
    });
  });
  const categoryIds = await Promise.all(
    input.templateCategories.map((c) => deterministicId(naturalKeys.seedCategory(userId, c.name))),
  );
  input.templateCategories.forEach((c, i) => {
    writes.push({
      table: "categories",
      row: {
        id: categoryIds[i],
        name: c.name,
        kind: c.kind,
        icon: c.icon ?? null,
        color: null,
        sortOrder: i,
        isColumn: c.isColumn,
        isTransfer: c.kind === "expense" && c.isTransfer === true,
        deletedAt: null,
      },
    });
  });
  // The ledger anchor (start_month + opening_balance_minor) is ONE semantic
  // unit — `useLedgerState` consumes both together — so it joins the same
  // transaction as the seeded rows. Chaining separate writes let a failure
  // between them anchor the ledger at the new month with the PREVIOUS opening
  // balance, i.e. a wrong balance on every screen, with no error surfaced.
  writes.push(...(await onboardingBalanceRows(userId, input.startMonth, input.openingBalanceMinor)));
  await writeRows(userId, writes);
  // NB: does NOT mark onboarded — the setup screen seeds first (so history can
  // be imported into a real workspace) and calls finalizeOnboarding() only when
  // the user taps "save & start". See setup.tsx.
}

/**
 * Write the onboarding opening balance + start month, but never overwrite an
 * EARLIER anchor already set (e.g. by an Excel import that seeded the ledger
 * from an earlier year). The ledger back-anchors to the earliest data, so the
 * earliest start wins; for the same-or-later month the form value is authoritative.
 */
async function onboardingBalanceRows(
  userId: string,
  startMonth: MonthKey,
  openingBalanceMinor: Minor,
): Promise<RowWrite[]> {
  if (!isMonthKey(startMonth) || startMonth > monthKeyOf(todayISO())) {
    throw new Error("Invalid opening balance month");
  }
  assertSupportedMinorAmount(openingBalanceMinor);
  const currentStart = await readSetting<string>(userId, "start_month");
  if (currentStart && startMonth > currentStart) return []; // keep the earlier imported anchor
  return [
    await settingRow(userId, "start_month", startMonth),
    await settingRow(userId, "opening_balance_minor", openingBalanceMinor),
  ];
}

export async function applyOnboardingBalance(userId: string, startMonth: MonthKey, openingBalanceMinor: Minor): Promise<void> {
  const rows = await onboardingBalanceRows(userId, startMonth, openingBalanceMinor);
  if (rows.length > 0) await writeRows(userId, rows);
}

/** Replace the historical ledger anchor as one validated atomic write. */
export async function setOpeningBalance(userId: string, startMonth: MonthKey, openingBalanceMinor: Minor): Promise<void> {
  if (!isMonthKey(startMonth) || startMonth > monthKeyOf(todayISO())) {
    throw new Error("Invalid opening balance month");
  }
  assertSupportedMinorAmount(openingBalanceMinor);
  await writeRows(userId, [
    await settingRow(userId, "start_month", startMonth),
    await settingRow(userId, "opening_balance_minor", openingBalanceMinor),
  ]);
}

/** Mark onboarding complete → the route guard lets the user into the app. */
export async function finalizeOnboarding(userId: string): Promise<void> {
  await writeSetting(userId, "onboarded", true);
}
