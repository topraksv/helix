/**
 * Backup round trip, including into a DIFFERENT account.
 *
 * A backup is the last safety valve this product has, and the one flow no
 * unit test covered end to end: every other backup test checks the validator
 * in isolation. This drives the real export builder over a real SQLite
 * database and imports the result back under a second user id, which is what
 * "restore my backup on my other account" actually does.
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null, nextId: 0 }));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-file-system", () => ({ File: class {}, Paths: { cache: "/tmp" } }));
vi.mock("../src/db/client", async () => {
  const { sqliteClientMock } = await import("./helpers");
  return sqliteClientMock(() => harness.db!);
});
// Ids have to be REAL uuids here: the backup validator rejects any id or
// `*_id` column that is not one, so a `row-0001` style stub would fail the
// import for reasons the product never has.
vi.mock("../src/db/ids", () => ({
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
vi.mock("../src/services/fx-fetch", () => ({ lookupRate: vi.fn() }));
vi.mock("../src/services/markets", () => ({ marketSellRateTry: vi.fn() }));
vi.mock("../src/sync/engine", () => ({ scheduleSync: vi.fn() }));

import {
  addTransaction,
  createCategory,
  createPerson,
  saveComputedColumn,
  seedWorkspace,
  upsertCategoryBudget,
  upsertSubscription,
} from "../src/data/repo";
import { saveCellNote } from "../src/data/repo/cell-notes";
import { deterministicId, naturalKeys } from "../src/db/ids";
import { resetLocalWorkspace, writeSetting } from "../src/db/mutations";
import { buildIdRemap, isDeterministicId } from "../src/services/backup-remap";
import { buildExportText, importBundle, parseExportBundleText } from "../src/services/export-import";
import { migrationStatements } from "./helpers";

// Accounts are uuids in the product; the validator enforces that too.
const SOURCE_USER = "11111111-1111-4111-8111-111111111111";
const TARGET_USER = "22222222-2222-4222-8222-222222222222";

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
  // A variable-amount subscription: the newest feature, and the one most
  // likely to be missing from a backup written before it existed.
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
    const before = {
      persons: countFor("persons", SOURCE_USER),
      categories: countFor("categories", SOURCE_USER),
      transactions: countFor("transactions", SOURCE_USER),
      category_budgets: countFor("category_budgets", SOURCE_USER),
      cell_notes: countFor("cell_notes", SOURCE_USER),
      subscriptions: countFor("subscriptions", SOURCE_USER),
    };
    expect(before.subscriptions).toBe(1);

    // A zero-amount variable subscription used to make the account's OWN
    // backup unreadable: the validator required a positive amount, so the
    // whole file was rejected as "Geçersiz yedek dosyası".
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
    const before = {
      persons: countFor("persons", SOURCE_USER),
      categories: countFor("categories", SOURCE_USER),
      transactions: countFor("transactions", SOURCE_USER),
      category_budgets: countFor("category_budgets", SOURCE_USER),
      cell_notes: countFor("cell_notes", SOURCE_USER),
      subscriptions: countFor("subscriptions", SOURCE_USER),
    };
    const sourceBudgetId = (harness.db!.prepare(
      `SELECT id FROM category_budgets WHERE user_id = ?`,
    ).get(SOURCE_USER) as { id: string }).id;
    const sourceNoteId = (harness.db!.prepare(
      `SELECT id FROM cell_notes WHERE user_id = ?`,
    ).get(SOURCE_USER) as { id: string }).id;
    // A plain uuidv7 row (created via `addTransaction`'s `newId()`) carries no
    // account identity and must survive the remap byte-for-byte.
    const sourceTxId = (harness.db!.prepare(
      `SELECT id FROM transactions WHERE user_id = ?`,
    ).get(SOURCE_USER) as { id: string }).id;

    const bundle = parseExportBundleText(await buildExportText(SOURCE_USER));
    // The real app wipes local SQLite on an account switch (`resetLocalWorkspace`,
    // called from session.ts when a different account signs in on this
    // device — the cloud is RLS-scoped source of truth, so local storage only
    // ever holds ONE account at a time). Simulate that here: a plain uuidv7
    // id from account A must not still be physically present as account A's
    // OWN row when account B restores it, or the write layer's (deliberate,
    // untouched-by-this-change) ownership guard refuses the write.
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

    // Re-running the SAME import must converge, not duplicate: the remap is a
    // pure function of (bundle, source, target), so a second pass computes
    // the identical target ids and the upsert lands on the same rows.
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

    const bundle = parseExportBundleText(await buildExportText(SOURCE_USER));
    // See the previous test: local SQLite holds one account at a time in the
    // real app, so simulate the account-switch wipe before restoring account
    // A's backup under account B.
    await resetLocalWorkspace();
    await importBundle(TARGET_USER, bundle);

    // `seedCategory` embeds the account id, so the category is re-seeded under
    // a DIFFERENT id for the target account — computed independently here
    // (not read off the target DB) to prove the remap actually recomputed the
    // embedded reference rather than merely copying whatever landed.
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

  /**
   * A restore is all-or-nothing, and the investment wallet is replayed as a
   * whole — so a bundle whose operations do not add up has no single row to
   * point at. The refusal used to be four words ("Geçersiz yedek dosyası"),
   * and finding the real cause of one took five rounds of bisecting the file
   * with the source open. It names the section now.
   */
  it("says which section a replay-level refusal came from", async () => {
    const personId = await createPerson(SOURCE_USER, "Ben");
    void personId;
    const bundle = parseExportBundleText(await buildExportText(SOURCE_USER));
    const now = "2026-08-01T00:00:00.000Z";
    const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
    const row = (extra: Record<string, unknown>) => ({
      user_id: SOURCE_USER, created_at: now, updated_at: now, deleted_at: null, tombstone_version: 0, ...extra,
    });
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
});
