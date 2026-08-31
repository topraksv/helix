/**
 * Bulk data reset: erase a chosen slice of the workspace without touching the
 * shape of it.
 *
 * The rule behind every decision below is that STRUCTURE SURVIVES and ENTRIES
 * DO NOT. Categories, computed columns, the per-year column layout, people,
 * payment sources and investment products are how a workspace is built; a reset
 * that took them would leave the owner rebuilding the table rather than
 * emptying it. Everything this module deletes is a record of something that
 * happened.
 *
 * The second rule is that a scope owns its dependents. A reference left
 * dangling by a partial delete is worse than either extreme — an attachment on
 * a transaction that no longer exists, an expected payment marked paid by a
 * deleted row — so each scope names its own cascade, and those cascades match
 * the single-row deletes that already exist: `deletePlan` takes a plan with its
 * whole schedule, `deleteRuleWithExpected` takes a rule with its obligations.
 *
 * Nothing here hard-deletes. Every row is tombstoned through the normal write
 * path, so a reset reaches the account's other devices like any other edit — a
 * reset that only emptied THIS device would be undone by the next pull.
 */

import { getSqliteAsync } from "../../db/client";
import { fromDbShape, nowIso, writeRowBatchesAtomically, type RowWrite } from "../../db/mutations";
import type { SyncedTableName } from "../../db/schema";
import { addMonthsToKey, firstDayOf, lastDayOf, monthKeyOf, type ISODate, type MonthKey } from "../../domain/dates";
import { assertInvestmentWrites } from "./investment-validation";
import { InvestmentDomainError } from "../../domain/investments";

/**
 * What a reset can be asked to clear.
 *
 * Named after what the owner sees rather than after tables: "Mali Tablo
 * entries" is one decision even though it reaches six of them.
 */
export type ResetScope =
  | "ledger"
  | "installments"
  | "subscriptions"
  | "incomes"
  | "budgets"
  | "investments";

export const RESET_SCOPES = ["ledger", "installments", "subscriptions", "incomes", "budgets", "investments"] as const;

/**
 * Scopes a date range does not apply to.
 *
 * A rule is a standing instruction, not an entry: a subscription has no date at
 * which it "happened", so narrowing it by one would be inventing a meaning.
 * These two are all-or-nothing, and the screen says so rather than leaving the
 * range looking as though it did something.
 */
export const UNDATED_SCOPES: readonly ResetScope[] = ["subscriptions", "incomes"];

/** Both ends optional; both null means the whole history. */
export interface ResetRange {
  from: ISODate | null;
  to: ISODate | null;
}

export interface ResetSelection {
  scopes: readonly ResetScope[];
  range: ResetRange;
}

export interface ResetPreview {
  /** Rows that would be tombstoned, by the scope that claims them. */
  counts: Record<ResetScope, number>;
  total: number;
  /**
   * Instalment plans the range cuts through, and therefore does not touch.
   *
   * Reported rather than silently skipped: someone who selected a year and
   * expected a plan to go with it needs to know why it did not.
   */
  straddlingPlans: number;
  /** Whether the opening balance and start month go with it. */
  clearsLedgerAnchor: boolean;
  /**
   * The investment ledger's own refusal code, or null when it does not object.
   *
   * The caller turns it into a sentence; this layer does not own wording.
   */
  blocker: string | null;
}

export interface ResetOutcome {
  deleted: number;
}

interface Predicate {
  sql: string;
  args: string[];
}

interface ScopeSelector {
  scope: ResetScope;
  table: SyncedTableName;
  /** A predicate over the alias `t`, whose first `?` is the user id. */
  where: string;
  args: string[];
}

/**
 * Month keys the range covers ENTIRELY; a half-covered month is not covered.
 *
 * A note or a mark belongs to a whole month. Deleting one because the range
 * clipped the first week of it would be erasing a record of days the owner did
 * not select, which is the one thing a reset must never do.
 */
