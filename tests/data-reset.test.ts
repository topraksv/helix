import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null }));

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

vi.mock("../src/sync/engine", () => ({ scheduleSync: vi.fn() }));

import {
  performDataReset,
  previewDataReset,
  UNDATED_SCOPES,
  type ResetRange,
  type ResetSelection,
} from "../src/data/repo/reset";
import { migrationStatements } from "./helpers";

const USER = "reset-user";
const OTHER = "other-user";
const NOW = "2026-08-31T09:00:00.000Z";

function run(sql: string, args: unknown[]): void {
  harness.db!.prepare(sql).run(...(args as never[]));
}

function seedPerson(id = "self", userId = USER): void {
  run(
    `INSERT INTO persons (id, user_id, created_at, updated_at, deleted_at, tombstone_version, name, is_self)
     VALUES (?, ?, ?, ?, NULL, 0, ?, 1)`,
    [id, userId, NOW, NOW, id],
  );
}

function seedCategory(id: string, options: { userId?: string; isTransfer?: boolean } = {}): void {
  run(
    `INSERT INTO categories (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       name, kind, icon, color, sort_order, is_column, is_transfer)
     VALUES (?, ?, ?, ?, NULL, 0, ?, 'expense', NULL, NULL, 0, 1, ?)`,
    [id, options.userId ?? USER, NOW, NOW, id, options.isTransfer ? 1 : 0],
  );
}

function seedTransaction(
  id: string,
  options: {
    userId?: string;
    effectiveDate?: string;
    categoryId?: string | null;
    planId?: string | null;
    subscriptionId?: string | null;
    amountTryMinor?: number;
    type?: "expense" | "income" | "transfer";
    deletedAt?: string | null;
  } = {},
): void {
  const deletedAt = options.deletedAt ?? null;
  run(
    `INSERT INTO transactions (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       type, amount_minor, currency, fx_rate, amount_try_minor, entry_date, purchase_date,
       effective_date, status, category_id, payment_source_id, person_id, installment_plan_id,
       installment_no, card_statement_id, subscription_id, is_aggregate, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'TRY', NULL, ?, ?, NULL, ?, 'realized', ?, NULL, 'self', ?, NULL, NULL, ?, 0, NULL)`,
    [
      id,
      options.userId ?? USER,
      NOW,
      NOW,
      deletedAt,
      deletedAt ? 1 : 0,
      options.type ?? "expense",
      options.amountTryMinor ?? 1000,
      options.amountTryMinor ?? 1000,
      options.effectiveDate ?? "2026-05-10",
      options.effectiveDate ?? "2026-05-10",
      options.categoryId ?? null,
      options.planId ?? null,
      options.subscriptionId ?? null,
    ],
  );
}

function seedPlan(id: string, startMonth = "2026-01"): void {
  run(
    `INSERT INTO installment_plans (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       title, kind, total_amount_minor, monthly_amount_minor, installment_count, currency,
       start_month, due_day, payment_source_id, person_id, category_id, note)
     VALUES (?, ?, ?, ?, NULL, 0, ?, 'card_installment', 12000, 1000, 12, 'TRY', ?, NULL, NULL, 'self', NULL, NULL)`,
    [id, USER, NOW, NOW, id, startMonth],
  );
}

function seedSubscription(id: string): void {
  run(
    `INSERT INTO subscriptions (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       name, amount_minor, amount_mode, currency, cycle, interval_months, billing_day, next_due_date,
       payment_source_id, category_id, person_id, is_active, canceled_at, trial_end_date, auto_pay,
       website_domain, logo_source, logo_ref, note)
     VALUES (?, ?, ?, ?, NULL, 0, ?, 1000, 'fixed', 'TRY', 'monthly', 1, 1, '2026-09-01',
       NULL, NULL, 'self', 1, NULL, NULL, 0, NULL, 'initials', NULL, NULL)`,
    [id, USER, NOW, NOW, id],
  );
}

function seedIncome(id: string): void {
  run(
    `INSERT INTO recurring_incomes (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       name, kind, default_amount_minor, currency, pay_day, recurrence, anchor_date, person_id,
       category_id, is_active, note)
     VALUES (?, ?, ?, ?, NULL, 0, ?, 'salary', 100000, 'TRY', 1, 'monthly', NULL, 'self', NULL, 1, NULL)`,
    [id, USER, NOW, NOW, id],
  );
}

