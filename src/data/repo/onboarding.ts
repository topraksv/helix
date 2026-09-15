import { deterministicId, naturalKeys } from "../../db/ids";
import { getSqliteAsync } from "../../db/client";
import { fromDbShape, nowIso, readSetting, settingRow, writeRows, writeSetting, type RowWrite } from "../../db/mutations";
import { addMonthsToKey, isMonthKey, lastDayOf, monthKeyOf, todayISO, type ISODate, type MonthKey } from "../../domain/dates";
import { assertSupportedMinorAmount, type Minor } from "../../domain/money";
import { assertInputWithinLimit } from "../../domain/input";
import type { CategoryKind, PaymentSourceType, TransactionType } from "../../domain/types";
import { signedBalanceEffectOf } from "../../domain/transactions";
import { isValidCardCycle } from "../../domain/card-statements";
import { CreditCardCycleRequiredError } from "./errors";
import { monthOpeningDeclarationWrite } from "./transactions";
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

function tombstoneRemovedRows(
  table: "persons" | "payment_sources" | "categories",
  liveRows: Record<string, unknown>[],
  candidateIds: ReadonlySet<string>,
  desiredIds: ReadonlySet<string>,
): RowWrite[] {
  return liveRows
    .filter((row) => typeof row.id === "string" && candidateIds.has(row.id) && !desiredIds.has(row.id))
    .map((row) => ({
      table,
      row: { ...fromDbShape(table, row), deletedAt: nowIso() },
    }));
}

/**
 * Re-seeding is also the commit step after an importer. Rows removed from the
 * draft must therefore be tombstoned in the same write as the rows that remain;
 * otherwise a cancelled source/person/template silently survives onboarding.
 */
async function removedSeedRows(
  userId: string,
  table: "persons" | "payment_sources" | "categories",
  candidateKeys: string[],
  desiredIds: ReadonlySet<string>,
): Promise<RowWrite[]> {
  if (candidateKeys.length === 0) return [];
  const sqlite = await getSqliteAsync();
  const liveRows = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE user_id = ? AND deleted_at IS NULL`,
    [userId],
  );
  const candidateIds = new Set(await Promise.all(candidateKeys.map((key) => deterministicId(key))));
  return tombstoneRemovedRows(table, liveRows, candidateIds, desiredIds);
}

async function removedOnboardingSlotRows(
  userId: string,
  table: "persons" | "payment_sources",
  naturalKey: (index: number) => string,
  desiredIds: ReadonlySet<string>,
  firstIndex: number,
  minimumSlots: number,
): Promise<RowWrite[]> {
  const sqlite = await getSqliteAsync();
  const liveRows = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE user_id = ? AND deleted_at IS NULL`,
    [userId],
  );
  const slotCount = Math.max(minimumSlots, liveRows.length + 1);
  const candidateIds = new Set(
    await Promise.all(
      Array.from({ length: slotCount }, (_, offset) => deterministicId(naturalKey(firstIndex + offset))),
    ),
  );
  return tombstoneRemovedRows(table, liveRows, candidateIds, desiredIds);
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
  const [removedPersons, removedSources, removedCategories] = await Promise.all([
    removedOnboardingSlotRows(
      userId,
      "persons",
      (index) => naturalKeys.onboardingPerson(userId, index),
      new Set(personIds),
      1,
      input.persons.length,
    ),
    removedOnboardingSlotRows(
      userId,
      "payment_sources",
      (index) => naturalKeys.onboardingSource(userId, index),
      new Set(sourceIds),
      0,
      input.sources.length,
    ),
    removedSeedRows(
      userId,
      "categories",
      [...TEMPLATE_CATEGORIES, ...TEMPLATE_EXTRA_CATEGORIES].map((category) => naturalKeys.seedCategory(userId, category.name)),
      new Set(categoryIds),
    ),
  ]);
  writes.push(...removedPersons, ...removedSources, ...removedCategories);
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
 * Write the onboarding opening balance + start month, but never move an
 * EARLIER anchor already set (e.g. by an Excel import that seeded the ledger
 * from an earlier year); for the same-or-later month the form value is authoritative.
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
  const currentStart = await readSetting<MonthKey>(userId, "start_month");
  if (!currentStart || startMonth <= currentStart) {
    return [
      await settingRow(userId, "start_month", startMonth),
      await settingRow(userId, "opening_balance_minor", openingBalanceMinor),
    ];
  }
  // An import already reached back past this month and kept the figure typed
  // here as the month's declared opening (spec §3.1e), so coming back to change
  // it restates that declaration. A zero is the form's empty optional field.
  if (openingBalanceMinor === 0) return [];
  const date = lastDayOf(addMonthsToKey(startMonth, -1));
  const differenceMinor = openingBalanceMinor - (await balanceBeforeDeclaring(userId, currentStart, date, startMonth));
  return [await monthOpeningDeclarationWrite(userId, startMonth, openingBalanceMinor, differenceMinor, tr.importer.openingKept)];
}

/**
 * The balance at the end of `date` as a client older than declarations reads
 * it, which sees a declaration only as the difference stored with it: the
 * anchor's opening plus every counted row and adjustment from the anchor's
 * month on, the declaration about to be written excepted.
 */
async function balanceBeforeDeclaring(userId: string, anchorMonth: MonthKey, date: ISODate, declaredMonth: MonthKey): Promise<Minor> {
  const sqlite = await getSqliteAsync();
  const from = `${anchorMonth}-01`;
  const rows = await sqlite.getAllAsync<{ type: TransactionType; amount_try_minor: number; category_kind: CategoryKind | null }>(
    `SELECT t.type, t.amount_try_minor, c.kind AS category_kind FROM transactions t
     JOIN persons p ON p.id = t.person_id AND p.user_id = t.user_id AND p.is_self = 1
     LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
     WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.status = 'realized' AND t.effective_date BETWEEN ? AND ?`,
    [userId, from, date],
  );
  const adjusted = await sqlite.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(amount_minor) AS total FROM balance_adjustments
     WHERE user_id = ? AND deleted_at IS NULL AND id != ? AND date BETWEEN ? AND ?`,
    [userId, await deterministicId(naturalKeys.monthOpeningDeclaration(userId, declaredMonth)), from, date],
  );
  const opening = (await readSetting<Minor>(userId, "opening_balance_minor")) ?? 0;
  return rows.reduce((sum, row) => sum + signedBalanceEffectOf(row.type, row.amount_try_minor, row.category_kind), opening)
    + Number(adjusted?.total ?? 0);
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
