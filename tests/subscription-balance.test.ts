/**
 * A subscription rule is a schedule, not a payment.
 *
 * Creating one must never move the current balance: only a confirmed
 * occurrence does that (spec §2.6, §2.7). The regression this file exists for
 * is an auto-pay rule saved on its own billing day — `subscription-form.tsx`
 * defaults `nextDueDate` to today whenever the billing day is today, and the
 * first maintenance pass then confirmed that occurrence as a REALIZED expense,
 * so the balance dropped the moment the rule was saved.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null, nextId: 0 }));

vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => ({
    getFirstAsync: async (sql: string, args: unknown[] = []) =>
      harness.db!.prepare(sql).get(...(args as never[])) ?? null,
    getAllAsync: async (sql: string, args: unknown[] = []) => harness.db!.prepare(sql).all(...(args as never[])),
    runAsync: async (sql: string, args: unknown[] = []) => ({
      changes: Number(harness.db!.prepare(sql).run(...(args as never[])).changes),
    }),
  }),
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
  newId: () => `id-${String(++harness.nextId).padStart(3, "0")}`,
  deterministicId: async (key: string) => `det:${key}`,
  naturalKeys: new Proxy({}, {
    get: (_target, property) => (...parts: unknown[]) => `${String(property)}|${parts.join("|")}`,
  }),
}));

vi.mock("../src/services/fx-fetch", () => ({ lookupRate: vi.fn(() => null) }));
vi.mock("../src/services/markets", () => ({ marketSellRateTry: vi.fn(() => null) }));
vi.mock("../src/sync/engine", () => ({ scheduleSync: vi.fn() }));

import { upsertSubscription } from "../src/data/repo/rules";
import { runMaintenance } from "../src/data/repo/maintenance";
import { confirmExpected } from "../src/data/repo/expected";
import { currentBalance } from "../src/domain/balance";
import { todayISO } from "../src/domain/dates";
import type { TxLike } from "../src/domain/types";

const USER = "subscription-balance-user";
const SEEDED_AT = "2020-01-01T09:00:00.000Z";
const OPENING_MINOR = 500_00;

const migrationsDir = join(process.cwd(), "src/db/migrations");
const migrationSql = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
  .flatMap((name) => readFileSync(join(migrationsDir, name), "utf8").split("--> statement-breakpoint"))
  .map((statement) => statement.trim())
  .filter(Boolean);

function seedWorkspace(): void {
  harness.db!.prepare(
    `INSERT INTO persons (id, user_id, created_at, updated_at, deleted_at, tombstone_version, name, is_self)
     VALUES ('person-self', ?, ?, ?, NULL, 0, 'Ben', 1)`,
  ).run(USER, SEEDED_AT, SEEDED_AT);
  harness.db!.prepare(
    `INSERT INTO categories (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       name, kind, sort_order, is_column, is_transfer)
     VALUES ('category-subs', ?, ?, ?, NULL, 0, 'Abonelikler', 'expense', 0, 1, 0)`,
  ).run(USER, SEEDED_AT, SEEDED_AT);
}

interface TransactionRow {
  id: string;
  status: string;
  effective_date: string;
  amount_try_minor: number;
  type: string;
  person_id: string;
  category_id: string | null;
  purchase_date: string | null;
  installment_plan_id: string | null;
  card_statement_id: string | null;
  subscription_id: string | null;
  is_aggregate: number;
}

function liveTransactions(): TransactionRow[] {
  return harness.db!
    .prepare(`SELECT * FROM transactions WHERE user_id = ? AND deleted_at IS NULL`)
    .all(USER) as unknown as TransactionRow[];
}

function expectedRows(): { id: string; status: string; due_date: string }[] {
  return harness.db!
    .prepare(`SELECT id, status, due_date FROM expected_payments WHERE user_id = ? AND deleted_at IS NULL ORDER BY due_date`)
    .all(USER) as unknown as { id: string; status: string; due_date: string }[];
}

/** The balance the dashboard hero shows, over the same realized-only rule. */
function balanceNow(): number {
  const transactions: TxLike[] = liveTransactions().map((row) => ({
    id: row.id,
    type: row.type as TxLike["type"],
    amountTryMinor: row.amount_try_minor,
    purchaseDate: row.purchase_date,
    effectiveDate: row.effective_date,
    status: row.status as TxLike["status"],
    categoryId: row.category_id,
    categoryKind: "expense",
    paymentSourceId: null,
    personIsSelf: row.person_id === "person-self",
    installmentPlanId: row.installment_plan_id,
    cardStatementId: row.card_statement_id,
    subscriptionId: row.subscription_id,
    isAggregate: Boolean(row.is_aggregate),
  }));
  return currentBalance({
    openingBalanceMinor: OPENING_MINOR,
    transactions,
    adjustments: [],
    today: todayISO(),
  });
}