function seedPriceHistory(id: string, subscriptionId: string): void {
  run(
    `INSERT INTO price_history (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       subscription_id, amount_minor, currency, effective_from)
     VALUES (?, ?, ?, ?, NULL, 0, ?, 1000, 'TRY', '2026-01-01')`,
    [id, USER, NOW, NOW, subscriptionId],
  );
}

function seedExpected(
  id: string,
  options: {
    kind?: "subscription" | "recurring_income";
    refId?: string;
    transactionId?: string | null;
    status?: "pending" | "paid";
    dueDate?: string;
  } = {},
): void {
  run(
    `INSERT INTO expected_payments (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       direction, kind, ref_id, due_date, amount_minor, amount_is_estimated, currency, status,
       paid_at, auto_confirmed, transaction_id)
     VALUES (?, ?, ?, ?, NULL, 0, 'out', ?, ?, ?, 1000, 0, 'TRY', ?, NULL, 0, ?)`,
    [
      id,
      USER,
      NOW,
      NOW,
      options.kind ?? "subscription",
      options.refId ?? "sub-1",
      options.dueDate ?? "2026-05-01",
      options.status ?? "pending",
      options.transactionId ?? null,
    ],
  );
}

function seedAttachment(id: string, transactionId: string): void {
  run(
    `INSERT INTO attachments (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       transaction_id, file_name, stored_name, mime_type, byte_size, kind)
     VALUES (?, ?, ?, ?, NULL, 0, ?, 'r.pdf', 'stored.pdf', 'application/pdf', 10, 'receipt')`,
    [id, USER, NOW, NOW, transactionId],
  );
}

function seedCellNote(id: string, month: string): void {
  run(
    `INSERT INTO cell_notes (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       month, category_id, body)
     VALUES (?, ?, ?, ?, NULL, 0, ?, 'cat-1', 'note')`,
    [id, USER, NOW, NOW, month],
  );
}

function seedMatrixColor(id: string, scope: "row" | "column" | "cell", month: string | null): void {
  run(
    `INSERT INTO matrix_colors (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       scope, item_key, month, token)
     VALUES (?, ?, ?, ?, NULL, 0, ?, 'cat-1', ?, 'red')`,
    [id, USER, NOW, NOW, scope, month],
  );
}

function seedBudget(id: string, month: string): void {
  run(
    `INSERT INTO category_budgets (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       category_id, month, amount_minor)
     VALUES (?, ?, ?, ?, NULL, 0, 'cat-1', ?, 5000)`,
    [id, USER, NOW, NOW, month],
  );
}

function seedAdjustment(id: string, date: string): void {
  run(
    `INSERT INTO balance_adjustments (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       date, amount_minor, note)
     VALUES (?, ?, ?, ?, NULL, 0, ?, 500, NULL)`,
    [id, USER, NOW, NOW, date],
  );
}

function seedProfile(startedOn = "2026-01-01", openingCashMinor = 0): void {
  run(
    `INSERT INTO investment_profiles (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       started_on, opening_cash_minor, setup_completed)
     VALUES ('profile', ?, ?, ?, NULL, 0, ?, ?, 1)`,
    [USER, NOW, NOW, startedOn, openingCashMinor],
  );
}

function seedProduct(id = "gold"): void {
  run(
    `INSERT INTO investment_products (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       asset_type, name, market_code, note, target_weight_bp)
     VALUES (?, ?, ?, ?, NULL, 0, 'metal', ?, NULL, NULL, NULL)`,
    [id, USER, NOW, NOW, id],
  );
}

/** One unit bought at `totalMinor`, which is the quote the validator replays. */
function seedOperation(id: string, date: string, totalMinor: number, productId = "gold"): void {
  run(
    `INSERT INTO investment_operations (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       product_id, kind, operation_date, quantity, unit_price_minor, total_minor, cost_basis_minor,
       realized_profit_loss_minor, note, import_key)
     VALUES (?, ?, ?, ?, NULL, 0, ?, 'buy', ?, '1', ?, ?, 0, 0, NULL, NULL)`,
    [id, USER, NOW, NOW, productId, date, totalMinor, totalMinor],
  );
}

function seedSetting(key: string, value: string): void {
  run(
    `INSERT INTO settings (id, user_id, created_at, updated_at, deleted_at, tombstone_version, key, value)
     VALUES (?, ?, ?, ?, NULL, 0, ?, ?)`,
    [`det:setting|${USER}|${key}`, USER, NOW, NOW, key, value],
  );
}

function live(table: string, userId = USER): string[] {
  return harness
    .db!.prepare(`SELECT id FROM ${table} WHERE user_id = ? AND deleted_at IS NULL ORDER BY id`)
    .all(userId)
    .map((row) => String((row as { id: string }).id));
}

