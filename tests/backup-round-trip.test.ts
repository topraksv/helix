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
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null, nextId: 0 }));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-file-system", () => ({ File: class {}, Paths: { cache: "/tmp" } }));
vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => ({
    getFirstAsync: async (sql: string, args: unknown[] = []) =>
      harness.db!.prepare(sql).get(...(args as never[])) ?? null,
    getAllAsync: async (sql: string, args: unknown[] = []) =>
      harness.db!.prepare(sql).all(...(args as never[])),
    runAsync: async (sql: string, args: unknown[] = []) => ({
      changes: Number(harness.db!.prepare(sql).run(...(args as never[])).changes),
    }),
  }),
  withTransaction: async (task: () => Promise<void>) => {
    harness.db!.exec("BEGIN");
    try { await task(); harness.db!.exec("COMMIT"); } catch (error) { harness.db!.exec("ROLLBACK"); throw error; }
  },
}));
// Ids have to be REAL uuids here: the backup validator rejects any id or
// `*_id` column that is not one, so a `row-0001` style stub would fail the
// import for reasons the product never has.
vi.mock("../src/db/ids", () => ({
  newId: () => randomUUID(),
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
  upsertCategoryBudget,
  upsertSubscription,
} from "../src/data/repo";
import { saveCellNote } from "../src/data/cell-notes";
import { buildExportText, importBundle, parseExportBundleText } from "../src/services/export-import";

// Accounts are uuids in the product; the validator enforces that too.
const SOURCE_USER = "11111111-1111-4111-8111-111111111111";
const TARGET_USER = "22222222-2222-4222-8222-222222222222";
const migrationsDir = join(process.cwd(), "src/db/migrations");
const migrationSql = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
  .flatMap((name) => readFileSync(join(migrationsDir, name), "utf8").split("--> statement-breakpoint"))
  .map((statement) => statement.trim())
  .filter(Boolean);

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
    for (const statement of migrationSql) harness.db.exec(statement);
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

  it("refuses another account's backup instead of half-applying it", async () => {
    await seedSourceAccount();
    const bundle = parseExportBundleText(await buildExportText(SOURCE_USER));

    await expect(importBundle(TARGET_USER, bundle)).rejects.toThrow(/başka bir hesaba ait/);
    // Nothing landed, and the source account is untouched.
    expect(countFor("transactions", TARGET_USER)).toBe(0);
    expect(countFor("transactions", SOURCE_USER)).toBe(1);
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
});