function monthBounds(range: ResetRange): { min: MonthKey | null; max: MonthKey | null } {
  const min = range.from == null
    ? null
    : firstDayOf(monthKeyOf(range.from)) === range.from
      ? monthKeyOf(range.from)
      : addMonthsToKey(monthKeyOf(range.from), 1);
  const max = range.to == null
    ? null
    : lastDayOf(monthKeyOf(range.to)) === range.to
      ? monthKeyOf(range.to)
      : addMonthsToKey(monthKeyOf(range.to), -1);
  return { min, max };
}

/** `AND col >= ? AND col <= ?`, with whichever ends the range actually has. */
function within(column: string, low: string | null, high: string | null): Predicate {
  const sql: string[] = [];
  const args: string[] = [];
  if (low != null) {
    sql.push(` AND ${column} >= ?`);
    args.push(low);
  }
  if (high != null) {
    sql.push(` AND ${column} <= ?`);
    args.push(high);
  }
  return { sql: sql.join(""), args };
}

/** The negation, as a standalone boolean. `0` when the range covers everything. */
function outside(column: string, low: string | null, high: string | null): Predicate {
  const parts: string[] = [];
  const args: string[] = [];
  if (low != null) {
    parts.push(`${column} < ?`);
    args.push(low);
  }
  if (high != null) {
    parts.push(`${column} > ?`);
    args.push(high);
  }
  return { sql: parts.length > 0 ? `(${parts.join(" OR ")})` : "0", args };
}

/**
 * Plain ledger rows: what a person typed, imported or confirmed into a month.
 *
 * Instalments are excluded by `installment_plan_id IS NULL`, because a plan is
 * its own scope. Deleting half a schedule would leave a loan whose remaining
 * rows no longer add up to it — a Taksitler screen with holes in it, which is
 * worse than either keeping or removing the whole plan.
 *
 * `owner` is how the alias binds to the account: `"?"` at the top level, or the
 * outer alias when this predicate is nested in an `EXISTS`. Passing it in is
 * what keeps one definition of "a ledger row in range" instead of two that can
 * drift apart.
 */
function ledgerRowsIn(range: ResetRange, alias: string, owner: string): Predicate {
  const bounds = within(`${alias}.effective_date`, range.from, range.to);
  return {
    sql: `${alias}.user_id = ${owner} AND ${alias}.deleted_at IS NULL AND ${alias}.installment_plan_id IS NULL${bounds.sql}`,
    args: bounds.args,
  };
}

/**
 * Plans whose WHOLE schedule the range covers.
 *
 * A bounded range additionally requires the plan to have at least one
 * instalment inside it, so a plan sitting entirely outside the selection is not
 * swept up by a `NOT EXISTS` that is vacuously true for it.
 */
function wholePlansIn(range: ResetRange, alias: string, owner: string): Predicate {
  const beyond = outside("x.effective_date", range.from, range.to);
  const inside = within("x.effective_date", range.from, range.to);
  const schedule = (extra: string) =>
    `SELECT 1 FROM transactions x
       WHERE x.user_id = ${alias}.user_id AND x.installment_plan_id = ${alias}.id AND x.deleted_at IS NULL${extra}`;
  const bounded = range.from != null || range.to != null;
  return {
    sql: `${alias}.user_id = ${owner} AND ${alias}.deleted_at IS NULL
      AND NOT EXISTS (${schedule(` AND ${beyond.sql}`)})${bounded ? `
      AND EXISTS (${schedule(inside.sql)})` : ""}`,
    args: bounded ? [...beyond.args, ...inside.args] : beyond.args,
  };
}

/**
 * The expected-payment kinds a rule scope in this selection already claims.
 *
 * Scopes are kept disjoint rather than overlapping-and-deduplicated, because
 * the counts a person is shown before confirming come from the same selectors:
 * a row two scopes both claim would be written once and counted twice.
 */