/** Backdate a rule so the "the rule already existed" branch can be exercised. */
function backdateSubscription(id: string, createdAt: string): void {
  harness.db!.prepare(`UPDATE subscriptions SET created_at = ? WHERE id = ? AND user_id = ?`).run(createdAt, id, USER);
}

const baseInput = {
  name: "Netflix",
  amountMinor: 229_99,
  currency: "TRY",
  cycle: "monthly" as const,
  intervalMonths: 1,
  paymentSourceId: null,
  categoryId: "category-subs",
  personId: "person-self",
  isActive: true,
  trialEndDate: null,
  websiteDomain: null,
  note: null,
};

describe("adding a subscription never moves the current balance", () => {
  beforeEach(() => {
    harness.db = new DatabaseSync(":memory:");
    for (const statement of migrationSql) harness.db.exec(statement);
    harness.nextId = 0;
    seedWorkspace();
  });

  /** Today's own day-of-month, so the form's "due today" default is reproduced. */
  const dueTodayInput = () => {
    const today = todayISO();
    return { ...baseInput, billingDay: Number(today.slice(8, 10)), nextDueDate: today };
  };

  it("leaves the balance untouched for an unpaid manual subscription due today", async () => {
    await upsertSubscription(USER, { ...dueTodayInput(), autoPay: false });
    await runMaintenance(USER);

    expect(liveTransactions()).toEqual([]);
    expect(balanceNow()).toBe(OPENING_MINOR);
    expect(expectedRows()[0]?.status).toBe("pending");
  });

  it("leaves the balance untouched for an auto-pay subscription saved on its own billing day", async () => {
    await upsertSubscription(USER, { ...dueTodayInput(), autoPay: true });
    await runMaintenance(USER);

    // The occurrence is real and visible — it is simply not confirmed money.
    expect(expectedRows()[0]).toMatchObject({ due_date: todayISO(), status: "pending" });
    expect(liveTransactions()).toEqual([]);
    expect(balanceNow()).toBe(OPENING_MINOR);
  });

  it("keeps the balance stable across repeated maintenance passes", async () => {
    await upsertSubscription(USER, { ...dueTodayInput(), autoPay: true });
    await runMaintenance(USER);
    await runMaintenance(USER);
    await runMaintenance(USER);

    expect(liveTransactions()).toEqual([]);
    expect(balanceNow()).toBe(OPENING_MINOR);
  });

  it("still auto-confirms a rule that already existed when the due date arrived", async () => {
    const id = await upsertSubscription(USER, { ...dueTodayInput(), autoPay: true });
    backdateSubscription(id, "2026-01-05T09:00:00.000Z");
    await runMaintenance(USER);

    const transactions = liveTransactions();
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ status: "realized", effective_date: todayISO() });
    expect(balanceNow()).toBe(OPENING_MINOR - baseInput.amountMinor);
  });

  it("records exactly one realized expense when the user confirms the occurrence", async () => {
    await upsertSubscription(USER, { ...dueTodayInput(), autoPay: true });
    await runMaintenance(USER);
    const pending = expectedRows()[0];
    expect(pending).toBeDefined();

    await confirmExpected(USER, pending!.id, { personId: "person-self", categoryId: "category-subs" });
    await runMaintenance(USER);

    expect(liveTransactions()).toHaveLength(1);
    expect(balanceNow()).toBe(OPENING_MINOR - baseInput.amountMinor);
  });

  it("does not touch the balance for a recurring rule whose next charge is in the future", async () => {
    await upsertSubscription(USER, { ...baseInput, billingDay: 28, nextDueDate: "2099-01-28", autoPay: true });
    await runMaintenance(USER);

    expect(liveTransactions()).toEqual([]);
    expect(balanceNow()).toBe(OPENING_MINOR);
  });
});

/**
 * Matching an expectation to money that is already in the ledger.
 *
 * The failure this prevents is double counting: the owner records a payment,
 * then confirms the expectation, and the same money is in the ledger twice.
 * Matching links the two instead — and undoing that link must give the
 * expectation back WITHOUT destroying the transaction, which the expectation
 * never owned.
 */
