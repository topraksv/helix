import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  db: null as DatabaseSync | null,
  nextId: 0,
  dbAcquisitions: 0,
}));

vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => {
    harness.dbAcquisitions += 1;
    return {
      getFirstAsync: async (sql: string, args: unknown[] = []) =>
        harness.db!.prepare(sql).get(...(args as never[])) ?? null,
      getAllAsync: async (sql: string, args: unknown[] = []) =>
        harness.db!.prepare(sql).all(...(args as never[])),
      runAsync: async (sql: string, args: unknown[] = []) => ({
        changes: Number(harness.db!.prepare(sql).run(...(args as never[])).changes),
      }),
    };
  },
  withTransaction: async (task: () => Promise<void>) => {
    harness.db!.exec("BEGIN");
    try {
      await task();
      harness.db!.exec("COMMIT");
    } catch (error) {
      harness.db!.exec("ROLLBACK");
      throw error;
    }
  },
}));

vi.mock("../src/db/ids", () => ({
  newId: () => `transaction-${String(++harness.nextId).padStart(2, "0")}`,
  deterministicId: async (key: string) => `det:${key}`,
  naturalKeys: new Proxy(
    {},
    {
      get:
        (_target, property) =>
        (...parts: unknown[]) =>
          `${String(property)}|${parts.join("|")}`,
    },
  ),
}));

vi.mock("../src/services/fx-fetch", () => ({ lookupRate: vi.fn() }));
vi.mock("../src/services/markets", () => ({ marketSellRateTry: vi.fn() }));
vi.mock("../src/sync/engine", () => ({ scheduleSync: vi.fn() }));

import {
  addTransaction,
  assertSignedTransactionAmounts,
  assertTransactionCategory,
  bulkMonthEntry,
  countTransactionsForCategory,
  deleteBalanceAdjustment,
  deleteTransaction,
  livePaymentSource,
  restoreBalanceAdjustment,
  restoreTransaction,
  setCurrentBalance,
  updateTransaction,
  type NewTransaction,
  type TransactionPatch,
} from "../src/data/repo/transactions";
import { CreditCardCycleRequiredError } from "../src/data/repo/errors";
import { fromDbShape } from "../src/db/mutations";
import { MAX_ABS_AMOUNT_MINOR } from "../src/domain/money";

const USER = "transaction-user";
const OTHER_USER = "other-user";
const NOW = "2026-08-13T09:00:00.000Z";
const migrationsDir = join(process.cwd(), "src/db/migrations");
const migrationSql = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
  .flatMap((name) =>
    readFileSync(join(migrationsDir, name), "utf8").split(
      "--> statement-breakpoint",
    ),
  )
  .map((statement) => statement.trim())
  .filter(Boolean);