function claimedByRules(chosen: ReadonlySet<ResetScope>): string {
  const kinds: string[] = [];
  if (chosen.has("subscriptions")) kinds.push("'subscription'");
  if (chosen.has("incomes")) kinds.push("'recurring_income'");
  return kinds.length > 0 ? ` AND t.kind NOT IN (${kinds.join(", ")})` : "";
}

/**
 * Every table a reset reaches, in the order rows are collected.
 *
 * Order matters for attribution only: a row already claimed by an earlier scope
 * is not counted again under a later one, so the totals shown add up to the
 * number of rows actually written.
 */
function selectorsFor(selection: ResetSelection): ScopeSelector[] {
  const chosen = new Set(selection.scopes);
  const { range } = selection;
  const months = monthBounds(range);
  const selectors: ScopeSelector[] = [];

  if (chosen.has("ledger")) {
    const rows = ledgerRowsIn(range, "t", "?");
    const nested = ledgerRowsIn(range, "x", "t.user_id");
    const dates = within("t.date", range.from, range.to);
    const noteMonths = within("t.month", months.min, months.max);
    selectors.push(
      { scope: "ledger", table: "transactions", where: rows.sql, args: rows.args },
      {
        // A document survives only as long as the record it documents. Its file
        // on disk is swept by the maintenance pass, which keeps only the files
        // a live row still names.
        scope: "ledger",
        table: "attachments",
        where: `t.user_id = ? AND t.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM transactions x WHERE x.id = t.transaction_id AND ${nested.sql})`,
        args: nested.args,
      },
      {
        // An obligation whose payment is being erased must not stay marked paid
        // against a row that no longer exists. Tombstoned rather than reverted
        // to pending: an auto-paying subscription reads "pending" as an
        // instruction to write the very transaction this reset just removed. A
        // future-dated one is regenerated by the next maintenance pass, which is
        // the correct end state — the rule still stands, the payment does not.
        //
        // `claimedByRules` is what keeps the scopes DISJOINT: an obligation
        // belonging to a rule that is also being reset is that rule's row, not
        // this one's. Two scopes claiming it would not delete it twice, but the
        // preview would count it twice — and a preview that overstates what it
        // is about to do is the one number a person cannot check afterwards.
        scope: "ledger",
        table: "expected_payments",
        where: `t.user_id = ? AND t.deleted_at IS NULL AND t.transaction_id IS NOT NULL${claimedByRules(chosen)}
          AND EXISTS (SELECT 1 FROM transactions x WHERE x.id = t.transaction_id AND ${nested.sql})`,
        args: nested.args,
      },
      {
        scope: "ledger",
        table: "balance_adjustments",
        where: `t.user_id = ? AND t.deleted_at IS NULL${dates.sql}`,
        args: dates.args,
      },
      {
        scope: "ledger",
        table: "cell_notes",
        where: `t.user_id = ? AND t.deleted_at IS NULL${noteMonths.sql}`,
        args: noteMonths.args,
      },
      {
        // Row marks name an item and no date, so they are part of the table's
        // shape and survive. Cell and column marks name a month and go with it.
        scope: "ledger",
        table: "matrix_colors",
        where: `t.user_id = ? AND t.deleted_at IS NULL AND t.scope IN ('cell', 'column')
          AND t.month IS NOT NULL${noteMonths.sql}`,
        args: noteMonths.args,
      },
    );
  }

  if (chosen.has("installments")) {
    const plans = wholePlansIn(range, "t", "?");
    const nested = wholePlansIn(range, "p", "t.user_id");
    /** A ledger row belonging to a plan this reset takes, under any alias. */
    const planRowsAs = (alias: string) =>
      `${alias}.user_id = t.user_id AND ${alias}.deleted_at IS NULL AND ${alias}.installment_plan_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM installment_plans p WHERE p.id = ${alias}.installment_plan_id AND ${
        wholePlansIn(range, "p", `${alias}.user_id`).sql
      })`;
    const planRows = `t.user_id = ? AND t.deleted_at IS NULL AND t.installment_plan_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM installment_plans p WHERE p.id = t.installment_plan_id AND ${nested.sql})`;
    selectors.push(
      { scope: "installments", table: "installment_plans", where: plans.sql, args: plans.args },
      { scope: "installments", table: "transactions", where: planRows, args: nested.args },
      // The same two dependents the ledger scope owns, for the rows this scope
      // owns instead. They were the ledger's only because that is where they
      // were first written down, and a plan's instalments are deliberately not
      // the ledger's — so without these an attachment and a settled obligation
      // would both outlive the row they belong to.
      {
        scope: "installments",
        table: "attachments",
        where: `t.user_id = ? AND t.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM transactions y WHERE y.id = t.transaction_id AND ${planRowsAs("y")})`,
        args: nested.args,
      },
      {
        scope: "installments",
        table: "expected_payments",
        where: `t.user_id = ? AND t.deleted_at IS NULL AND t.transaction_id IS NOT NULL${claimedByRules(chosen)}
          AND EXISTS (SELECT 1 FROM transactions y WHERE y.id = t.transaction_id AND ${planRowsAs("y")})`,
        args: nested.args,
      },
    );
  }

  if (chosen.has("subscriptions")) {
    selectors.push(
      { scope: "subscriptions", table: "subscriptions", where: `t.user_id = ? AND t.deleted_at IS NULL`, args: [] },
      {
        // Every live price history, not only the ones whose rule is going. This
        // scope takes every live subscription, so anything still standing
        // afterwards belongs to a rule that no longer exists — a row nothing
        // can display, which would survive the reset and keep syncing.
        scope: "subscriptions",
        table: "price_history",
        where: `t.user_id = ? AND t.deleted_at IS NULL`,
        args: [],
      },
      {
        scope: "subscriptions",
        table: "expected_payments",
        where: `t.user_id = ? AND t.deleted_at IS NULL AND t.kind = 'subscription'`,
        args: [],
      },
    );
  }

  if (chosen.has("incomes")) {
    selectors.push(
      { scope: "incomes", table: "recurring_incomes", where: `t.user_id = ? AND t.deleted_at IS NULL`, args: [] },
      {
        scope: "incomes",
        table: "expected_payments",
        where: `t.user_id = ? AND t.deleted_at IS NULL AND t.kind = 'recurring_income'`,
        args: [],
      },
    );
  }

  if (chosen.has("budgets")) {
    const budgetMonths = within("t.month", months.min, months.max);
    selectors.push({
      scope: "budgets",
      table: "category_budgets",
      where: `t.user_id = ? AND t.deleted_at IS NULL${budgetMonths.sql}`,
      args: budgetMonths.args,
    });
  }

  if (chosen.has("investments")) {
    // Only the START of the range applies. Holdings are a replay of every
    // operation in order, so lifting a slice out of the middle produces a sale
    // of something that was never bought — the validator rejects it, and it
    // would be a lie about the portfolio if it did not. Cutting the tail off
    // leaves a prefix that is still internally consistent.
    const tail = within("t.operation_date", range.from, null);
    selectors.push({
      scope: "investments",
      table: "investment_operations",
      where: `t.user_id = ? AND t.deleted_at IS NULL${tail.sql}`,
      args: tail.args,
    });
  }

  return selectors;
}

