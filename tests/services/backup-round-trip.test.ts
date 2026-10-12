// A backup must restore into the same account and into a different one, over a real database.
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null, nextId: 0 }));

// `reset.ts` records a tidy-up it could not finish, and the recorder reaches
// the device store. Stubbed like the rate services beside it.
vi.mock("../../src/services/logger", () => ({ devWarning: vi.fn(), devError: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-file-system", () => ({ File: class {}, Paths: { cache: "/tmp" } }));
vi.mock("../../src/db/client", async () => {
  const { sqliteClientMock } = await import("../helpers");
  return sqliteClientMock(() => harness.db!);
});
// Ids have to be REAL uuids here: the backup validator rejects any id or
// `*_id` column that is not one, so a `row-0001` style stub would fail the
// import for reasons the product never has.
vi.mock("../../src/db/ids", () => ({
  newId: () => `00000000-0000-4000-8000-${String(++harness.nextId).padStart(12, "0")}`,
  deterministicId: async (naturalKey: string) => {
    const hex = createHash("sha256").update(naturalKey).digest("hex");
    const nibbles = hex.slice(0, 32).split("");
    nibbles[12] = "8";
    nibbles[16] = "8";
    const s = nibbles.join("");
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
  },
  naturalKeys: new Proxy({}, {
    get: (_target, property) => (...parts: unknown[]) => `${String(property)}|${parts.join("|")}`,
  }),
}));
vi.mock("../../src/services/fx-fetch", () => ({ lookupRate: vi.fn() }));
vi.mock("../../src/services/markets", () => ({ marketSellRateTry: vi.fn() }));
vi.mock("../../src/sync/engine", () => ({ scheduleSync: vi.fn(), syncNow: vi.fn(async () => false) }));

import {
  addTransaction,
  createCategory,
  createInstallmentPlan,
  createPerson,
  importSheets,
  saveComputedColumn,
  seedWorkspace,
  upsertCategoryBudget,
  upsertPaymentSource,
  upsertSubscription,
} from "../../src/data/repo";
import { saveCellNote } from "../../src/data/repo/cell-notes";
import { setMatrixColor } from "../../src/data/repo/matrix-colors";
import { deterministicId, naturalKeys } from "../../src/db/ids";
import { resetLocalWorkspace, writeSetting } from "../../src/db/mutations";
import { buildIdRemap, isDeterministicId } from "../../src/services/backup-remap";
import { buildExportText, buildWorkbookBytes, importBundle } from "../../src/services/export-import";
import { parseExportBundleText } from "../../src/services/backup-validation";
import { parseWorkbookBytes } from "../../src/services/spreadsheet-import";
import { migrationStatements } from "../helpers";

// Accounts are uuids in the product; the validator enforces that too.
const SOURCE_USER = "11111111-1111-4111-8111-111111111111";
const TARGET_USER = "22222222-2222-4222-8222-222222222222";

function counts(userId: string) {
  return {
    persons: countFor("persons", userId),
    categories: countFor("categories", userId),
    transactions: countFor("transactions", userId),
    category_budgets: countFor("category_budgets", userId),
    cell_notes: countFor("cell_notes", userId),
    matrix_colors: countFor("matrix_colors", userId),
    subscriptions: countFor("subscriptions", userId),
  };
}

function countFor(table: string, userId: string): number {
  const row = harness.db!.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(userId) as { n: number };
  return Number(row.n);
}

async function seedSourceAccount(): Promise<void> {
  const personId = await createPerson(SOURCE_USER, "Ben");
  const expenseId = await createCategory(SOURCE_USER, { name: "Market", kind: "expense", isTransfer: false, sortOrder: 0 });
  await createCategory(SOURCE_USER, { name: "Maaş", kind: "income", isTransfer: false, sortOrder: 1 });
  await addTransaction(SOURCE_USER, {
    type: "expense", amountMinor: 500_00, currency: "TRY", fxRate: null, amountTryMinor: 500_00,
    categoryId: expenseId, personId, paymentSourceId: null, effectiveDate: "2026-07-10" as never, note: "market",
  });
  await upsertCategoryBudget(SOURCE_USER, { month: "2026-07" as never, categoryId: expenseId, amountMinor: 2_000_00 });
  await saveCellNote(SOURCE_USER, "2026-07" as never, expenseId, "temmuz notu");
  // All three colour scopes, because each nulls a different column: a row mark has no month,
  // a column mark has no `item_key`, which `remapRow` must rewrite by name.
  await setMatrixColor(SOURCE_USER, { scope: "row", itemKey: expenseId, month: null }, "red");
  await setMatrixColor(SOURCE_USER, { scope: "column", itemKey: null, month: "2026-07" as never }, "green");
  await setMatrixColor(SOURCE_USER, { scope: "cell", itemKey: expenseId, month: "2026-07" as never }, "orange");
  // A variable-amount subscription, which a backup written before it existed would lack.
  await upsertSubscription(SOURCE_USER, {
    name: "Elektrik", amountMinor: 0, amountMode: "variable", currency: "TRY", cycle: "monthly",
    intervalMonths: 1, billingDay: 15, nextDueDate: "2026-08-15" as never, paymentSourceId: null,
    categoryId: expenseId, personId, isActive: true, trialEndDate: null, autoPay: false,
    websiteDomain: null, note: null,
  });
}

describe("backup round trip", () => {
  beforeEach(() => {
    harness.db?.close();
    harness.nextId = 0;
    harness.db = new DatabaseSync(":memory:");
    for (const statement of migrationStatements) harness.db.exec(statement);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:00.000Z"));
  });
  afterAll(() => { harness.db?.close(); vi.useRealTimers(); });

  it("restores its own account's backup, including a variable bill with no estimate", async () => {
    await seedSourceAccount();
    const before = counts(SOURCE_USER);
    expect(before.subscriptions).toBe(1);
    expect(before.matrix_colors, "the seed must carry one mark of every scope").toBe(3);

    // A zero-amount variable subscription must not make the account's own backup unreadable.
    const bundle = parseExportBundleText(await buildExportText(SOURCE_USER));
    await expect(importBundle(SOURCE_USER, bundle)).resolves.toBeTruthy();

    for (const [table, expected] of Object.entries(before)) {
      expect(countFor(table, SOURCE_USER), `${table} is intact after restore`).toBe(expected);
    }
    const restored = harness.db!.prepare(
      `SELECT amount_mode, amount_minor FROM subscriptions WHERE user_id = ?`,
    ).get(SOURCE_USER) as { amount_mode: string; amount_minor: number };
    expect(restored.amount_mode, "amount_mode survives export/import").toBe("variable");
    expect(restored.amount_minor).toBe(0);
  });

  it("does not record a price-history point for a bill with no estimate", async () => {
    await seedSourceAccount();
    // 0 is "not known yet", not "it was free" — and a 0 price row is exactly
    // what the backup validator rejects.
    expect(countFor("price_history", SOURCE_USER)).toBe(0);
  });

  it("computes an empty remap when source and target account are the same (regression guard)", async () => {
    // The safety property the cross-account remap depends on: same account in
    // and out means every candidate's source-hash and target-hash are built
    // from IDENTICAL inputs, so no row is ever a source of a map entry. This
    // is what guarantees a same-account restore cannot regress — proven by
    // actually running the algorithm, not by special-casing it away.
    await seedSourceAccount();
    const bundle = parseExportBundleText(await buildExportText(SOURCE_USER));
    const idMap = await buildIdRemap(bundle, SOURCE_USER, SOURCE_USER);
    expect(idMap.size).toBe(0);
  });

  it("names only the tables that hold rows, so an older build refuses only what it would lose", async () => {
    // An older build's validator refuses a whole file for one table name it does not know, so
    // an empty table must be absent: restore merges what is present.
    await seedSourceAccount();
    const bundle = parseExportBundleText(await buildExportText(SOURCE_USER));

    const named = Object.keys(bundle.tables);
    expect(named.length, "the seed must reach more than one table").toBeGreaterThan(1);
    expect(named.filter((table) => bundle.tables[table as keyof typeof bundle.tables]!.length === 0)).toEqual([]);
    expect(named).not.toContain("card_statement_payments");
    await expect(importBundle(SOURCE_USER, bundle)).resolves.toBeTruthy();
  });

  it("maps every deterministic id produced by the real export path", async () => {
    await seedSourceAccount();
    const bundle = parseExportBundleText(await buildExportText(SOURCE_USER));
    const idMap = await buildIdRemap(bundle, SOURCE_USER, TARGET_USER);
    const deterministicRows = Object.entries(bundle.tables).flatMap(([table, rows]) =>
      rows.filter((row) => isDeterministicId(row.id)).map((row) => ({ table, id: String(row.id) })),
    );

    expect(deterministicRows.length, "the real seed must exercise at least one deterministic row").toBeGreaterThan(0);
    expect(
      deterministicRows.filter(({ id }) => !idMap.has(id)),
      "a deterministic id from the real repository/export path has no resolver",
    ).toEqual([]);
  });

  it("restores another account's backup, re-deriving deterministic ids and staying idempotent on retry", async () => {
    await seedSourceAccount();
    const before = counts(SOURCE_USER);
    const sourceRowMark = harness.db!.prepare(
      `SELECT id, item_key FROM matrix_colors WHERE user_id = ? AND scope = 'row'`,
    ).get(SOURCE_USER) as { id: string; item_key: string };
    const sourceBudgetId = (harness.db!.prepare(
      `SELECT id FROM category_budgets WHERE user_id = ?`,
    ).get(SOURCE_USER) as { id: string }).id;
    const sourceNoteId = (harness.db!.prepare(
      `SELECT id FROM cell_notes WHERE user_id = ?`,
    ).get(SOURCE_USER) as { id: string }).id;
    // A plain uuidv7 row carries no account identity and must survive the remap byte-for-byte.
    const sourceTxId = (harness.db!.prepare(
      `SELECT id FROM transactions WHERE user_id = ?`,
    ).get(SOURCE_USER) as { id: string }).id;

    const bundle = parseExportBundleText(await buildExportText(SOURCE_USER));
    // The app wipes local SQLite on an account switch; otherwise account A's plain uuidv7 ids
    // would still be A's own rows and the write layer's ownership guard would refuse B's restore.
    await resetLocalWorkspace();
    const result = await importBundle(TARGET_USER, bundle);
    expect(result.imported).toBeGreaterThan(0);

    for (const [table, expected] of Object.entries(before)) {
      expect(countFor(table, TARGET_USER), `${table} fully landed under the target account`).toBe(expected);
    }

    const targetBudget = harness.db!.prepare(
      `SELECT id, category_id FROM category_budgets WHERE user_id = ?`,
    ).get(TARGET_USER) as { id: string; category_id: string };
    const targetNote = harness.db!.prepare(
      `SELECT id, category_id FROM cell_notes WHERE user_id = ?`,
    ).get(TARGET_USER) as { id: string; category_id: string };
    const targetCategory = harness.db!.prepare(
      `SELECT id FROM categories WHERE user_id = ? AND name = 'Market'`,
    ).get(TARGET_USER) as { id: string };
    const targetTx = harness.db!.prepare(
      `SELECT id FROM transactions WHERE user_id = ? AND id = ?`,
    ).get(TARGET_USER, sourceTxId) as { id: string } | undefined;

    // Deterministic ids that embed the account id are re-derived, not copied.
    expect(targetBudget.id, "budget id no longer carries account A's derived id").not.toBe(sourceBudgetId);
    expect(targetNote.id, "cell note id no longer carries account A's derived id").not.toBe(sourceNoteId);
    // Their foreign key still resolves against the (unremapped, plain-uuid) category row.
    expect(targetBudget.category_id).toBe(targetCategory.id);
    expect(targetNote.category_id).toBe(targetCategory.id);
    // A uuidv7 id is untouched by the remap.
    expect(targetTx?.id, "a uuidv7 transaction id is untouched by the remap").toBe(sourceTxId);

    // Every scope survives with its own nulls intact. The category id here is a plain uuid, so
    // the `item_key` rewrite is proven by the test below, whose category id is account-derived.
    const targetRowMark = harness.db!.prepare(
      `SELECT id, item_key, month, token FROM matrix_colors WHERE user_id = ? AND scope = 'row'`,
    ).get(TARGET_USER) as { id: string; item_key: string; month: string | null; token: string };
    expect(targetRowMark.item_key, "the mark still names the same plain-uuid category").toBe(targetCategory.id);
    expect(targetRowMark.id, "the mark's own derived id is recomputed for the new account").not.toBe(sourceRowMark.id);
    expect(targetRowMark.month, "a row mark still has no month after a restore").toBeNull();
    expect(targetRowMark.token).toBe("red");
    const targetColumnMark = harness.db!.prepare(
      `SELECT item_key, month FROM matrix_colors WHERE user_id = ? AND scope = 'column'`,
    ).get(TARGET_USER) as { item_key: string | null; month: string };
    expect(targetColumnMark.item_key, "a column mark still has no item after a restore").toBeNull();
    expect(targetColumnMark.month).toBe("2026-07");

    // The remap is a pure function of (bundle, source, target), so a repeat converges.
    const second = await importBundle(TARGET_USER, bundle);
    expect(second.imported).toBe(0);
    for (const [table, expected] of Object.entries(before)) {
      expect(countFor(table, TARGET_USER), `${table} did not duplicate on a repeat import`).toBe(expected);
    }
  });

  it("remaps ids embedded inside computed_columns.definition and settings.column_years", async () => {
    const categoryName = "Bütçe Sütunu";
    await seedWorkspace(SOURCE_USER, {
      templateCategories: [{ name: categoryName, kind: "expense", isColumn: true }],
      startMonth: "2026-07" as never,
      openingBalanceMinor: 0,
      persons: [{ name: "Ben", isSelf: true }],
      sources: [],
    });
    const sourceCategoryId = (harness.db!.prepare(
      `SELECT id FROM categories WHERE user_id = ? AND name = ?`,
    ).get(SOURCE_USER, categoryName) as { id: string }).id;

    await saveComputedColumn(SOURCE_USER, {
      name: "Toplam",
      definition: { op: "sum", categoryIds: [sourceCategoryId] },
      sortOrder: 0,
    });
    await writeSetting(SOURCE_USER, "column_years", { "2026": [sourceCategoryId] });
    // `item_key` is the third place an id hides from the generic `*_id` rule; the rewrite is
    // only observable because this category is re-derived under the target account.
    await setMatrixColor(SOURCE_USER, { scope: "row", itemKey: sourceCategoryId, month: null }, "red");

    const bundle = parseExportBundleText(await buildExportText(SOURCE_USER));
    // As above: the account-switch wipe.
    await resetLocalWorkspace();
    await importBundle(TARGET_USER, bundle);

    // Computed independently, not read off the target DB, so the remap is proven to recompute
    // the embedded reference rather than copy whatever landed.
    const targetCategoryId = await deterministicId(naturalKeys.seedCategory(TARGET_USER, categoryName));
    expect(targetCategoryId).not.toBe(sourceCategoryId);

    const definitionRow = harness.db!.prepare(
      `SELECT definition FROM computed_columns WHERE user_id = ? AND name = 'Toplam'`,
    ).get(TARGET_USER) as { definition: string };
    expect(JSON.parse(definitionRow.definition)).toEqual({ op: "sum", categoryIds: [targetCategoryId] });

    const settingsRow = harness.db!.prepare(
      `SELECT value FROM settings WHERE user_id = ? AND key = 'column_years'`,
    ).get(TARGET_USER) as { value: string };
    expect(JSON.parse(settingsRow.value)).toEqual({ "2026": [targetCategoryId] });

    const markRow = harness.db!.prepare(
      `SELECT item_key FROM matrix_colors WHERE user_id = ? AND scope = 'row'`,
    ).get(TARGET_USER) as { item_key: string };
    expect(markRow.item_key, "the colour follows the category instead of pointing at account A's").toBe(targetCategoryId);
  });

  it("accepts a backup written before the variable-amount columns existed", async () => {
    const personId = await createPerson(SOURCE_USER, "Ben");
    const categoryId = await createCategory(SOURCE_USER, { name: "Market", kind: "expense", isTransfer: false, sortOrder: 0 });
    await upsertSubscription(SOURCE_USER, {
      name: "Netflix", amountMinor: 149_00, currency: "TRY", cycle: "monthly", intervalMonths: 1,
      billingDay: 5, nextDueDate: "2026-09-05" as never, paymentSourceId: null, categoryId, personId,
      isActive: true, trialEndDate: null, autoPay: false, websiteDomain: null, note: null,
    });
    const bundle = parseExportBundleText(await buildExportText(SOURCE_USER));
    // A file exported by an older build simply has no such columns.
    for (const row of bundle.tables.subscriptions ?? []) delete (row as Record<string, unknown>).amount_mode;
    for (const row of bundle.tables.expected_payments ?? []) delete (row as Record<string, unknown>).amount_is_estimated;

    await expect(importBundle(SOURCE_USER, bundle)).resolves.toBeTruthy();
    const restored = harness.db!.prepare(
      `SELECT amount_mode FROM subscriptions WHERE user_id = ?`,
    ).get(SOURCE_USER) as { amount_mode: string };
    expect(restored.amount_mode, "an older backup restores as a fixed subscription").toBe("fixed");
  });

  // The investment wallet is replayed as a whole, so a bundle that does not add up has no single row to blame; the refusal names the section.
  it("says which section a replay-level refusal came from", async () => {
    await createPerson(SOURCE_USER, "Ben");
    const bundle = parseExportBundleText(await buildExportText(SOURCE_USER));
    const now = "2026-08-01T00:00:00.000Z";
    const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
    const row = (extra: Record<string, unknown>) => ({
      user_id: SOURCE_USER, created_at: now, updated_at: now, deleted_at: null, tombstone_version: 0, ...extra,
    });
    // `setup_completed` is deliberately still here: older backups carry a column the schema
    // dropped, and `toDbShape` walks the schema's columns so it never reaches the INSERT.
    bundle.tables.investment_profiles = [row({
      id: id(901), started_on: "2026-01-01", opening_cash_minor: 1_000_00, setup_completed: 1,
    })];
    bundle.tables.investment_products = [row({
      id: id(902), asset_type: "metal", name: "Gram Altın", market_code: null, note: null, target_weight_bp: null,
    })];
    // Buying ₺500.000 of gold out of a ₺1.000 wallet: every row is individually
    // well formed, and the whole is not.
    bundle.tables.investment_operations = [row({
      id: id(903), product_id: id(902), kind: "buy", operation_date: "2026-02-01",
      quantity: "100", unit_price_minor: 5_000_00, total_minor: 500_000_00,
      cost_basis_minor: 0, realized_profit_loss_minor: 0, note: null, import_key: null,
    })];

    await expect(importBundle(SOURCE_USER, bundle)).rejects.toThrow(/Yatırım hareketleri/);
    await expect(importBundle(SOURCE_USER, bundle)).rejects.toThrow(/tutarsız/);
  });

  describe("workbook export", () => {
    const spend = (userId: string, personId: string, categoryId: string, amountMinor: number, effectiveDate: string) => addTransaction(userId, {
      type: "expense", amountMinor, currency: "TRY", fxRate: null, amountTryMinor: amountMinor,
      categoryId, personId, paymentSourceId: null, effectiveDate: effectiveDate as never, note: null,
    });
    /** The owner's movement per month, the figure Mali Tablo's cells add up to. */
    const ownMonths = (userId: string) => harness.db!.prepare(
      `SELECT substr(t.effective_date, 1, 7) AS month, SUM(t.amount_try_minor) AS total
       FROM transactions t JOIN persons p ON p.id = t.person_id
       WHERE t.user_id = ? AND t.deleted_at IS NULL AND p.is_self = 1 GROUP BY month ORDER BY month`,
    ).all(userId);

    it("writes a cell as Mali Tablo totals it: a refund takes off, a watched person's spending stays out", async () => {
      const self = await createPerson(SOURCE_USER, "Ben");
      const watched = await createPerson(SOURCE_USER, "Ayşe");
      const market = await createCategory(SOURCE_USER, { name: "Market", kind: "expense", isTransfer: false, sortOrder: 0 });
      await spend(SOURCE_USER, self, market, 1_000_00, "2026-07-10");
      await spend(SOURCE_USER, self, market, -100_00, "2026-07-12");
      await spend(SOURCE_USER, watched, market, 400_00, "2026-07-14");

      const [sheet] = (await parseWorkbookBytes(await buildWorkbookBytes(SOURCE_USER))).sheets;
      const column = sheet!.columns.findIndex((entry) => entry.label === "Market");
      expect(sheet!.cells[0]![column]!.valueMinor).toBe(900_00);
    });

    it("brings a card plan back as the same plan", async () => {
      const self = await createPerson(SOURCE_USER, "Ben");
      const phone = await createCategory(SOURCE_USER, { name: "Elektronik", kind: "expense", isTransfer: false, sortOrder: 0 });
      const market = await createCategory(SOURCE_USER, { name: "Market", kind: "expense", isTransfer: false, sortOrder: 1 });
      const card = await upsertPaymentSource(SOURCE_USER, { name: "Bonus", type: "credit_card", personId: self, statementDay: 20, dueDay: 5 });
      await createInstallmentPlan(SOURCE_USER, {
        title: "Telefon", kind: "card_installment", totalAmountMinor: 1_000_00, monthlyAmountMinor: null, installmentCount: 3,
        currency: "TRY", fxRate: null, startMonth: "2026-07" as never, dueDay: 5, paymentSourceId: card, personId: self,
        personIsSelf: true, categoryId: phone, note: null, tryFactor: 1,
      });
      await spend(SOURCE_USER, self, market, 250_00, "2026-08-10");

      const parsed = await parseWorkbookBytes(await buildWorkbookBytes(SOURCE_USER));
      const target = await createPerson(TARGET_USER, "Ben");
      await importSheets(TARGET_USER, {
        sheets: parsed.sheets, excludedLabels: [], selfId: target, mode: "replace", cardCycles: { Bonus: { statementDay: 20, dueDay: 5 } },
      });

      expect(harness.db!.prepare(
        `SELECT title, installment_count, start_month, monthly_amount_minor FROM installment_plans WHERE user_id = ? AND deleted_at IS NULL`,
      ).all(TARGET_USER)).toEqual([{ title: "Telefon", installment_count: 3, start_month: "2026-07", monthly_amount_minor: 333_33 }]);
      // The first instalment's rounding kuruş stays in its cell, so every month still totals what it did.
      expect(ownMonths(TARGET_USER)).toEqual(ownMonths(SOURCE_USER));
    });

    // The wizard leaves a card's cycle blank when nobody knows it; the export copies that and restore must accept it.
    it("restores the backup of an import whose card cycle was left blank", async () => {
      const self = await createPerson(SOURCE_USER, "Ben");
      const phone = await createCategory(SOURCE_USER, { name: "Elektronik", kind: "expense", isTransfer: false, sortOrder: 0 });
      const card = await upsertPaymentSource(SOURCE_USER, { name: "Bonus", type: "credit_card", personId: self, statementDay: 20, dueDay: 5 });
      await createInstallmentPlan(SOURCE_USER, {
        title: "Telefon", kind: "card_installment", totalAmountMinor: 1_000_00, monthlyAmountMinor: null, installmentCount: 3,
        currency: "TRY", fxRate: null, startMonth: "2026-07" as never, dueDay: 5, paymentSourceId: card, personId: self,
        personIsSelf: true, categoryId: phone, note: null, tryFactor: 1,
      });

      const parsed = await parseWorkbookBytes(await buildWorkbookBytes(SOURCE_USER));
      const target = await createPerson(TARGET_USER, "Ben");
      await importSheets(TARGET_USER, { sheets: parsed.sheets, excludedLabels: [], selfId: target, mode: "replace" });

      expect(harness.db!.prepare(
        `SELECT statement_day, due_day FROM payment_sources WHERE user_id = ? AND type = 'credit_card' AND deleted_at IS NULL`,
      ).all(TARGET_USER)).toEqual([{ statement_day: null, due_day: null }]);
      const text = await buildExportText(TARGET_USER);
      expect(() => parseExportBundleText(text)).not.toThrow();
    });
  });
});
