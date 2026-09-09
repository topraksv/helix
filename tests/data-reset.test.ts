import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null, failMaintenance: false }));

vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => ({
    getFirstAsync: async (sql: string, args: unknown[] = []) =>
      harness.db!.prepare(sql).get(...(args as never[])) ?? null,
    getAllAsync: async (sql: string, args: unknown[] = []) =>
      harness.db!.prepare(sql).all(...(args as never[])),
    runAsync: async (sql: string, args: unknown[] = []) => {
      // A tidy-up that fails after the delete has committed, injected where a
      // failure actually happens: the maintenance pass's own bookkeeping write.
      //
      // NOT by mocking `./maintenance`. Every assertion in this file about
      // what a reset leaves behind runs the REAL pass over the real database,
      // and replacing that module — even with a spread of the original — costs
      // Stryker the per-test coverage it attributes through it. Measured
      // 2026-09-09: the file fell from 48.02 to 43.03 with nothing about it
      // changed except this mock.
      if (harness.failMaintenance && args.includes("cc_column_removed")) {
        throw new Error("injected maintenance failure");
      }
      return { changes: Number(harness.db!.prepare(sql).run(...(args as never[])).changes) };
    },
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
// The reset ends by running the maintenance pass, which reaches the rate
// services — and those reach `react-native` for `Platform`. Stubbed the way
// `maintenance-repairs.test.ts` already stubs them, so this suite keeps
// exercising the real reset and the real maintenance over a real database.
vi.mock("../src/services/fx-fetch", () => ({ lookupRate: vi.fn() }));
vi.mock("../src/services/markets", () => ({ marketSellRateTry: vi.fn() }));
// The reset and the pass it ends with both record what they could not do, and
// the recorder reaches the device store. Stubbed for the same reason as above.
vi.mock("../src/services/logger", () => ({ devWarning: vi.fn(), devError: vi.fn() }));

import {
  performDataReset,
  previewDataReset,
  RESET_SCOPES,
  UNDATED_SCOPES,
  type ResetRange,
  type ResetSelection,
} from "../src/data/repo/reset";
import { RELATIONS } from "../src/db/relations";
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
    cardStatementId?: string | null;
    paymentSourceId?: string | null;
    purchaseDate?: string | null;
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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'TRY', NULL, ?, ?, ?, ?, 'realized', ?, ?, 'self', ?, NULL, ?, ?, 0, NULL)`,
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
      options.purchaseDate ?? null,
      options.effectiveDate ?? "2026-05-10",
      options.categoryId ?? null,
      options.paymentSourceId ?? null,
      options.planId ?? null,
      options.cardStatementId ?? null,
      options.subscriptionId ?? null,
    ],
  );
}

/** The card a statement is billed against. Structure: no scope takes it. */
function seedSource(id = "card"): void {
  run(
    `INSERT INTO payment_sources (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       name, type, person_id, due_day, statement_day, color, logo_source, logo_ref, is_active)
     VALUES (?, ?, ?, ?, NULL, 0, ?, 'credit_card', 'self', 10, 25, NULL, 'initials', NULL, 1)`,
    [id, USER, NOW, NOW, id],
  );
}

/** A billed period. Nothing displays one that has no lines left on it. */
function seedStatement(id: string, periodMonth = "2026-05", sourceId = "card"): void {
  run(
    `INSERT INTO credit_card_statements (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       payment_source_id, period_month, statement_date, due_date)
     VALUES (?, ?, ?, ?, NULL, 0, ?, ?, ?, ?)`,
    [id, USER, NOW, NOW, sourceId, periodMonth, `${periodMonth}-25`, `${periodMonth}-10`],
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
       started_on, opening_cash_minor)
     VALUES ('profile', ?, ?, ?, NULL, 0, ?, ?)`,
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

/**
 * Live rows of a table with the columns a test needs to judge them.
 *
 * `live` answers with ids, which stopped being enough once the reset began
 * ending in the maintenance pass: several of these assertions are about what
 * the workspace looks like AFTERWARDS, and an obligation regenerated as
 * `pending` is a different fact from the settled one that was deleted even
 * though both are rows in the same table.
 */
function liveRows<T extends Record<string, unknown>>(table: string, columns: string, userId = USER): T[] {
  return harness
    .db!.prepare(`SELECT ${columns} FROM ${table} WHERE user_id = ? AND deleted_at IS NULL ORDER BY id`)
    .all(userId) as T[];
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
    harness.failMaintenance = false;
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

      // The anchor goes; every other preference is not ledger data. Named
      // rather than compared as a whole list, because the maintenance pass the
      // reset now ends with writes bookkeeping flags of its own — pinning the
      // exact set would fail this test for a reason unrelated to the anchor.
      const settings = live("settings");
      expect(settings).toContain(`det:setting|${USER}|reminder_days`);
      expect(settings).not.toContain(`det:setting|${USER}|start_month`);
      expect(settings).not.toContain(`det:setting|${USER}|opening_balance_minor`);
      expect(settings).not.toContain(`det:setting|${USER}|balance_declared`);
    });

    /**
     * The hole a full reset used to leave behind, and the reason a workspace
     * the owner had just cleared still showed a balance: a row pointing at a
     * plan that is already tombstoned belonged to NEITHER scope. The ledger
     * refused it because the column was not null; the instalment scope refused
     * it because there was no live plan to claim it.
     */
    it("takes an instalment row whose plan no longer exists", async () => {
      seedPlan("gone");
      run(`UPDATE installment_plans SET deleted_at = ? WHERE id = 'gone'`, [NOW]);
      seedTransaction("orphan", { effectiveDate: "2026-05-10", planId: "gone" });
      seedTransaction("plain", { effectiveDate: "2026-05-10" });

      const preview = await previewDataReset(USER, selection(["ledger"]));
      expect(preview.counts.ledger).toBe(2);

      await performDataReset(USER, selection(["ledger"]));
      expect(live("transactions")).toEqual([]);
    });

    it("still counts an orphan exactly once when both scopes are reset", async () => {
      seedPlan("gone");
      run(`UPDATE installment_plans SET deleted_at = ? WHERE id = 'gone'`, [NOW]);
      seedTransaction("orphan", { effectiveDate: "2026-05-10", planId: "gone" });

      const preview = await previewDataReset(USER, selection(["ledger", "installments"]));
      expect(preview.total).toBe(1);
      const outcome = await performDataReset(USER, selection(["ledger", "installments"]));
      expect(outcome.deleted).toBe(1);
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
      // The other rule's obligation is not this scope's to take. Asserted by
      // KIND rather than as an exact list: the maintenance pass that now ends
      // every reset raises fresh obligations for rules that survived, and
      // `sub-1` is one. What must be true is that nothing is left standing for
      // an income rule that no longer exists.
      const obligations = liveRows<{ id: string; kind: string }>("expected_payments", "id, kind");
      expect(obligations.map((row) => row.id)).toContain("sub-expected");
      expect(obligations.filter((row) => row.kind === "recurring_income")).toEqual([]);
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
      expect(live("subscriptions")).toEqual(["sub-1"]);
      // The settled obligation is gone, and what the surviving rule has now is
      // an unpaid one. That is the end state this scope's own comment promises
      // — "the rule still stands, the payment does not" — and it is reachable
      // to assert because the reset runs the maintenance pass rather than
      // leaving the workspace inconsistent until the next foreground.
      const obligations = liveRows<{ id: string; status: string }>("expected_payments", "id, status");
      expect(obligations.map((row) => row.id)).not.toContain("shared");
      expect(obligations.every((row) => row.status !== "paid")).toBe(true);
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
      // Counted for THIS table: the maintenance pass that ends every reset
      // queues its own rows too, and a total over the whole outbox would be
      // measuring both. What this test is about is that no chunk was lost.
      const queued = harness
        .db!.prepare(`SELECT COUNT(*) AS n FROM outbox WHERE table_name = 'transactions'`)
        .get() as { n: number };
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

    /**
     * The half of the anchor rule that was missing.
     *
     * A ledger reset over every date clears the opening balance; the wallet's
     * opening cash is the same kind of claim and used to survive, so clearing
     * every operation handed the free balance the money those operations had
     * spent. The owner reported it as the products going and the cash that
     * bought them coming back.
     */
    it("clears the wallet's opening cash when every operation goes", async () => {
      seedProfile("2026-01-01", 100_000);
      seedProduct();
      seedOperation("only", "2026-02-01", 30_000);

      const preview = await previewDataReset(USER, selection(["investments"]));
      await performDataReset(USER, selection(["investments"]));

      expect(preview.clearsInvestmentWallet).toBe(true);
      // The operation and the wallet row: both are writes, both are counted.
      expect(preview.counts.investments).toBe(2);
      const wallet = liveRows<{ opening_cash_minor: number; started_on: string }>(
        "investment_profiles",
        "id, opening_cash_minor, started_on",
      );
      expect(wallet).toEqual([{ id: "profile", opening_cash_minor: 0, started_on: "2026-01-01" }]);
    });

    /**
     * `started_on` deliberately stays put, and this is the trap: advancing it
     * to today looks like a tidy way to drop the transfers that funded the
     * wallet, but a transfer OUT dated today would then be subtracted from a
     * wallet declared empty this morning — and the day someone clears their
     * investments is the day they have just moved the balance out of them.
     */
    it("leaves the wallet alone when the range only cuts a tail", async () => {
      seedProfile("2026-01-01", 100_000);
      seedProduct();
      seedOperation("early", "2026-02-01", 10_000);
      seedOperation("late", "2026-06-01", 10_000);

      const preview = await previewDataReset(USER, selection(["investments"], { from: "2026-05-01", to: null }));
      await performDataReset(USER, selection(["investments"], { from: "2026-05-01", to: null }));

      expect(preview.clearsInvestmentWallet).toBe(false);
      const wallet = liveRows<{ opening_cash_minor: number }>("investment_profiles", "id, opening_cash_minor");
      expect(wallet).toEqual([{ id: "profile", opening_cash_minor: 100_000 }]);
    });

    it("says nothing about a wallet that is already empty", async () => {
      seedProfile("2026-01-01", 0);
      seedProduct();
      seedOperation("only", "2026-02-01", 0 + 1);

      const preview = await previewDataReset(USER, selection(["investments"]));

      // One write, not two: a row already at zero is not rewritten, not synced
      // and not counted in a total the owner reads as "records to be deleted".
      expect(preview.counts.investments).toBe(1);
      expect(preview.clearsInvestmentWallet).toBe(false);
    });

    /**
     * The reported case end to end. Clearing both scopes takes the transfers
     * with the ledger and the opening figure with the wallet, so the free
     * balance the replay produces afterwards is zero rather than the money the
     * deleted purchases had spent.
     */
    it("leaves nothing in the wallet when the ledger goes with it", async () => {
      seedCategory("transfer-cat", { isTransfer: true });
      seedProfile("2026-01-01", 20_000);
      seedProduct();
      seedTransaction("funding", {
        effectiveDate: "2026-03-01",
        type: "transfer",
        categoryId: "transfer-cat",
        amountTryMinor: 50_000,
      });
      seedOperation("bought", "2026-03-02", 70_000);

      const chosen = selection(["ledger", "investments"]);
      const preview = await previewDataReset(USER, chosen);
      await performDataReset(USER, chosen);

      expect(preview.blocker).toBeNull();
      expect(live("investment_operations")).toEqual([]);
      expect(live("transactions")).toEqual([]);
      const wallet = liveRows<{ opening_cash_minor: number }>("investment_profiles", "id, opening_cash_minor");
      expect(wallet).toEqual([{ id: "profile", opening_cash_minor: 0 }]);
    });

    /**
     * Refused in the PREVIEW rather than as a failure after the confirmation.
     * A wallet that opened with 20.000 and has since sent 50.000 back to the
     * Mali Tablo cannot be re-declared as having opened with nothing, and
     * `movesInvestments` now asks about exactly this selection.
     */
    it("refuses to empty a wallet that more has left than it opened with", async () => {
      seedCategory("transfer-cat", { isTransfer: true });
      seedProfile("2026-01-01", 20_000);
      seedTransaction("cash-out", {
        effectiveDate: "2026-03-01",
        type: "transfer",
        categoryId: "transfer-cat",
        amountTryMinor: -50_000,
      });

      const preview = await previewDataReset(USER, selection(["investments"]));

      expect(preview.blocker).toBe("insufficient_cash");
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

  /**
   * What a reset leaves behind that no selector claims.
   *
   * A credit-card statement is a record of a billed period, and it is the
   * parent of its lines rather than a dependent of them, so none of the scopes
   * above take it. Clearing the ledger therefore left every statement standing
   * over lines that no longer existed — rows of ₺0 on the payment-source
   * screen. The sweep already existed in the maintenance pass; what was
   * missing was the reset running it, which is also what regenerates the
   * obligations this module tombstones on purpose.
   */
  describe("what the maintenance pass tidies afterwards", () => {
    it("takes a card statement whose every line the reset removed", async () => {
      seedSource();
      seedStatement("stmt");
      seedTransaction("line", { effectiveDate: "2026-05-10", cardStatementId: "stmt" });

      await performDataReset(USER, selection(["ledger"]));

      expect(live("transactions")).toEqual([]);
      expect(live("credit_card_statements")).toEqual([]);
    });

    it("keeps a statement whose lines the range did not reach", async () => {
      seedSource();
      seedStatement("kept", "2026-09");
      seedTransaction("line", { effectiveDate: "2026-09-10", cardStatementId: "kept" });

      await performDataReset(USER, selection(["ledger"], { from: "2026-01-01", to: "2026-06-30" }));

      expect(live("transactions")).toEqual(["line"]);
      expect(live("credit_card_statements")).toEqual(["kept"]);
    });
  });

  /**
   * Every combination of scopes, against the rule the module opens with.
   *
   * Sixty-three subsets is more than anyone will reason about one at a time,
   * and reasoning one at a time is how the two defects above survived: the
   * ledger owned a cascade, the investments scope owned a tail, and nobody
   * asked what "ledger AND investments but not subscriptions" leaves behind.
   * So the permutations are enumerated and the INVARIANT is asserted rather
   * than the outcome — a per-case expectation would be sixty-three more
   * things to keep true.
   *
   * The invariant is the module's second rule, made checkable: a scope owns
   * its dependents, so nothing that outlives a reset may point at something
   * that did not. Deliberate exceptions are named in `KEPT_PROVENANCE` rather
   * than quietly excluded, because each one is a decision.
   */
  describe("no combination leaves a dangling reference", () => {
    /**
     * References a reset is ALLOWED to leave hanging, and why.
     *
     * A paid subscription invoice stays in the Mali Tablo when the rule is
     * reset — the scope hint promises exactly that — and it keeps the rule id
     * it was raised from. That id is provenance, not a lookup: every consumer
     * of it already treats a missing rule as "no record to point at".
     */
    const KEPT_PROVENANCE = new Set(["transactions.subscription_id"]);

    /** One of everything, wired to everything else it can be wired to. */
    function seedWholeWorkspace(): void {
      seedSource();
      seedPlan("plan");
      seedSubscription("sub");
      seedIncome("inc");
      seedPriceHistory("price", "sub");
      seedStatement("stmt");
      seedBudget("budget", "2026-05");
      seedCellNote("note", "2026-05");
      seedMatrixColor("mark-cell", "cell", "2026-05");
      seedMatrixColor("mark-row", "row", null);
      seedAdjustment("adj", "2026-05-02");
      seedProfile("2026-01-01", 100_000);
      seedProduct();
      seedOperation("op", "2026-02-01", 10_000);

      seedTransaction("plain", { effectiveDate: "2026-05-10", categoryId: "cat-1" });
      // On the card and already billed, so the statement has a line to lose.
      seedTransaction("carded", {
        effectiveDate: "2026-05-11",
        paymentSourceId: "card",
        cardStatementId: "stmt",
      });
      seedTransaction("from-sub", { effectiveDate: "2026-05-12", subscriptionId: "sub" });
      // On the card and NOT billed yet: this is what makes the maintenance
      // pass's statement repair run, which the reset now reaches. Without a
      // card behind it the repair found no candidates and every permutation
      // was quietly measuring a workspace with no cards in it at all.
      seedTransaction("instalment", {
        effectiveDate: "2026-05-13",
        paymentSourceId: "card",
        planId: "plan",
      });
      seedTransaction("unbilled", {
        effectiveDate: "2026-06-10",
        paymentSourceId: "card",
        purchaseDate: "2026-05-28",
      });

      seedAttachment("doc-plain", "plain");
      seedAttachment("doc-instalment", "instalment");
      seedExpected("exp-sub", { kind: "subscription", refId: "sub", transactionId: "from-sub", status: "paid" });
      seedExpected("exp-inc", { kind: "recurring_income", refId: "inc" });
      seedExpected("exp-plain", { kind: "subscription", refId: "sub", transactionId: "plain", status: "paid" });
    }

    /** Ids of the rows a table still has, live or not — a tombstone is gone. */
    function liveIds(table: string): Set<string> {
      return new Set(live(table));
    }

    function danglingReferences(): string[] {
      const found: string[] = [];
      for (const [table, column, target] of RELATIONS) {
        const key = `${table}.${column}`;
        if (KEPT_PROVENANCE.has(key)) continue;
        const parents = liveIds(target);
        const rows = liveRows<Record<string, unknown>>(table, `id, ${column}`);
        for (const row of rows) {
          const reference = row[column];
          if (reference == null) continue;
          if (!parents.has(String(reference))) found.push(`${key} -> ${String(reference)} (row ${String(row.id)})`);
        }
      }
      return found;
    }

    /** Every non-empty subset of the six scopes, smallest first. */
    const combinations = Array.from({ length: 2 ** RESET_SCOPES.length - 1 }, (_, index) =>
      RESET_SCOPES.filter((_scope, bit) => ((index + 1) >> bit) & 1),
    );

    /**
     * Both ends of the range question, because they fail differently.
     *
     * Unbounded is where the anchors go and where whole-scope cascades run.
     * A bounded range is where a cascade can run HALF way — the plan the range
     * cuts through, the month a note only partly belongs to, the operation
     * tail — and that is the side a hand-written case is least likely to
     * cover. The bounds deliberately cut through the seeded month rather than
     * enclosing it.
     */
    const ranges: readonly (readonly [string, ResetRange])[] = [
      ["every date", ALL_DATES],
      ["a range that cuts through the data", { from: "2026-05-11", to: "2026-08-31" }],
    ];

    const cases = combinations.flatMap((scopes) =>
      ranges.map(([label, range]) => [`${scopes.join("+")} over ${label}`, scopes, range] as const),
    );

    it.each(cases)("leaves a consistent workspace after resetting %s", async (_name, scopes, range) => {
      seedWholeWorkspace();

      const chosen = selection(scopes, range);
      const preview = await previewDataReset(USER, chosen);
      const outcome = await performDataReset(USER, chosen);

      // The scopes are kept disjoint rather than overlapping-and-deduplicated,
      // and this is the only assertion that holds them to it across every
      // combination: a row two scopes both claimed would be written once and
      // counted twice, and the count is what a person approves.
      expect(preview.total).toBe(outcome.deleted);
      expect(danglingReferences()).toEqual([]);
      // A statement with no lines left displays as a row of ₺0 and answers
      // nothing. The maintenance pass the reset ends with owns this sweep.
      const lines = liveRows<{ card_statement_id: string | null }>("transactions", "id, card_statement_id");
      for (const statement of live("credit_card_statements")) {
        expect(
          lines.some((row) => row.card_statement_id === statement),
          `statement ${statement} kept with no lines`,
        ).toBe(true);
      }
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
      const outbox = harness
        .db!.prepare(`SELECT table_name, row_id, op FROM outbox WHERE table_name = 'transactions'`)
        .all();
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

  /**
   * The delete is committed by the time the sweep runs, so a sweep that fails
   * must not turn a finished reset into a failure. It did: the owner was told
   * "hiçbir şey silinmedi; tekrar dene" with every row already gone, and
   * pressing again found nothing left to delete.
   */
  describe("when the tidy-up after the delete fails", () => {
    it("still reports the rows as deleted, and says the sweep did not finish", async () => {
      seedTransaction("gone", { effectiveDate: "2026-05-10" });
      harness.failMaintenance = true;

      const outcome = await performDataReset(USER, selection(["ledger"]));

      expect(outcome.deleted).toBe(1);
      expect(outcome.tidied).toBe(false);
      expect(live("transactions")).toEqual([]);
    });

    it("says the sweep finished when it did", async () => {
      seedTransaction("gone", { effectiveDate: "2026-05-10" });
      const outcome = await performDataReset(USER, selection(["ledger"]));
      expect(outcome).toEqual({ deleted: 1, tidied: true });
    });

    it("reports a selection with nothing in it as tidy, having run no sweep", async () => {
      harness.failMaintenance = true;
      await expect(performDataReset(USER, selection(["ledger"]))).resolves.toEqual({ deleted: 0, tidied: true });
    });
  });

  /**
   * The whole promise of "everything, all dates", stated as the only figure
   * the owner actually checks.
   *
   * Every assertion above is about one table. This one asks the question the
   * owner asks — is the balance zero — and it is the question that caught the
   * orphaned instalment rows: each table looked emptied and the dashboard
   * still showed money.
   */
  describe("after everything, all dates", () => {
    it("leaves nothing behind that a balance can be computed from", async () => {
      seedSetting("start_month", '"2020-01"');
      seedSetting("opening_balance_minor", "150000");
      seedSetting("balance_declared", '{"minor":150000,"at":"2026-01-01"}');
      seedTransaction("typed", { effectiveDate: "2024-03-04", amountTryMinor: 40_000 });
      seedTransaction("future", { effectiveDate: "2027-01-04", amountTryMinor: 9_000 });
      seedPlan("live");
      seedTransaction("instalment", { effectiveDate: "2026-02-01", planId: "live" });
      seedPlan("gone");
      run(`UPDATE installment_plans SET deleted_at = ? WHERE id = 'gone'`, [NOW]);
      seedTransaction("orphan", { effectiveDate: "2025-07-10", planId: "gone", amountTryMinor: 12_345 });
      seedAdjustment("adjustment", "2025-09-09");
      seedSource();
      seedStatement("statement");
      seedSubscription("sub-1");
      seedIncome("inc-1");
      seedBudget("budget", "2026-03");
      seedProfile("2026-01-01", 500_00);

      await performDataReset(USER, selection([...RESET_SCOPES]));

      expect(live("transactions")).toEqual([]);
      expect(live("balance_adjustments")).toEqual([]);
      const settings = live("settings");
      for (const key of ["start_month", "opening_balance_minor", "balance_declared"]) {
        expect(settings, key).not.toContain(`det:setting|${USER}|${key}`);
      }
      // The structure the reset promises to keep is still standing, so this is
      // an emptied workspace rather than a dismantled one.
      expect(live("categories")).toEqual(["cat-1"]);
      expect(live("payment_sources")).toEqual(["card"]);
      expect(live("investment_profiles")).toEqual(["profile"]);
    });
  });
});