function emptyCounts(): Record<ResetScope, number> {
  return { ledger: 0, installments: 0, subscriptions: 0, incomes: 0, budgets: 0, investments: 0 };
}

/** Whether the whole ledger is being cleared, anchor and all. */
function clearsAnchor(selection: ResetSelection): boolean {
  return selection.scopes.includes("ledger") && selection.range.from == null && selection.range.to == null;
}

/**
 * The opening balance and the month the ledger starts at.
 *
 * They go only with an unbounded ledger reset, and they go TOGETHER: the two
 * are one semantic unit (`onboarding.ts` says so, and `useLedgerState` reads
 * them as one), so clearing the balance while keeping the month would anchor an
 * empty ledger to a stale opening figure. `balance_declared` joins them because
 * it is a claim about a balance that no longer has anything behind it.
 */
async function anchorWrites(userId: string): Promise<RowWrite[]> {
  const sqlite = await getSqliteAsync();
  const deletedAt = nowIso();
  // Found by KEY, not by the deterministic id that key normally produces. The
  // two agree for every row this app writes, and a reset that quietly missed a
  // row because it arrived with some other id would leave the ledger anchored
  // to an opening balance the owner believes they cleared. The key is what the
  // row means; the id is only how it is usually addressed.
  const rows = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM settings
     WHERE user_id = ? AND deleted_at IS NULL
       AND key IN ('start_month', 'opening_balance_minor', 'balance_declared')`,
    [userId],
  );
  return rows.map((row) => ({ table: "settings" as const, row: { ...fromDbShape("settings", row), deletedAt } }));
}

async function countRows(userId: string, table: SyncedTableName, where: string, args: string[]): Promise<number> {
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} t WHERE ${where}`,
    [userId, ...args],
  );
  return Number(row?.n ?? 0);
}

