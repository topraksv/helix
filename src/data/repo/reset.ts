/**
 * Bulk data reset: erase a chosen slice of the workspace without touching its shape.
 *
 * STRUCTURE SURVIVES and ENTRIES DO NOT: categories, computed columns, the column layout, people,
 * payment sources and investment products are how a workspace is built. A scope owns its
 * dependents (an attachment on a deleted transaction would dangle), matching `deletePlan` and
 * `deleteRuleWithExpected`. Nothing hard-deletes: rows are tombstoned through the normal write
 * path so the reset reaches other devices; emptying only THIS device would be undone by the next pull.
 */

import { getSqliteAsync } from "../../db/client";
import { fromDbShape, nowIso, writeRowBatchesAtomically, type RowWrite } from "../../db/mutations";
import type { SyncedTableName } from "../../db/schema";
import { addMonthsToKey, firstDayOf, lastDayOf, monthKeyOf, type ISODate, type MonthKey } from "../../domain/dates";
import { assertInvestmentWrites } from "./investment-validation";
import { runMaintenance } from "./maintenance";
import { InvestmentDomainError } from "../../domain/investments";
import { devWarning } from "../../services/logger";

/** What a reset can be asked to clear, named after what the owner sees rather than tables. */
export const RESET_SCOPES = ["ledger", "installments", "subscriptions", "incomes", "budgets", "investments"] as const;

export type ResetScope = (typeof RESET_SCOPES)[number];

/** Scopes a date range does not apply to: a rule is a standing instruction with no date it "happened" on. */
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
  /** Instalment plans the range cuts through, and therefore does not touch; reported so the owner knows why. */
  straddlingPlans: number;
  /** Whether the opening balance and start month go with it. */
  clearsLedgerAnchor: boolean;
  /** Whether the investment wallet's own opening cash and start day go with it. */
  clearsInvestmentWallet: boolean;
  /** The investment ledger's own refusal code, or null; the caller owns the wording. */
  blocker: string | null;
}