function seedPerson(
  id: string,
  userId = USER,
  deletedAt: string | null = null,
): void {
  harness.db!.prepare(
    `INSERT INTO persons
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version, name, is_self)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, NOW, NOW, deletedAt, deletedAt ? 1 : 0, id, 1);
}

function seedCategory(
  id: string,
  kind: "expense" | "income",
  isTransfer = false,
  userId = USER,
  deletedAt: string | null = null,
): void {
  harness.db!.prepare(
    `INSERT INTO categories
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       name, kind, sort_order, is_column, is_transfer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)`,
  ).run(
    id,
    userId,
    NOW,
    NOW,
    deletedAt,
    deletedAt ? 1 : 0,
    id,
    kind,
    isTransfer ? 1 : 0,
  );
}

function seedSource(
  id: string,
  type: "cash" | "credit_card",
  options: {
    userId?: string;
    deletedAt?: string | null;
    statementDay?: number | null;
    dueDay?: number | null;
  } = {},
): void {
  const userId = options.userId ?? USER;
  const deletedAt = options.deletedAt ?? null;
  harness.db!.prepare(
    `INSERT INTO payment_sources
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       name, type, person_id, due_day, statement_day, logo_source, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'initials', 1)`,
  ).run(
    id,
    userId,
    NOW,
    NOW,
    deletedAt,
    deletedAt ? 1 : 0,
    id,
    type,
    userId === USER ? "self" : "other-self",
    options.dueDay === undefined ? (type === "credit_card" ? 5 : null) : options.dueDay,
    options.statementDay === undefined ? (type === "credit_card" ? 25 : null) : options.statementDay,
  );
}

function seedTransaction(id: string, userId = USER): void {
  harness.db!.prepare(
    `INSERT INTO transactions
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       type, amount_minor, currency, fx_rate, amount_try_minor, entry_date,
       purchase_date, effective_date, status, category_id, payment_source_id,
       person_id, installment_plan_id, installment_no, card_statement_id,
       subscription_id, is_aggregate, note)
     VALUES (?, ?, ?, ?, NULL, 0, 'expense', 1000, 'TRY', NULL, 1000,
       '2026-08-13', NULL, '2026-08-13', 'realized', ?, NULL, ?, NULL, NULL,
       NULL, NULL, 0, NULL)`,
  ).run(
    id,
    userId,
    NOW,
    NOW,
    userId === USER ? "expense" : "other-expense",
    userId === USER ? "self" : "other-self",
  );
}

function transactionInput(
  overrides: Partial<NewTransaction> = {},
): NewTransaction {
  return {
    type: "expense",
    amountMinor: 12_345,
    currency: "TRY",
    fxRate: null,
    amountTryMinor: 12_345,
    effectiveDate: "2026-08-12",
    categoryId: "expense",
    paymentSourceId: "cash",
    personId: "self",
    note: "Market",
    ...overrides,
  };
}

function rawTransaction(id: string): Record<string, unknown> {
  return harness.db!.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as Record<string, unknown>;
}

function outbox(table: string): Record<string, unknown>[] {
  return harness.db!.prepare(
    "SELECT row_id, payload FROM outbox WHERE table_name = ? ORDER BY created_at, row_id",
  ).all(table) as Record<string, unknown>[];
}

function clearOutbox(): void {
  harness.db!.exec("DELETE FROM outbox");
}

describe("transaction repository persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    harness.nextId = 0;
    harness.dbAcquisitions = 0;
    harness.db = new DatabaseSync(":memory:");
    for (const statement of migrationSql) harness.db.exec(statement);
    seedPerson("self");
    seedPerson("other-self", OTHER_USER);
    seedPerson("deleted-self", USER, "2026-08-12T00:00:00.000Z");
    seedCategory("expense", "expense");
    seedCategory("income", "income");
    seedCategory("transfer", "expense", true);
    seedCategory("other-expense", "expense", false, OTHER_USER);
    seedCategory("deleted-expense", "expense", false, USER, "2026-08-12T00:00:00.000Z");
    seedSource("cash", "cash");
    seedSource("card", "credit_card");
    seedSource("broken-card", "credit_card", { statementDay: null });
    seedSource("other-cash", "cash", { userId: OTHER_USER });
    seedSource("deleted-cash", "cash", { deletedAt: "2026-08-12T00:00:00.000Z" });
  });

  afterEach(() => {
    harness.db?.close();
    harness.db = null;
    vi.useRealTimers();
  });

  it("persists cash, aggregate and signed transfer branches with exact ledger and outbox fields", async () => {
    const expenseId = await addTransaction(USER, transactionInput());
    const aggregateId = await addTransaction(USER, transactionInput({
      amountMinor: 22_000,
      amountTryMinor: 22_000,
      paymentSourceId: null,
      effectiveDate: "2026-08-14",
      isAggregate: true,
      subscriptionId: "subscription-1",
      note: null,
    }));
    const transferId = await addTransaction(USER, transactionInput({
      type: "transfer",
      amountMinor: -5_000,
      amountTryMinor: -5_000,
      categoryId: "transfer",
      paymentSourceId: null,
      note: "Yatırım",
    }));
    const todayId = await addTransaction(USER, transactionInput({
      type: "income",
      categoryId: "income",
      paymentSourceId: null,
      effectiveDate: "2026-08-13",
    }));

    expect(rawTransaction(expenseId)).toMatchObject({
      id: "transaction-01",
      user_id: USER,
      type: "expense",
      amount_minor: 12_345,
      currency: "TRY",
      fx_rate: null,
      amount_try_minor: 12_345,
      entry_date: "2026-08-13",
      purchase_date: null,
      effective_date: "2026-08-12",
      status: "realized",
      category_id: "expense",
      payment_source_id: "cash",
      person_id: "self",
      installment_plan_id: null,
      installment_no: null,
      card_statement_id: null,
      subscription_id: null,
      is_aggregate: 0,
      note: "Market",
      deleted_at: null,
    });
    expect(rawTransaction(aggregateId)).toMatchObject({
      status: "pending",
      is_aggregate: 1,
      subscription_id: "subscription-1",
      purchase_date: null,
      card_statement_id: null,
    });
    expect(rawTransaction(transferId)).toMatchObject({
      type: "transfer",
      amount_minor: -5_000,
      amount_try_minor: -5_000,
      category_id: "transfer",
      status: "realized",
    });
    expect(rawTransaction(todayId)).toMatchObject({
      type: "income",
      effective_date: "2026-08-13",
      status: "realized",
    });
    expect(outbox("transactions").map((row) => row.row_id)).toEqual([
      expenseId,
      aggregateId,
      transferId,
      todayId,
    ]);
    expect(JSON.parse(String(outbox("transactions")[0]!.payload))).toMatchObject({
      id: expenseId,
      user_id: USER,
      amount_minor: 12_345,
      purchase_date: null,
      effective_date: "2026-08-12",
      status: "realized",
      is_aggregate: false,
      deleted_at: null,
    });
  });

  it("creates and reuses one immutable card statement and moves purchases to its due date", async () => {
    const firstId = await addTransaction(USER, transactionInput({
      effectiveDate: "2026-08-26",
      paymentSourceId: "card",
    }));
    const statementBefore = harness.db!.prepare(
      "SELECT * FROM credit_card_statements",
    ).get() as Record<string, unknown>;
    expect(statementBefore).toMatchObject({
      user_id: USER,
      payment_source_id: "card",
      period_month: "2026-09",
      statement_date: "2026-09-25",
      due_date: "2026-10-05",
      created_at: NOW,
      deleted_at: null,
    });
    expect(rawTransaction(firstId)).toMatchObject({
      purchase_date: "2026-08-26",
      effective_date: "2026-10-05",
      status: "pending",
      card_statement_id: statementBefore.id,
    });

    vi.setSystemTime(new Date("2026-08-13T09:01:00.000Z"));
    const secondId = await addTransaction(USER, transactionInput({
      effectiveDate: "2026-08-27",
      paymentSourceId: "card",
    }));
    const statements = harness.db!.prepare(
      "SELECT * FROM credit_card_statements",
    ).all() as Record<string, unknown>[];
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({
      id: statementBefore.id,
      created_at: NOW,
      updated_at: "2026-08-13T09:01:00.000Z",
    });
    expect(rawTransaction(secondId)).toMatchObject({
      purchase_date: "2026-08-27",
      effective_date: "2026-10-05",
      card_statement_id: statementBefore.id,
    });
    expect(outbox("credit_card_statements")).toHaveLength(2);
    expect(JSON.parse(String(outbox("credit_card_statements")[1]!.payload))).toMatchObject({
      id: statementBefore.id,
      created_at: NOW,
      updated_at: "2026-08-13T09:01:00.000Z",
    });
    expect(outbox("transactions")).toHaveLength(2);
  });

  it("limits statement resolution to nonaggregate credit-card expenses", async () => {
    await expect(addTransaction(USER, transactionInput({
      paymentSourceId: "card",
      isAggregate: true,
    }))).rejects.toBeInstanceOf(CreditCardCycleRequiredError);
    await expect(addTransaction(USER, transactionInput({
      paymentSourceId: "broken-card",
    }))).rejects.toBeInstanceOf(CreditCardCycleRequiredError);

    const incomeId = await addTransaction(USER, transactionInput({
      type: "income",
      categoryId: "income",
      paymentSourceId: "broken-card",
    }));
    expect(rawTransaction(incomeId)).toMatchObject({
      type: "income",
      purchase_date: null,
      effective_date: "2026-08-12",
      card_statement_id: null,
    });
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM credit_card_statements").get()).toEqual({ n: 0 });
    expect(outbox("transactions")).toHaveLength(1);
  });

  it("rejects invalid dates, currencies, signed amounts and notes without a domain or outbox write", async () => {
    const invalidInputs: [Partial<NewTransaction>, string][] = [
      [{ effectiveDate: "2026-02-29" }, "Invalid transaction date"],
      [{ currency: "BTC" }, "Invalid transaction currency"],
      [{ amountMinor: 0 }, "Invalid signed transaction amount"],
      [{ amountTryMinor: 0 }, "Invalid signed transaction amount"],
      [{ amountMinor: 1.5 }, "Invalid signed transaction amount"],
      [{ amountTryMinor: MAX_ABS_AMOUNT_MINOR + 1 }, "Invalid signed transaction amount"],
      [{ amountMinor: -1_000, amountTryMinor: 1_000 }, "Invalid signed transaction amount"],
      [{ note: "x".repeat(1_001) }, "note input exceeds its maximum length"],
      [{ categoryId: "" }, "Transaction category is required"],
    ];
    for (const [overrides, message] of invalidInputs) {
      await expect(addTransaction(USER, transactionInput(overrides))).rejects.toThrow(message);
    }
    expect(() => assertSignedTransactionAmounts(-1_000, -2_000)).not.toThrow();
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM transactions").get()).toEqual({ n: 0 });
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("enforces live owned people, categories and sources plus transfer classification", async () => {
    await expect(addTransaction(USER, transactionInput({ personId: "other-self" })))
      .rejects.toThrow("Transaction person does not exist");
    await expect(addTransaction(USER, transactionInput({ personId: "deleted-self" })))
      .rejects.toThrow("Transaction person does not exist");
    await expect(addTransaction(USER, transactionInput({ categoryId: "other-expense" })))
      .rejects.toThrow("Transaction type and category do not match");
    await expect(addTransaction(USER, transactionInput({ categoryId: "deleted-expense" })))
      .rejects.toThrow("Transaction type and category do not match");
    await expect(addTransaction(USER, transactionInput({ type: "income" })))
      .rejects.toThrow("Transaction type and category do not match");
    await expect(addTransaction(USER, transactionInput({ type: "transfer" })))
      .rejects.toThrow("Transaction type and category do not match");
    await expect(addTransaction(USER, transactionInput({ paymentSourceId: "other-cash" })))
      .rejects.toThrow("Transaction payment source does not exist");
    await expect(addTransaction(USER, transactionInput({ paymentSourceId: "deleted-cash" })))
      .rejects.toThrow("Transaction payment source does not exist");
    await expect(assertTransactionCategory(USER, "expense", null, false)).resolves.toBeUndefined();
    await expect(assertTransactionCategory(USER, "expense", null, true))
      .rejects.toThrow("Transaction category is required");
    const beforeNullSource = harness.dbAcquisitions;
    await expect(livePaymentSource(USER, null)).resolves.toBeNull();
    expect(harness.dbAcquisitions).toBe(beforeNullSource);
    await expect(livePaymentSource(USER, "cash")).resolves.toMatchObject({ id: "cash", type: "cash" });
    await expect(livePaymentSource(USER, "other-cash")).resolves.toBeNull();
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM transactions").get()).toEqual({ n: 0 });
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("updates only a live owned row while preserving creation and installment linkage", async () => {
    const id = await addTransaction(USER, transactionInput());
    harness.db!.prepare(
      "UPDATE transactions SET installment_plan_id = 'plan-1', installment_no = 2 WHERE id = ?",
    ).run(id);
    const existing = fromDbShape("transactions", rawTransaction(id));
    clearOutbox();
    vi.setSystemTime(new Date("2026-08-13T09:02:00.000Z"));
    const patch: TransactionPatch = {
      type: "income",
      amountMinor: 50_000,
      currency: "USD",
      fxRate: "34.25",
      amountTryMinor: 1_712_500,
      effectiveDate: "2026-08-14",
      categoryId: "income",
      paymentSourceId: null,
      personId: "self",
      note: "Prim",
    };
    await updateTransaction(USER, existing, patch);

    expect(rawTransaction(id)).toMatchObject({
      user_id: USER,
      created_at: NOW,
      updated_at: "2026-08-13T09:02:00.000Z",
      type: "income",
      amount_minor: 50_000,
      currency: "USD",
      fx_rate: "34.25",
      amount_try_minor: 1_712_500,
      purchase_date: null,
      effective_date: "2026-08-14",
      status: "pending",
      category_id: "income",
      payment_source_id: null,
      installment_plan_id: "plan-1",
      installment_no: 2,
      is_aggregate: 0,
      note: "Prim",
    });
    expect(outbox("transactions")).toHaveLength(1);
    expect(JSON.parse(String(outbox("transactions")[0]!.payload))).toMatchObject({
      id,
      installment_plan_id: "plan-1",
      installment_no: 2,
      status: "pending",
    });

    vi.setSystemTime(new Date("2026-08-13T09:03:00.000Z"));
    await updateTransaction(
      USER,
      fromDbShape("transactions", rawTransaction(id)),
      { ...patch, effectiveDate: "2026-08-12" },
    );
    expect(rawTransaction(id)).toMatchObject({ effective_date: "2026-08-12", status: "realized" });
    vi.setSystemTime(new Date("2026-08-13T09:04:00.000Z"));
    await updateTransaction(
      USER,
      fromDbShape("transactions", rawTransaction(id)),
      { ...patch, effectiveDate: "2026-08-13" },
    );
    expect(rawTransaction(id)).toMatchObject({ effective_date: "2026-08-13", status: "realized" });
  });

  it("updates a cash transaction and its card statement in one real batch", async () => {
    const id = await addTransaction(USER, transactionInput());
    clearOutbox();
    await updateTransaction(
      USER,
      fromDbShape("transactions", rawTransaction(id)),
      transactionInput({ effectiveDate: "2026-08-26", paymentSourceId: "card" }),
    );

    const statement = harness.db!.prepare("SELECT * FROM credit_card_statements").get() as Record<string, unknown>;
    expect(statement).toMatchObject({
      payment_source_id: "card",
      period_month: "2026-09",
      statement_date: "2026-09-25",
      due_date: "2026-10-05",
    });
    expect(rawTransaction(id)).toMatchObject({
      purchase_date: "2026-08-26",
      effective_date: "2026-10-05",
      card_statement_id: statement.id,
      status: "pending",
    });
    expect(outbox("credit_card_statements")).toHaveLength(1);
    expect(outbox("transactions")).toHaveLength(1);
  });

  it("rejects invalid or stale updates atomically", async () => {
    seedTransaction("foreign-transaction", OTHER_USER);
    seedTransaction("deleted-transaction");
    harness.db!.prepare(
      "UPDATE transactions SET deleted_at = ?, tombstone_version = 1 WHERE id = ?",
    ).run("2026-08-12T00:00:00.000Z", "deleted-transaction");
    const liveExisting = fromDbShape("transactions", {
      ...rawTransaction("deleted-transaction"),
      id: "missing-transaction",
      deleted_at: null,
    });
    const patch = transactionInput({ paymentSourceId: null }) as TransactionPatch;
    const invalidPatches: [Partial<TransactionPatch>, string][] = [
      [{ effectiveDate: "2026-13-01" }, "Invalid transaction date"],
      [{ currency: "BTC" }, "Invalid transaction currency"],
      [{ amountMinor: 0 }, "Invalid signed transaction amount"],
      [{ amountMinor: -1_000, amountTryMinor: 1_000 }, "Invalid signed transaction amount"],
      [{ note: "x".repeat(1_001) }, "note input exceeds its maximum length"],
      [{ categoryId: "" }, "Transaction category is required"],
    ];
    for (const [overrides, message] of invalidPatches) {
      await expect(updateTransaction(USER, liveExisting, { ...patch, ...overrides }))
        .rejects.toThrow(message);
    }
    await expect(updateTransaction(
      USER,
      fromDbShape("transactions", rawTransaction("foreign-transaction")),
      patch,
    )).rejects.toThrow("Cannot edit missing transactions row");
    await expect(updateTransaction(
      USER,
      fromDbShape("transactions", rawTransaction("deleted-transaction")),
      patch,
    )).rejects.toThrow("Cannot edit missing transactions row");
    expect(rawTransaction("foreign-transaction")).toMatchObject({ user_id: OTHER_USER, amount_minor: 1_000 });
    expect(rawTransaction("deleted-transaction")).toMatchObject({ deleted_at: "2026-08-12T00:00:00.000Z" });
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("rolls back a card statement and every outbox row when a new id collides with another owner", async () => {
    seedTransaction("transaction-01", OTHER_USER);
    await expect(addTransaction(USER, transactionInput({
      effectiveDate: "2026-08-26",
      paymentSourceId: "card",
    }))).rejects.toThrow("Write ownership conflict in transactions");

    expect(rawTransaction("transaction-01")).toMatchObject({
      user_id: OTHER_USER,
      amount_minor: 1_000,
      deleted_at: null,
    });
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM credit_card_statements").get()).toEqual({ n: 0 });
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM settings").get()).toEqual({ n: 0 });
  });

  it("tombstones and restores raw transaction snapshots without allowing stale or foreign undo", async () => {
    const id = await addTransaction(USER, transactionInput());
    const original = rawTransaction(id);
    clearOutbox();
    vi.setSystemTime(new Date("2026-08-13T09:03:00.000Z"));
    const snapshot = await deleteTransaction(USER, id);
    expect(snapshot).toEqual(original);
    expect(rawTransaction(id)).toMatchObject({
      created_at: NOW,
      deleted_at: "2026-08-13T09:03:00.000Z",
      tombstone_version: 1,
    });
    expect(JSON.parse(String(outbox("transactions")[0]!.payload))).toMatchObject({
      id,
      deleted_at: "2026-08-13T09:03:00.000Z",
      tombstone_version: 1,
    });

    clearOutbox();
    await expect(deleteTransaction(USER, id)).resolves.toBeNull();
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
    seedTransaction("foreign-delete", OTHER_USER);
    await expect(deleteTransaction(USER, "foreign-delete")).resolves.toBeNull();
    expect(rawTransaction("foreign-delete")).toMatchObject({
      user_id: OTHER_USER,
      deleted_at: null,
      tombstone_version: 0,
    });
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
    vi.setSystemTime(new Date("2026-08-13T09:04:00.000Z"));
    await restoreTransaction(USER, snapshot!);
    expect(rawTransaction(id)).toMatchObject({
      created_at: NOW,
      updated_at: "2026-08-13T09:04:00.000Z",
      deleted_at: null,
      tombstone_version: 1,
      amount_minor: 12_345,
    });

    clearOutbox();
    await expect(restoreTransaction(USER, snapshot!))
      .rejects.toThrow("Cannot restore transactions row without its tombstone");
    await expect(restoreTransaction(USER, { ...snapshot, id: "missing" }))
      .rejects.toThrow("Cannot restore transactions row without its tombstone");
    await deleteTransaction(USER, id);
    clearOutbox();
    await expect(restoreTransaction(USER, { ...snapshot, user_id: OTHER_USER }))
      .rejects.toThrow("Cannot restore transactions row from another account");
    expect(rawTransaction(id).deleted_at).toEqual(expect.any(String));
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("creates, rewrites and zero-tombstones one daily balance adjustment without changing created_at", async () => {
    const id = "det:balanceAdjustment|transaction-user|2026-08-13";
    await setCurrentBalance(USER, 1_000, 800, "İlk sayım");
    expect(harness.db!.prepare("SELECT * FROM balance_adjustments WHERE id = ?").get(id)).toMatchObject({
      id,
      user_id: USER,
      date: "2026-08-13",
      amount_minor: 200,
      note: "İlk sayım",
      created_at: NOW,
      deleted_at: null,
      tombstone_version: 0,
    });

    vi.setSystemTime(new Date("2026-08-13T09:05:00.000Z"));
    await setCurrentBalance(USER, 1_500, 1_000, "İkinci sayım");
    expect(harness.db!.prepare("SELECT * FROM balance_adjustments WHERE id = ?").get(id)).toMatchObject({
      amount_minor: 700,
      note: "İkinci sayım",
      created_at: NOW,
      updated_at: "2026-08-13T09:05:00.000Z",
      deleted_at: null,
    });

    vi.setSystemTime(new Date("2026-08-13T09:06:00.000Z"));
    await setCurrentBalance(USER, 800, 1_500);
    const tombstone = harness.db!.prepare("SELECT * FROM balance_adjustments WHERE id = ?").get(id) as Record<string, unknown>;
    expect(tombstone).toMatchObject({
      amount_minor: 0,
      note: null,
      created_at: NOW,
      deleted_at: "2026-08-13T09:06:00.000Z",
      tombstone_version: 1,
    });
    expect(outbox("balance_adjustments")).toHaveLength(3);
    expect(JSON.parse(String(outbox("balance_adjustments")[2]!.payload))).toMatchObject({
      amount_minor: 0,
      deleted_at: "2026-08-13T09:06:00.000Z",
      tombstone_version: 1,
    });
  });

  it("validates balance adjustments and exposes their shared tombstone restore wrappers", async () => {
    await expect(setCurrentBalance(USER, MAX_ABS_AMOUNT_MINOR + 1, 0))
      .rejects.toThrow("Amount is outside the supported range");
    await expect(setCurrentBalance(USER, 100, 0, "x".repeat(1_001)))
      .rejects.toThrow("note input exceeds its maximum length");
    await expect(setCurrentBalance(USER, MAX_ABS_AMOUNT_MINOR, -MAX_ABS_AMOUNT_MINOR))
      .rejects.toThrow("Amount is outside the supported range");
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM balance_adjustments").get()).toEqual({ n: 0 });
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });

    await setCurrentBalance(USER, 1_000, 900);
    const id = "det:balanceAdjustment|transaction-user|2026-08-13";
    const snapshot = harness.db!.prepare("SELECT * FROM balance_adjustments WHERE id = ?").get(id) as Record<string, unknown>;
    clearOutbox();
    await deleteBalanceAdjustment(USER, id);
    expect(harness.db!.prepare("SELECT deleted_at, tombstone_version FROM balance_adjustments WHERE id = ?").get(id))
      .toMatchObject({ deleted_at: NOW, tombstone_version: 1 });
    await restoreBalanceAdjustment(USER, snapshot);
    expect(harness.db!.prepare("SELECT amount_minor, deleted_at, tombstone_version FROM balance_adjustments WHERE id = ?").get(id))
      .toEqual({ amount_minor: 100, deleted_at: null, tombstone_version: 1 });
    await expect(deleteBalanceAdjustment(OTHER_USER, id)).resolves.toBeNull();
  });

  it("counts only live owned category references", async () => {
    const first = await addTransaction(USER, transactionInput());
    await addTransaction(USER, transactionInput());
    await addTransaction(USER, transactionInput({ categoryId: "income", type: "income" }));
    seedTransaction("foreign-count", OTHER_USER);
    await deleteTransaction(USER, first);

    await expect(countTransactionsForCategory(USER, "expense")).resolves.toBe(1);
    await expect(countTransactionsForCategory(USER, "income")).resolves.toBe(1);
    await expect(countTransactionsForCategory(OTHER_USER, "other-expense")).resolves.toBe(1);
    await expect(countTransactionsForCategory(USER, "missing")).resolves.toBe(0);
  });

  it("persists past-month aggregates and rejects invalid, current and future batches atomically", async () => {
    await expect(bulkMonthEntry(USER, "2026-7" as never, "self", []))
      .rejects.toThrow("Invalid bulk entry month");
    await expect(bulkMonthEntry(USER, "2026-08", "self", []))
      .rejects.toThrow("Bulk history accepts past months only");
    await expect(bulkMonthEntry(USER, "2026-09", "self", []))
      .rejects.toThrow("Bulk history accepts past months only");
    await expect(bulkMonthEntry(USER, "2026-07", "self", [
      { categoryId: "expense", type: "expense", amountMinor: 0 },
    ])).rejects.toThrow("Amount is outside the supported range");
    await expect(bulkMonthEntry(USER, "2026-07", "other-self", [
      { categoryId: "expense", type: "expense", amountMinor: 1_000 },
    ])).rejects.toThrow("Transaction person does not exist");
    await expect(bulkMonthEntry(USER, "2026-07", "self", [
      { categoryId: "expense", type: "expense", amountMinor: 1_000 },
      { categoryId: "other-expense", type: "expense", amountMinor: 2_000 },
    ])).rejects.toThrow("Transaction type and category do not match");
    await expect(bulkMonthEntry(USER, "2026-07", "self", [
      { categoryId: "", type: "expense", amountMinor: 1_000 },
    ])).rejects.toThrow("Transaction category is required");
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM transactions").get()).toEqual({ n: 0 });
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });

    await bulkMonthEntry(USER, "2026-07", "self", [
      { categoryId: "expense", type: "expense", amountMinor: 11_000 },
      { categoryId: "income", type: "income", amountMinor: 22_000 },
      { categoryId: "transfer", type: "transfer", amountMinor: -3_000 },
    ]);
    const rows = harness.db!.prepare(
      `SELECT type, amount_minor, currency, fx_rate, amount_try_minor, entry_date,
              purchase_date, effective_date, status, category_id, payment_source_id,
              person_id, installment_plan_id, installment_no, card_statement_id,
              subscription_id, is_aggregate, note, deleted_at
       FROM transactions ORDER BY id`,
    ).all() as Record<string, unknown>[];
    expect(rows).toEqual([
      {
        type: "expense", amount_minor: 11_000, currency: "TRY", fx_rate: null,
        amount_try_minor: 11_000, entry_date: "2026-08-13", purchase_date: null,
        effective_date: "2026-07-15", status: "realized", category_id: "expense",
        payment_source_id: null, person_id: "self", installment_plan_id: null,
        installment_no: null, card_statement_id: null, subscription_id: null,
        is_aggregate: 1, note: null, deleted_at: null,
      },
      {
        type: "income", amount_minor: 22_000, currency: "TRY", fx_rate: null,
        amount_try_minor: 22_000, entry_date: "2026-08-13", purchase_date: null,
        effective_date: "2026-07-15", status: "realized", category_id: "income",
        payment_source_id: null, person_id: "self", installment_plan_id: null,
        installment_no: null, card_statement_id: null, subscription_id: null,
        is_aggregate: 1, note: null, deleted_at: null,
      },
      {
        type: "transfer", amount_minor: -3_000, currency: "TRY", fx_rate: null,
        amount_try_minor: -3_000, entry_date: "2026-08-13", purchase_date: null,
        effective_date: "2026-07-15", status: "realized", category_id: "transfer",
        payment_source_id: null, person_id: "self", installment_plan_id: null,
        installment_no: null, card_statement_id: null, subscription_id: null,
        is_aggregate: 1, note: null, deleted_at: null,
      },
    ]);
    expect(outbox("transactions")).toHaveLength(3);
    expect(outbox("transactions").map((row) => JSON.parse(String(row.payload)))).toEqual(
      rows.map((row) => expect.objectContaining({
        type: row.type,
        amount_minor: row.amount_minor,
        effective_date: "2026-07-15",
        status: "realized",
        is_aggregate: true,
        deleted_at: null,
      })),
    );
  });
});