/**
 * Collect the tombstones a selection produces.
 *
 * Rows only — the counts the screen shows come from `previewDataReset`, which
 * asks the database to count rather than loading them. No deduplication:
 * `selectorsFor` keeps the scopes disjoint, and `tests/data-reset.test.ts`
 * holds them to it by checking that the preview total is exactly what the write
 * then reports.
 */
async function collectWrites(userId: string, selection: ResetSelection): Promise<RowWrite[]> {
  const sqlite = await getSqliteAsync();
  const deletedAt = nowIso();
  const writes: RowWrite[] = [];

  for (const selector of selectorsFor(selection)) {
    const rows = await sqlite.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM ${selector.table} t WHERE ${selector.where}`,
      [userId, ...selector.args],
    );
    for (const row of rows) {
      writes.push({ table: selector.table, row: { ...fromDbShape(selector.table, row), deletedAt } });
    }
  }

  if (clearsAnchor(selection)) writes.push(...(await anchorWrites(userId)));
  return writes;
}

/** Plans the range cuts through: some instalments inside it, some outside. */
async function straddlingPlanCount(userId: string, range: ResetRange): Promise<number> {
  // No early return for an unbounded range: `outside` already collapses to a
  // constant false there, so the query answers 0 by itself. A branch that can
  // only ever agree with the code below it is a branch that can drift from it.
  const beyond = outside("x.effective_date", range.from, range.to);
  const inside = within("x.effective_date", range.from, range.to);
  const schedule = (extra: string) =>
    `SELECT 1 FROM transactions x
       WHERE x.user_id = t.user_id AND x.installment_plan_id = t.id AND x.deleted_at IS NULL${extra}`;
  return countRows(
    userId,
    "installment_plans",
    `t.user_id = ? AND t.deleted_at IS NULL
      AND EXISTS (${schedule(inside.sql)})
      AND EXISTS (${schedule(` AND ${beyond.sql}`)})`,
    [...inside.args, ...beyond.args],
  );
}

/**
 * Whether this selection can move investment cash or holdings at all.
 *
 * Two `COUNT`s to avoid loading rows the check would not read. Only two things
 * reach the investment replay: the operations themselves, and ledger rows in a
 * transfer category, which are what funds the wallet. A reset of budgets or
 * cell notes cannot reach it, and neither can a ledger reset in an account that
 * has never invested.
 */
async function movesInvestments(userId: string, selection: ResetSelection): Promise<boolean> {
  const chosen = new Set(selection.scopes);
  // Resetting investments ALONE is never the thing that breaks the replay, so
  // it is not asked about here. The cut is a suffix by construction, and the
  // prefix it leaves is the state the account was already in at that date —
  // valid then, valid now. What can break the replay is money: a ledger row in
  // a transfer category is what funded the wallet, and taking it back out is
  // the one selection that can leave the wallet holding what it never paid for.
  const transferCategory = `EXISTS (
    SELECT 1 FROM categories c WHERE c.id = t.category_id AND c.user_id = t.user_id AND c.is_transfer = 1
  )`;
  if (chosen.has("ledger")) {
    const rows = ledgerRowsIn(selection.range, "t", "?");
    if (await countRows(userId, "transactions", `${rows.sql} AND ${transferCategory}`, rows.args) > 0) return true;
  }
  if (chosen.has("installments")) {
    const nested = wholePlansIn(selection.range, "p", "t.user_id");
    const where = `t.user_id = ? AND t.deleted_at IS NULL AND t.installment_plan_id IS NOT NULL AND ${transferCategory}
      AND EXISTS (SELECT 1 FROM installment_plans p WHERE p.id = t.installment_plan_id AND ${nested.sql})`;
    if (await countRows(userId, "transactions", where, nested.args) > 0) return true;
  }
  return false;
}

/**
 * Replay the investment ledger against the proposed state and report what it
 * says.
 *
 * The same assertion the write itself runs, called early so the answer arrives
 * before the confirmation rather than after it. It is not a second opinion and
 * must never become one: `performDataReset` validates again, so a state that
 * slipped past this one is still refused where it counts.
 */
async function investmentBlocker(userId: string, writes: RowWrite[]): Promise<string | null> {
  const sqlite = await getSqliteAsync();
  try {
    await assertInvestmentWrites(sqlite, userId, writes);
    return null;
  } catch (error) {
    if (error instanceof InvestmentDomainError) return error.code;
    throw error;
  }
}

/**
 * What a selection would do, without doing it.
 *
 * Counted with `COUNT(*)` rather than by collecting rows: the preview re-runs
 * on every change to the selection, and a workspace with a decade of history
 * has more rows than a preview has any business loading. The blocker check is
 * the one part that needs the rows themselves, and it asks for them only when
 * the selection can actually reach the investment ledger.
 */
export async function previewDataReset(userId: string, selection: ResetSelection): Promise<ResetPreview> {
  const counts = emptyCounts();
  for (const selector of selectorsFor(selection)) {
    counts[selector.scope] += await countRows(userId, selector.table, selector.where, selector.args);
  }
  if (clearsAnchor(selection)) counts.ledger += (await anchorWrites(userId)).length;

  const blocker = (await movesInvestments(userId, selection))
    ? await investmentBlocker(userId, await collectWrites(userId, selection))
    : null;

  return {
    counts,
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
    straddlingPlans: await straddlingPlanCount(userId, selection.range),
    clearsLedgerAnchor: clearsAnchor(selection),
    blocker,
  };
}

/** How many tombstones travel in one statement batch inside the transaction. */
const RESET_BATCH = 400;

/**
 * Carry out the reset, all of it or none of it.
 *
 * `isUserEntry` is false: `last_entry_at` is what the catch-up banner reads to
 * decide whether the owner has fallen behind on their entries, and erasing
 * records is not making one.
 */
export async function performDataReset(userId: string, selection: ResetSelection): Promise<ResetOutcome> {
  const writes = await collectWrites(userId, selection);
  if (writes.length === 0) return { deleted: 0 };
  const batches: RowWrite[][] = [];
  for (let offset = 0; offset < writes.length; offset += RESET_BATCH) {
    batches.push(writes.slice(offset, offset + RESET_BATCH));
  }
  await writeRowBatchesAtomically(
    userId,
    batches,
    false,
    (sqlite) => assertInvestmentWrites(sqlite, userId, writes).then(() => undefined),
  );
  return { deleted: writes.length };
}