interface ResetOutcome {
  deleted: number;
  /** Whether the derived-state sweep after the delete succeeded; the rows are gone either way. */
  tidied: boolean;
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

/** Month keys the range covers ENTIRELY: a note or mark belongs to a whole month, and a clipped one would erase days not selected. */
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
 * A row no LIVE instalment plan claims. A row pointing at a tombstoned plan belongs to neither
 * scope otherwise (the ledger needs a null plan, the instalments a live one) and would survive
 * every reset. `p2` rather than `p`: this is nested inside `wholePlansIn`'s own `installment_plans p`.
 */
function unclaimedByLivePlan(alias: string): string {
  return `(${alias}.installment_plan_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM installment_plans p2
    WHERE p2.id = ${alias}.installment_plan_id AND p2.user_id = ${alias}.user_id AND p2.deleted_at IS NULL
  ))`;
}

/**
 * Plain ledger rows: what a person typed, imported or confirmed into a month. Instalments of a LIVE
 * plan are excluded, since half a schedule would leave a loan whose rows no longer add up; an
 * orphan is claimed here (`unclaimedByLivePlan`). `owner` binds the alias to the account: `"?"` at
 * the top level, or the outer alias when nested in an `EXISTS`.
 */
function ledgerRowsIn(range: ResetRange, alias: string, owner: string): Predicate {
  const bounds = within(`${alias}.effective_date`, range.from, range.to);
  return {
    sql: `${alias}.user_id = ${owner} AND ${alias}.deleted_at IS NULL AND ${unclaimedByLivePlan(alias)}${bounds.sql}`,
    args: bounds.args,
  };
}

/** The live instalments of the plan `alias`, narrowed by `extra`. */
function planSchedule(alias: string, extra: string): string {
  return `SELECT 1 FROM transactions x
       WHERE x.user_id = ${alias}.user_id AND x.installment_plan_id = ${alias}.id AND x.deleted_at IS NULL${extra}`;
}

/**
 * Plans whose WHOLE schedule the range covers. A bounded range also requires an instalment inside
 * it, so a plan entirely outside is not swept up by a `NOT EXISTS` that is vacuously true for it.
 */
function wholePlansIn(range: ResetRange, alias: string, owner: string): Predicate {
  const beyond = outside("x.effective_date", range.from, range.to);
  const inside = within("x.effective_date", range.from, range.to);
  const schedule = (extra: string) => planSchedule(alias, extra);
  const bounded = range.from != null || range.to != null;
  return {
    sql: `${alias}.user_id = ${owner} AND ${alias}.deleted_at IS NULL
      AND NOT EXISTS (${schedule(` AND ${beyond.sql}`)})${bounded ? `
      AND EXISTS (${schedule(inside.sql)})` : ""}`,
    args: bounded ? [...beyond.args, ...inside.args] : beyond.args,
  };
}

/** The expected-payment kinds a rule scope in this selection already claims; scopes stay disjoint so the preview never counts a row twice. */
function claimedByRules(chosen: ReadonlySet<ResetScope>): string {
  const kinds: string[] = [];
  if (chosen.has("subscriptions")) kinds.push("'subscription'");
  if (chosen.has("incomes")) kinds.push("'recurring_income'");
  return kinds.length > 0 ? ` AND t.kind NOT IN (${kinds.join(", ")})` : "";
}

/** Every table a reset reaches, in collection order; order only decides which scope a row is attributed to. */
function selectorsFor(selection: ResetSelection): ScopeSelector[] {
  const chosen = new Set(selection.scopes);
  const { range } = selection;
  const months = monthBounds(range);
  const selectors: ScopeSelector[] = [];

  if (chosen.has("ledger")) {
    const rows = ledgerRowsIn(range, "t", "?");
    const nested = ledgerRowsIn(range, "x", "t.user_id");
    const dates = within("t.date", range.from, range.to);
    const paidOn = within("t.paid_on", range.from, range.to);
    const noteMonths = within("t.month", months.min, months.max);
    selectors.push(
      { scope: "ledger", table: "transactions", where: rows.sql, args: rows.args },
      {
        // A document survives only as long as its record; the file is swept by maintenance.
        scope: "ledger",
        table: "attachments",
        where: `t.user_id = ? AND t.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM transactions x WHERE x.id = t.transaction_id AND ${nested.sql})`,
        args: nested.args,
      },
      {
        // An obligation whose payment is erased is tombstoned, not reverted to pending: an
        // auto-paying subscription would read "pending" as an instruction to rewrite the transaction
        // just removed. Maintenance regenerates a future one. `claimedByRules` keeps scopes disjoint.
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
        // A statement payment moves the balance on its own day; left behind it would keep taking money out.
        scope: "ledger",
        table: "card_statement_payments",
        where: `t.user_id = ? AND t.deleted_at IS NULL${paidOn.sql}`,
        args: paidOn.args,
      },
      {
        scope: "ledger",
        table: "cell_notes",
        where: `t.user_id = ? AND t.deleted_at IS NULL${noteMonths.sql}`,
        args: noteMonths.args,
      },
      {
        // Row marks name no date and are part of the table's shape; cell and column marks go with their month.
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
      // The same two dependents the ledger owns, for the rows this scope owns instead.
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
        // Every live price history: this scope takes every subscription, so any survivor is undisplayable and would keep syncing.
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
    // Only the START of the range applies: holdings are a replay, so a slice from the middle would
    // leave a sale of something never bought. A cut tail leaves a consistent prefix.
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

/** Whether the whole investment history is cleared, wallet and all. Only `from` matters: the selectors cut a tail, so an end date alone still takes every operation. */
function clearsWallet(selection: ResetSelection): boolean {
  return selection.scopes.includes("investments") && selection.range.from == null;
}

/**
 * The opening balance and start month, which go only with an unbounded ledger reset and TOGETHER
 * (one unit, as `useLedgerState` reads them). `balance_declared` joins them: it is a claim about a
 * balance with nothing behind it.
 */
async function anchorWrites(userId: string): Promise<RowWrite[]> {
  const sqlite = await getSqliteAsync();
  const deletedAt = nowIso();
  // Found by KEY, not by id: a row that arrived under another id must not leave an opening balance the owner believes cleared.
  const rows = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM settings
     WHERE user_id = ? AND deleted_at IS NULL
       AND key IN ('start_month', 'opening_balance_minor', 'balance_declared')`,
    [userId],
  );
  return rows.map((row) => ({ table: "settings" as const, row: { ...fromDbShape("settings", row), deletedAt } }));
}

/**
 * The investment wallet's opening cash, the counterpart of `anchorWrites`: kept, it would hand the
 * cash that bought cleared operations back to the free balance.
 *
 * `started_on` deliberately does NOT move. The wallet reads transfers from the Mali Tablo dated on
 * or after it, so advancing it to today looks like a tidy way to drop old transfers but makes a
 * transfer OUT dated today fail the replay as `insufficient_cash`. Clearing investments alone
 * leaves the wallet holding what the Mali Tablo moved into it, which is not a leftover. A wallet
 * already at zero is skipped, so it is not written, synced or counted in the preview.
 */
async function walletWrites(userId: string): Promise<RowWrite[]> {
  const sqlite = await getSqliteAsync();
  const rows = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM investment_profiles
     WHERE user_id = ? AND deleted_at IS NULL AND opening_cash_minor != 0`,
    [userId],
  );
  return rows.map((row) => ({
    table: "investment_profiles" as const,
    row: { ...fromDbShape("investment_profiles", row), openingCashMinor: 0 },
  }));
}

async function countRows(userId: string, table: SyncedTableName, where: string, args: string[]): Promise<number> {
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} t WHERE ${where}`,
    [userId, ...args],
  );
  return Number(row?.n ?? 0);
}

/** Collect the tombstones a selection produces. No deduplication: `selectorsFor` keeps the scopes disjoint, and `tests/db/data-reset.test.ts` checks the preview total equals what is written. */
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
  if (clearsWallet(selection)) writes.push(...(await walletWrites(userId)));
  return writes;
}

/** Plans the range cuts through: some instalments inside it, some outside. */
async function straddlingPlanCount(userId: string, range: ResetRange): Promise<number> {
  // No early return for an unbounded range: `outside` collapses to a constant false, so the query answers 0.
  const beyond = outside("x.effective_date", range.from, range.to);
  const inside = within("x.effective_date", range.from, range.to);
  const schedule = (extra: string) => planSchedule("t", extra);
  return countRows(
    userId,
    "installment_plans",
    `t.user_id = ? AND t.deleted_at IS NULL
      AND EXISTS (${schedule(inside.sql)})
      AND EXISTS (${schedule(` AND ${beyond.sql}`)})`,
    [...inside.args, ...beyond.args],
  );
}

/** Whether this selection can move investment cash or holdings: only the operations and transfer-category ledger rows (what funds the wallet) reach the replay. */
async function movesInvestments(userId: string, selection: ResetSelection): Promise<boolean> {
  const chosen = new Set(selection.scopes);
  // Deleting operations alone never breaks the replay (the cut is a suffix). Two things can, both
  // funding: taking back a transfer-category ledger row, and clearing the wallet's opening cash.
  if (clearsWallet(selection)) return true;
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

/** Replay the investment ledger against the proposed state, early so the answer precedes the confirmation. `performDataReset` validates again, so this is never the authority. */
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

/** What a selection would do, without doing it. Counted with `COUNT(*)` because it re-runs on every change; rows are loaded only when the selection can reach the investment ledger. */
export async function previewDataReset(userId: string, selection: ResetSelection): Promise<ResetPreview> {
  const counts = emptyCounts();
  for (const selector of selectorsFor(selection)) {
    counts[selector.scope] += await countRows(userId, selector.table, selector.where, selector.args);
  }
  if (clearsAnchor(selection)) counts.ledger += (await anchorWrites(userId)).length;
  // A wallet already at zero produces no write, so no "opening cash will be cleared" note either.
  const wallet = clearsWallet(selection) ? await walletWrites(userId) : [];
  counts.investments += wallet.length;

  const blocker = (await movesInvestments(userId, selection))
    ? await investmentBlocker(userId, await collectWrites(userId, selection))
    : null;

  return {
    counts,
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
    straddlingPlans: await straddlingPlanCount(userId, selection.range),
    clearsLedgerAnchor: clearsAnchor(selection),
    clearsInvestmentWallet: wallet.length > 0,
    blocker,
  };
}

/** How many tombstones travel in one statement batch inside the transaction. */
const RESET_BATCH = 400;

/** Carry out the reset, all of it or none of it. `isUserEntry` is false: erasing records is not an entry for the catch-up banner's `last_entry_at`. */
export async function performDataReset(userId: string, selection: ResetSelection): Promise<ResetOutcome> {
  const writes = await collectWrites(userId, selection);
  if (writes.length === 0) return { deleted: 0, tidied: true };
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
  // Outside the transaction: what a bulk delete leaves behind (statements over vanished lines,
  // expected payments awaiting a fresh pending one) is derived state only maintenance can derive.
  // Best-effort: the delete is already COMMITTED, and a throw here would report a finished reset as failed.
  const tidied = await runMaintenance(userId).then(() => true, (error) => {
    devWarning("reset.maintenance", String(error));
    return false;
  });
  return { deleted: writes.length, tidied };
}