const ALL_DATES: ResetRange = { from: null, to: null };

function selection(scopes: ResetSelection["scopes"], range: ResetRange = ALL_DATES): ResetSelection {
  return { scopes, range };
}

describe("data reset", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    harness.db = new DatabaseSync(":memory:");
    for (const statement of migrationStatements) harness.db.exec(statement);
    seedPerson();
    seedPerson("other-self", OTHER);
    seedCategory("cat-1");
  });

  afterEach(() => {
    harness.db?.close();
    harness.db = null;
    vi.useRealTimers();
  });

  describe("what a range means", () => {
    it("deletes only the ledger rows inside it", async () => {
      seedTransaction("before", { effectiveDate: "2025-12-31" });
      seedTransaction("inside", { effectiveDate: "2026-03-15" });
      seedTransaction("after", { effectiveDate: "2027-01-01" });

      await performDataReset(USER, selection(["ledger"], { from: "2026-01-01", to: "2026-12-31" }));

      expect(live("transactions")).toEqual(["after", "before"]);
    });

    it("deletes everything when both ends are open", async () => {
      seedTransaction("a", { effectiveDate: "2019-01-01" });
      seedTransaction("b", { effectiveDate: "2030-01-01" });

      await performDataReset(USER, selection(["ledger"]));

      expect(live("transactions")).toEqual([]);
    });

    it("keeps a month's note and marks when the range only clips that month", async () => {
      // A note belongs to a whole month. Half a month selected is not that
      // month, and deleting it would erase a record of days nobody selected.
      seedCellNote("clipped", "2026-03");
      seedCellNote("whole", "2026-04");
      seedMatrixColor("cell-clipped", "cell", "2026-03");
      seedMatrixColor("cell-whole", "cell", "2026-04");

      await performDataReset(USER, selection(["ledger"], { from: "2026-03-15", to: "2026-04-30" }));

      expect(live("cell_notes")).toEqual(["clipped"]);
      expect(live("matrix_colors")).toEqual(["cell-clipped"]);
    });

    it("accepts a start with no end, and an end with no start", async () => {
      // The two commonest selections there are: "everything from here on" and
      // "everything up to here". Both ends were always given in the tests until
      // a mutant showed either bound could be dropped without one failing.
      seedTransaction("old", { effectiveDate: "2024-06-01" });
      seedTransaction("recent", { effectiveDate: "2026-06-01" });

      await performDataReset(USER, selection(["ledger"], { from: "2026-01-01", to: null }));
      expect(live("transactions")).toEqual(["old"]);

      seedTransaction("newer", { effectiveDate: "2027-06-01" });
      await performDataReset(USER, selection(["ledger"], { from: null, to: "2026-12-31" }));
      expect(live("transactions")).toEqual(["newer"]);
    });

    it("takes a whole month only when the range covers all of it, at either end", async () => {
      seedCellNote("first-clipped", "2026-03");
      seedCellNote("last-clipped", "2026-06");
      seedCellNote("covered", "2026-04");

      await performDataReset(USER, selection(["ledger"], { from: "2026-03-02", to: "2026-06-29" }));

      expect(live("cell_notes")).toEqual(["first-clipped", "last-clipped"]);
    });

    it("keeps a month whose first day the range starts on", async () => {
      // The boundary the other way round: a range that begins on the 1st and
      // ends on the last day covers those months completely, and must take them.
      seedCellNote("january", "2026-01");
      seedCellNote("december", "2026-12");
      seedCellNote("next-year", "2027-01");

      await performDataReset(USER, selection(["ledger"], { from: "2026-01-01", to: "2026-12-31" }));

      expect(live("cell_notes")).toEqual(["next-year"]);
    });

    it("narrows balance corrections by their own date", async () => {
      seedAdjustment("inside", "2026-05-11");
      seedAdjustment("before", "2025-05-11");
      seedAdjustment("after", "2027-05-11");

      await performDataReset(USER, selection(["ledger"], { from: "2026-01-01", to: "2026-12-31" }));

      expect(live("balance_adjustments")).toEqual(["after", "before"]);
    });

    it("never touches another account's rows", async () =>{
      seedTransaction("mine", { effectiveDate: "2026-05-10" });
      seedTransaction("theirs", { userId: OTHER, effectiveDate: "2026-05-10" });

      await performDataReset(USER, selection(["ledger"]));

      expect(live("transactions")).toEqual([]);
      expect(live("transactions", OTHER)).toEqual(["theirs"]);
    });
  });

  describe("what the ledger scope owns", () => {
    it("takes attachments and the expected payments its rows had settled", async () => {
      seedTransaction("tx", { effectiveDate: "2026-05-10" });
      seedAttachment("file", "tx");
      seedExpected("settled", { transactionId: "tx", status: "paid" });
      seedExpected("open", { transactionId: null, status: "pending" });

      await performDataReset(USER, selection(["ledger"]));

      expect(live("attachments")).toEqual([]);
      // An obligation nothing paid is a forecast from a live rule, not a
      // ledger entry, so the ledger scope leaves it alone.
      expect(live("expected_payments")).toEqual(["open"]);
    });

    it("keeps the marks that name an item rather than a month", async () => {
      seedMatrixColor("row-mark", "row", null);
      seedMatrixColor("column-mark", "column", "2026-05");

      await performDataReset(USER, selection(["ledger"]));

      expect(live("matrix_colors")).toEqual(["row-mark"]);
    });

    it("clears the ledger anchor only when no date bounds it", async () => {
      seedSetting("start_month", '"2020-01"');
      seedSetting("opening_balance_minor", "150000");
      seedSetting("reminder_days", "3");

      await performDataReset(USER, selection(["ledger"], { from: "2026-01-01", to: "2026-12-31" }));
      expect(live("settings").sort()).toContain(`det:setting|${USER}|start_month`);

      await performDataReset(USER, selection(["ledger"]));

      // The anchor goes; every other preference is not ledger data.
      expect(live("settings")).toEqual([`det:setting|${USER}|reminder_days`]);
    });

    it("leaves instalment rows to their own scope", async () => {
      seedPlan("plan");
      seedTransaction("plain", { effectiveDate: "2026-05-10" });
      seedTransaction("instalment", { effectiveDate: "2026-05-10", planId: "plan" });

      await performDataReset(USER, selection(["ledger"]));

      expect(live("transactions")).toEqual(["instalment"]);
      expect(live("installment_plans")).toEqual(["plan"]);
    });
  });

  describe("instalment plans are all or nothing", () => {
    it("takes a plan whose whole schedule is inside the range, with its rows", async () => {
      seedPlan("inside");
      seedTransaction("i1", { effectiveDate: "2026-02-01", planId: "inside" });
      seedTransaction("i2", { effectiveDate: "2026-03-01", planId: "inside" });

      await performDataReset(USER, selection(["installments"], { from: "2026-01-01", to: "2026-12-31" }));

      expect(live("installment_plans")).toEqual([]);
      expect(live("transactions")).toEqual([]);
    });

    it("takes the attachments and settled obligations of the rows it removes", async () => {
      // These belong to the ledger scope for a hand-entered row. A plan's
      // instalments are deliberately NOT the ledger's, so this scope has to own
      // their dependents or nothing does.
      seedPlan("inside");
      seedTransaction("i1", { effectiveDate: "2026-02-01", planId: "inside" });
      seedAttachment("receipt", "i1");
      seedExpected("settled", { transactionId: "i1", status: "paid" });
      seedTransaction("plain", { effectiveDate: "2026-02-01" });
      seedAttachment("kept", "plain");

      const chosen = selection(["installments"], { from: "2026-01-01", to: "2026-12-31" });
      const preview = await previewDataReset(USER, chosen);
      const outcome = await performDataReset(USER, chosen);

      expect(live("attachments")).toEqual(["kept"]);
      expect(live("expected_payments")).toEqual([]);
      expect(preview.total).toBe(outcome.deleted);
    });

    it("refuses to cut a plan in half, and reports that it did not", async () => {
      seedPlan("straddling");
      seedTransaction("in", { effectiveDate: "2026-06-01", planId: "straddling" });
      seedTransaction("out", { effectiveDate: "2027-06-01", planId: "straddling" });

      const range = { from: "2026-01-01", to: "2026-12-31" };
      const preview = await previewDataReset(USER, selection(["installments"], range));
      await performDataReset(USER, selection(["installments"], range));

      expect(preview.straddlingPlans).toBe(1);
      expect(preview.counts.installments).toBe(0);
      expect(live("installment_plans")).toEqual(["straddling"]);
      expect(live("transactions")).toEqual(["in", "out"]);
    });

    it("cannot place a plan with no instalments left, so a dated range leaves it", async () => {
      // A plan whose rows were already removed has no date the range can reach.
      // Sweeping it up would be deleting something the selection never named;
      // an undated reset, which names everything, still takes it.
      seedPlan("empty");

      await performDataReset(USER, selection(["installments"], { from: "2026-01-01", to: "2026-12-31" }));
      expect(live("installment_plans")).toEqual(["empty"]);

      await performDataReset(USER, selection(["installments"]));
      expect(live("installment_plans")).toEqual([]);
    });

    it("has nothing to straddle when no date bounds the reset", async () => {
      seedPlan("whole");
      seedTransaction("w1", { effectiveDate: "2024-02-01", planId: "whole" });
      seedTransaction("w2", { effectiveDate: "2027-02-01", planId: "whole" });

      const preview = await previewDataReset(USER, selection(["installments"]));

      expect(preview.straddlingPlans).toBe(0);
      expect(preview.counts.installments).toBe(3);
    });

    it("leaves a plan sitting entirely outside the range alone", async () => {
      seedPlan("elsewhere");
      seedTransaction("e1", { effectiveDate: "2024-02-01", planId: "elsewhere" });

      await performDataReset(USER, selection(["installments"], { from: "2026-01-01", to: "2026-12-31" }));

      expect(live("installment_plans")).toEqual(["elsewhere"]);
    });
  });

  describe("rules are all or nothing", () => {
    it("takes a subscription with its price history and every obligation it raised", async () => {
      seedSubscription("sub-1");
      seedPriceHistory("price", "sub-1");
      seedExpected("sub-expected", { kind: "subscription", refId: "sub-1" });
      seedExpected("income-expected", { kind: "recurring_income", refId: "inc-1" });

      await performDataReset(USER, selection(["subscriptions"]));

      expect(live("subscriptions")).toEqual([]);
      expect(live("price_history")).toEqual([]);
      expect(live("expected_payments")).toEqual(["income-expected"]);
    });

    it("sweeps a price history whose rule was already gone", async () => {
      // Nothing can display it once no subscription is live, and it would keep
      // syncing as a row belonging to a rule that no longer exists.
      seedSubscription("sub-1");
      seedPriceHistory("orphan", "long-deleted-sub");
      seedPriceHistory("current", "sub-1");

      await performDataReset(USER, selection(["subscriptions"]));

      expect(live("price_history")).toEqual([]);
    });

    it("leaves the payments a subscription already made in the ledger", async () => {
      // The rule is being erased; the money that actually left the account is
      // still what happened, and the ledger is where that is recorded.
      seedSubscription("sub-1");
      seedTransaction("paid", { effectiveDate: "2026-04-01", subscriptionId: "sub-1" });

      await performDataReset(USER, selection(["subscriptions"]));

      expect(live("transactions")).toEqual(["paid"]);
    });

    it("takes a recurring income with the obligations it raised", async () => {
      seedIncome("inc-1");
      seedExpected("income-expected", { kind: "recurring_income", refId: "inc-1" });
      seedSubscription("sub-1");
      seedExpected("sub-expected", { kind: "subscription", refId: "sub-1" });

      await performDataReset(USER, selection(["incomes"]));

      expect(live("recurring_incomes")).toEqual([]);
      expect(live("subscriptions")).toEqual(["sub-1"]);
      // The other rule's obligation is not this scope's to take.
      expect(live("expected_payments")).toEqual(["sub-expected"]);
    });

    it("leaves the income already received in the ledger", async () => {
      seedIncome("inc-1");
      seedTransaction("salary", { effectiveDate: "2026-04-01", type: "income" });

      await performDataReset(USER, selection(["incomes"]));

      expect(live("transactions")).toEqual(["salary"]);
    });

    it("hands each rule scope its own obligations when both are reset", async () => {
      seedSubscription("sub-1");
      seedIncome("inc-1");
      seedExpected("sub-expected", { kind: "subscription", refId: "sub-1" });
      seedExpected("income-expected", { kind: "recurring_income", refId: "inc-1" });

      const chosen = selection(["subscriptions", "incomes"]);
      const preview = await previewDataReset(USER, chosen);
      const outcome = await performDataReset(USER, chosen);

      expect(preview.counts.subscriptions).toBe(2);
      expect(preview.counts.incomes).toBe(2);
      expect(preview.total).toBe(outcome.deleted);
      expect(live("expected_payments")).toEqual([]);
    });

    it("hands a ledger-paid income obligation to the income scope", async () => {
      // The mirror of the subscription case, and the reason the exclusion is
      // written per rule kind rather than as one blanket rule.
      seedIncome("inc-1");
      seedTransaction("salary", { effectiveDate: "2026-05-10", type: "income" });
      seedExpected("shared", { kind: "recurring_income", refId: "inc-1", transactionId: "salary", status: "paid" });

      const chosen = selection(["ledger", "incomes"]);
      const preview = await previewDataReset(USER, chosen);
      const outcome = await performDataReset(USER, chosen);

      expect(preview.counts.ledger).toBe(1);
      expect(preview.counts.incomes).toBe(2);
      expect(preview.total).toBe(outcome.deleted);
    });

    it("names the scopes a date range cannot narrow", async () => {
      // The screen reads this to say so beside the range, so it is part of the
      // contract rather than a note.
      expect([...UNDATED_SCOPES].sort()).toEqual(["incomes", "subscriptions"]);
    });

    it("ignores the range, because a standing rule has no date", async () => {
      seedSubscription("sub-1");

      await performDataReset(USER, selection(["subscriptions"], { from: "1999-01-01", to: "1999-12-31" }));

      expect(live("subscriptions")).toEqual([]);
    });
  });

  describe("budgets", () => {
    it("takes only the months the range fully covers", async () => {
      seedBudget("in", "2026-05");
      seedBudget("out", "2027-05");

      await performDataReset(USER, selection(["budgets"], { from: "2026-01-01", to: "2026-12-31" }));

      expect(live("category_budgets")).toEqual(["out"]);
    });
  });

  describe("counting before committing", () => {
    it("reports per-scope counts that match what the reset then writes", async () => {
      seedTransaction("tx", { effectiveDate: "2026-05-10" });
      seedAdjustment("adj", "2026-05-11");
      seedSubscription("sub-1");
      seedBudget("b", "2026-05");

      const chosen = selection(["ledger", "subscriptions", "budgets"]);
      const preview = await previewDataReset(USER, chosen);
      const outcome = await performDataReset(USER, chosen);

      expect(preview.counts.ledger).toBe(2);
      expect(preview.counts.subscriptions).toBe(1);
      expect(preview.counts.budgets).toBe(1);
      expect(preview.total).toBe(4);
      expect(outcome.deleted).toBe(preview.total);
    });

    it("attributes a row two scopes could claim to exactly one of them", async () => {
      // The subscription's obligation was paid by a ledger row this reset is
      // also taking. Both scopes have a claim on it; the rule's claim wins, and
      // the promise the preview makes is that its total is what gets written —
      // not one more than that.
      seedSubscription("sub-1");
      seedTransaction("tx", { effectiveDate: "2026-05-10", subscriptionId: "sub-1" });
      seedExpected("shared", { kind: "subscription", refId: "sub-1", transactionId: "tx", status: "paid" });

      const chosen = selection(["ledger", "subscriptions"]);
      const preview = await previewDataReset(USER, chosen);
      const outcome = await performDataReset(USER, chosen);

      expect(preview.counts.ledger).toBe(1);
      expect(preview.counts.subscriptions).toBe(2);
      expect(preview.total).toBe(outcome.deleted);
      expect(live("expected_payments")).toEqual([]);
    });

    it("still takes the obligation when only the ledger is reset", async () => {
      // Without a rule scope to claim it, the ledger keeps its own cascade: an
      // obligation must never stay marked paid by a row that is gone.
      seedSubscription("sub-1");
      seedTransaction("tx", { effectiveDate: "2026-05-10", subscriptionId: "sub-1" });
      seedExpected("shared", { kind: "subscription", refId: "sub-1", transactionId: "tx", status: "paid" });

      const chosen = selection(["ledger"]);
      const preview = await previewDataReset(USER, chosen);
      const outcome = await performDataReset(USER, chosen);

      expect(preview.total).toBe(outcome.deleted);
      expect(live("expected_payments")).toEqual([]);
      expect(live("subscriptions")).toEqual(["sub-1"]);
    });

    it("clears the anchor only when the ledger itself is being reset", async () => {
      seedSetting("start_month", '"2020-01"');
      seedSetting("opening_balance_minor", "150000");
      seedBudget("b", "2026-05");

      const withoutLedger = await previewDataReset(USER, selection(["budgets"]));
      const withLedger = await previewDataReset(USER, selection(["ledger"]));

      expect(withoutLedger.clearsLedgerAnchor).toBe(false);
      expect(withLedger.clearsLedgerAnchor).toBe(true);
      expect(withLedger.counts.ledger).toBe(2);
    });

    it("keeps the anchor when the range has only a start", async () => {
      seedSetting("start_month", '"2020-01"');
      seedSetting("opening_balance_minor", "150000");

      const openEnd = await previewDataReset(USER, selection(["ledger"], { from: "2026-01-01", to: null }));
      const openStart = await previewDataReset(USER, selection(["ledger"], { from: null, to: "2026-12-31" }));

      expect(openEnd.clearsLedgerAnchor).toBe(false);
      expect(openStart.clearsLedgerAnchor).toBe(false);
    });

    it("touches nothing outside the scopes that were chosen", async () => {
      seedBudget("b", "2026-05");
      seedSubscription("sub-1");
      seedIncome("inc-1");
      seedPlan("plan");
      seedTransaction("tx", { effectiveDate: "2026-05-10" });

      const preview = await previewDataReset(USER, selection(["ledger"]));
      await performDataReset(USER, selection(["ledger"]));

      expect(preview.counts.budgets).toBe(0);
      expect(preview.counts.subscriptions).toBe(0);
      expect(preview.counts.incomes).toBe(0);
      expect(preview.counts.installments).toBe(0);
      expect(live("category_budgets")).toEqual(["b"]);
      expect(live("subscriptions")).toEqual(["sub-1"]);
      expect(live("recurring_incomes")).toEqual(["inc-1"]);
      expect(live("installment_plans")).toEqual(["plan"]);
    });

    it("writes a reset larger than one batch as a single all-or-nothing unit", async () => {
      // The write is chunked so one statement never carries the whole history.
      // The chunking must not become a seam a failure can land inside.
      for (let index = 0; index < 450; index += 1) {
        seedTransaction(`tx-${String(index).padStart(3, "0")}`, { effectiveDate: "2026-05-10" });
      }

      const outcome = await performDataReset(USER, selection(["ledger"]));

      expect(outcome.deleted).toBe(450);
      expect(live("transactions")).toEqual([]);
      const queued = harness.db!.prepare(`SELECT COUNT(*) AS n FROM outbox`).get() as { n: number };
      expect(Number(queued.n)).toBe(450);
    });

    it("says nothing would happen when nothing matches", async () => {
      const preview = await previewDataReset(USER, selection(["ledger"], { from: "1990-01-01", to: "1990-12-31" }));
      const outcome = await performDataReset(USER, selection(["ledger"], { from: "1990-01-01", to: "1990-12-31" }));

      expect(preview.total).toBe(0);
      expect(preview.blocker).toBeNull();
      expect(outcome.deleted).toBe(0);
    });
  });

  describe("investments are a replay, not a list", () => {
    it("cuts the tail off and leaves a consistent prefix", async () => {
      seedProfile("2026-01-01", 100_000);
      seedProduct();
      seedOperation("early", "2026-02-01", 30_000);
      seedOperation("late", "2026-06-01", 20_000);

      const preview = await previewDataReset(USER, selection(["investments"], { from: "2026-05-01", to: null }));
      await performDataReset(USER, selection(["investments"], { from: "2026-05-01", to: null }));

      expect(preview.counts.investments).toBe(1);
      expect(live("investment_operations")).toEqual(["early"]);
    });

    it("ignores the end of the range, because a prefix is the only safe cut", async () => {
      // Honouring `to` would lift a slice out of the middle and leave a sale of
      // something never bought. The screen says the end is ignored; this is the
      // behaviour it is describing.
      seedProfile("2026-01-01", 100_000);
      seedProduct();
      seedOperation("early", "2026-02-01", 30_000);
      seedOperation("late", "2026-06-01", 20_000);

      await performDataReset(USER, selection(["investments"], { from: "2026-05-01", to: "2026-05-31" }));

      expect(live("investment_operations")).toEqual(["early"]);
    });

    it("keeps the products and the wallet the operations belonged to", async () => {
      // Products are structure, exactly like the table's columns.
      seedProfile("2026-01-01", 100_000);
      seedProduct();
      seedOperation("only", "2026-02-01", 30_000);

      await performDataReset(USER, selection(["investments"]));

      expect(live("investment_operations")).toEqual([]);
      expect(live("investment_products")).toEqual(["gold"]);
      expect(live("investment_profiles")).toEqual(["profile"]);
    });

    it("refuses a ledger reset that would take the cash the wallet already spent", async () => {
      // The transfer is what funded the purchase. Removing it while the
      // purchase stands would leave the wallet holding gold it never paid for.
      seedProfile("2026-01-01", 0);
      seedProduct();
      seedCategory("transfer-cat", { isTransfer: true });
      seedTransaction("funding", {
        effectiveDate: "2026-02-01",
        categoryId: "transfer-cat",
        type: "transfer",
        amountTryMinor: 50_000,
      });
      seedOperation("purchase", "2026-03-01", 40_000);

      const chosen = selection(["ledger"]);
      const preview = await previewDataReset(USER, chosen);

      expect(preview.blocker).toBe("insufficient_cash");
      await expect(performDataReset(USER, chosen)).rejects.toThrow();
      // Refused as one unit: nothing at all was written.
      expect(live("transactions")).toEqual(["funding"]);
    });

    it("accepts the same reset when the investments go with it", async () => {
      seedProfile("2026-01-01", 0);
      seedProduct();
      seedCategory("transfer-cat", { isTransfer: true });
      seedTransaction("funding", {
        effectiveDate: "2026-02-01",
        categoryId: "transfer-cat",
        type: "transfer",
        amountTryMinor: 50_000,
      });
      seedOperation("purchase", "2026-03-01", 40_000);

      const chosen = selection(["ledger", "investments"]);
      const preview = await previewDataReset(USER, chosen);
      await performDataReset(USER, chosen);

      expect(preview.blocker).toBeNull();
      expect(live("transactions")).toEqual([]);
      expect(live("investment_operations")).toEqual([]);
    });

    it("checks the replay when an instalment plan carried the transfer", async () => {
      // A plan whose category is a transfer funds the wallet exactly like a
      // hand-entered one, and the check must reach it through the plan.
      seedProfile("2026-01-01", 0);
      seedProduct();
      seedCategory("transfer-cat", { isTransfer: true });
      seedPlan("funding-plan");
      seedTransaction("i1", {
        effectiveDate: "2026-02-01",
        categoryId: "transfer-cat",
        type: "transfer",
        amountTryMinor: 50_000,
        planId: "funding-plan",
      });
      seedOperation("purchase", "2026-03-01", 40_000);

      const preview = await previewDataReset(USER, selection(["installments"]));

      expect(preview.blocker).toBe("insufficient_cash");
    });

    it("does not block a reset that leaves every investment untouched", async () => {
      // The wallet, its funding and its holdings all exist; the selection just
      // has nothing to do with any of them.
      seedProfile("2026-01-01", 0);
      seedProduct();
      seedCategory("transfer-cat", { isTransfer: true });
      seedTransaction("funding", {
        effectiveDate: "2026-02-01",
        categoryId: "transfer-cat",
        type: "transfer",
        amountTryMinor: 50_000,
      });
      seedOperation("purchase", "2026-03-01", 40_000);
      seedBudget("b", "2026-05");

      const preview = await previewDataReset(USER, selection(["budgets"]));

      expect(preview.blocker).toBeNull();
      expect(preview.counts.budgets).toBe(1);
    });

    it("does not ask the investment ledger about a reset that cannot reach it", async () => {
      // No profile, no operations: a budgets reset must not be refused by a
      // validator that has nothing to validate.
      seedBudget("b", "2026-05");

      const preview = await previewDataReset(USER, selection(["budgets"]));

      expect(preview.blocker).toBeNull();
      expect(preview.counts.budgets).toBe(1);
    });
  });

  describe("the sync contract", () => {
    it("tombstones rather than dropping rows, and queues each one for sync", async () => {
      // A reset that only emptied this device would be undone by the next pull.
      seedTransaction("tx", { effectiveDate: "2026-05-10" });

      await performDataReset(USER, selection(["ledger"]));

      const row = harness.db!.prepare(`SELECT deleted_at, tombstone_version FROM transactions WHERE id = 'tx'`).get() as {
        deleted_at: string | null;
        tombstone_version: number;
      };
      expect(row.deleted_at).toBe(NOW);
      expect(row.tombstone_version).toBe(1);
      const outbox = harness.db!.prepare(`SELECT table_name, row_id, op FROM outbox`).all();
      expect(outbox).toEqual([{ table_name: "transactions", row_id: "tx", op: "upsert" }]);
    });

    it("does not present a reset as the owner's latest entry", async () => {
      // `last_entry_at` drives the catch-up banner. Erasing records is not
      // making one, so the banner must not read a reset as activity.
      seedTransaction("tx", { effectiveDate: "2026-05-10" });

      await performDataReset(USER, selection(["ledger"]));

      const entry = harness
        .db!.prepare(`SELECT id FROM settings WHERE user_id = ? AND key = 'last_entry_at'`)
        .all(USER);
      expect(entry).toEqual([]);
    });
  });
});
