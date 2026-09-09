/**
 * Balance engine. Reproduces the Excel chained-balance model (verified
 * against Ocak–Temmuz 2026 screenshots):
 *
 *   closing(m)   = opening(m) + Σ income − Σ expense − Σ transfer ± adjustments(m)
 *   opening(m+1) = closing(m);   opening(startMonth) = openingBalance
 *
 * Only rows with status='realized', effective_date <= today and an is_self
 * person count toward the balance (spec §2.7, §2.8). Balances may go
 * negative (Temmuz 2026: −18.773,03).
 */

import { makeMonthKey, monthKeyOf, monthRange, yearOf, type ISODate, type MonthKey } from "./dates";
import type { Minor } from "./money";
import type { AdjustmentLike, TxLike } from "./types";
import { financialFlow, signedBalanceEffect } from "./transactions";

export function countsTowardBalance(tx: TxLike, today: ISODate): boolean {
  return tx.status === "realized" && tx.effectiveDate <= today && tx.personIsSelf;
}

/** Replacement value for today's deterministic reconciliation row. The
 * displayed balance already includes the existing row, so remove that effect
 * before measuring the new delta. */
export function reconciliationDelta(
  targetMinor: Minor,
  computedNowMinor: Minor,
  existingAdjustmentMinor: Minor = 0,
): Minor {
  return targetMinor - (computedNowMinor - existingAdjustmentMinor);
}

export interface MonthLedger {
  month: MonthKey;
  openingMinor: Minor;
  incomeMinor: Minor;
  expenseMinor: Minor;
  transferMinor: Minor;
  adjustmentMinor: Minor;
  closingMinor: Minor;
  /** Displayed sums per category (TRY minor), including pending when enabled. */
  byCategory: Map<string, Minor>;
  /** Rows with no category, kept visible without inventing a category id. */
  uncategorizedMinor: Minor;
  /**
   * The planned (not yet realized) half of this month, split by flow type.
   *
   * These come from EXACTLY the rows that also entered `byCategory`, which is
   * what makes a month-focused card able to show a total and a breakdown that
   * agree: the realized-only chain above is right for the balance but reads 0
   * for every future month, while the category cells beside it already showed
   * the planned amounts.
   */
  plannedIncomeMinor: Minor;
  plannedExpenseMinor: Minor;
  plannedTransferMinor: Minor;
  /** The same chain as `openingMinor`/`closingMinor`, carrying the planned
   *  flows too. Identical to them for a month with nothing planned. */
  projectedOpeningMinor: Minor;
  projectedClosingMinor: Minor;
}

/**
 * What a month-focused surface (the Mali Tablo month cards, the month detail
 * summary) must show: one total and the breakdown it is actually made of.
 *
 * Both live here so the two can never be sourced differently again —
 * `closingMinor` minus a realized-only breakdown is the divergence this
 * replaces, not a second opinion about it. The balance chain itself
 * (`openingMinor`/`closingMinor`, the Mali Tablo balance columns, the current
 * balance) stays realized-only and is untouched.
 */
export function monthFlowTotals(month: MonthLedger): {
  openingMinor: Minor;
  incomeMinor: Minor;
  expenseMinor: Minor;
  transferMinor: Minor;
  adjustmentMinor: Minor;
  closingMinor: Minor;
} {
  return {
    openingMinor: month.projectedOpeningMinor,
    incomeMinor: month.incomeMinor + month.plannedIncomeMinor,
    expenseMinor: month.expenseMinor + month.plannedExpenseMinor,
    transferMinor: month.transferMinor + month.plannedTransferMinor,
    adjustmentMinor: month.adjustmentMinor,
    closingMinor: month.projectedClosingMinor,
  };
}

/**
 * The month figures a computed column reads.
 *
 * `byCategory` already carries the planned rows, so pairing it with the
 * realized-only income/expense made a formula like "Net Akış" read 0 for a
 * future month while the category cell next to it in the SAME row showed the
 * planned amount. One accessor, one dataset, every call site.
 */
export function monthColumnBasis(month: MonthLedger): {
  byCategory: Map<string, Minor>;
  incomeMinor: Minor;
  expenseMinor: Minor;
} {
  const flows = monthFlowTotals(month);
  return { byCategory: month.byCategory, incomeMinor: flows.incomeMinor, expenseMinor: flows.expenseMinor };
}

interface LedgerInput {
  openingBalanceMinor: Minor;
  startMonth: MonthKey;
  endMonth: MonthKey;
  transactions: TxLike[];
  adjustments: AdjustmentLike[];
  today: ISODate;
  /** Also show future/pending self rows inside category cells (display only —
   *  balances, income/expense sums and the chain stay realized-only). */
  includePendingInCells?: boolean;
}

/**
 * The earliest month carrying anything, never later than `seed`.
 *
 * One scan serving two questions that used to own a copy each: where an
 * anchored ledger has to reach back to, and where an unanchored one begins.
 */
function earliestRecordedMonth(
  seed: MonthKey,
  transactions: TxLike[],
  adjustments: AdjustmentLike[],
): MonthKey {
  let earliest = seed;
  for (const tx of transactions) {
    const month = monthKeyOf(tx.effectiveDate);
    if (month < earliest) earliest = month;
  }
  for (const adjustment of adjustments) {
    const month = monthKeyOf(adjustment.date);
    if (month < earliest) earliest = month;
  }
  return earliest;
}

/**
 * The earliest month carrying a record, or null when nothing does.
 *
 * `earliestRecordedMonth` answers a different question — it is bounded by a
 * seed it may never exceed — and that bound is exactly what a caller asking
 * "where does the data start" must not inherit.
 */
export function firstRecordedMonth(
  transactions: TxLike[],
  adjustments: AdjustmentLike[],
): MonthKey | null {
  // Sorted rather than compared in a running-minimum loop. A month key is a
  // sortable string, so the loop's `month < earliest` had a twin — `<=` — that
  // assigns an equal value and produces the same answer for every input there
  // is. A test cannot tell those apart, which makes the comparison a thing the
  // suite is permanently unable to guard.
  return [
    ...transactions.map((tx) => monthKeyOf(tx.effectiveDate)),
    ...adjustments.map((adjustment) => monthKeyOf(adjustment.date)),
  ].sort()[0] ?? null;
}

/**
 * Resolve the effective ledger anchor so history entered before the
 * configured opening month still appears. Extends the start back to the
 * earliest recorded data and back-computes the opening balance there, so the
 * balance AT the configured start (and the current balance) is unchanged.
 */
export function resolveLedgerAnchor(
  configuredStart: MonthKey,
  configuredOpeningMinor: Minor,
  transactions: TxLike[],
  adjustments: AdjustmentLike[],
  today: ISODate,
): { startMonth: MonthKey; openingBalanceMinor: Minor } {
  const startMonth = earliestRecordedMonth(configuredStart, transactions, adjustments);
  if (startMonth === configuredStart) {
    return { startMonth, openingBalanceMinor: configuredOpeningMinor };
  }
  // Sum balance-affecting flows strictly before the configured anchor month.
  const anchorDay = `${configuredStart}-01`;
  let beforeAnchor = 0;
  for (const tx of transactions) {
    if (tx.effectiveDate < anchorDay && countsTowardBalance(tx, today)) beforeAnchor += signedBalanceEffect(tx);
  }
  for (const a of adjustments) {
    if (a.date < anchorDay && a.date <= today) beforeAnchor += a.amountMinor;
  }
  return { startMonth, openingBalanceMinor: configuredOpeningMinor - beforeAnchor };
}

/** Build the chained month-by-month ledger over [startMonth, endMonth]. */
export function buildLedger(input: LedgerInput): MonthLedger[] {
  const { openingBalanceMinor, startMonth, endMonth, transactions, adjustments, today, includePendingInCells } = input;
  const months = monthRange(startMonth, endMonth);
  const byMonth = new Map<MonthKey, TxLike[]>();
  const pendingByMonth = new Map<MonthKey, TxLike[]>();
  for (const tx of transactions) {
    if (countsTowardBalance(tx, today)) {
      const key = monthKeyOf(tx.effectiveDate);
      const bucket = byMonth.get(key);
      if (bucket) bucket.push(tx);
      else byMonth.set(key, [tx]);
    } else if (includePendingInCells && tx.personIsSelf && tx.status === "pending") {
      const key = monthKeyOf(tx.effectiveDate);
      const bucket = pendingByMonth.get(key);
      if (bucket) bucket.push(tx);
      else pendingByMonth.set(key, [tx]);
    }
  }
  const adjustmentByMonth = new Map<MonthKey, Minor>();
  for (const adj of adjustments) {
    if (adj.date > today) continue;
    const key = monthKeyOf(adj.date);
    adjustmentByMonth.set(key, (adjustmentByMonth.get(key) ?? 0) + adj.amountMinor);
  }

  const ledger: MonthLedger[] = [];
  let opening = openingBalanceMinor;
  let projectedOpening = openingBalanceMinor;
  for (const month of months) {
    let income = 0;
    let expense = 0;
    let transfer = 0;
    let plannedIncome = 0;
    let plannedExpense = 0;
    let plannedTransfer = 0;
    let uncategorized = 0;
    const byCategory = new Map<string, Minor>();
    for (const tx of byMonth.get(month) ?? []) {
      const flow = financialFlow(tx);
      if (flow.type === "income") income += flow.amountTryMinor;
      else if (flow.type === "expense") expense += flow.amountTryMinor;
      else transfer += flow.amountTryMinor;
      if (tx.categoryId) {
        byCategory.set(tx.categoryId, (byCategory.get(tx.categoryId) ?? 0) + flow.amountTryMinor);
      } else uncategorized += flow.amountTryMinor;
    }
    // One pass, one classification: whatever lands in a category cell is also
    // counted in the planned totals, so a cell can never show an amount that
    // the month's own breakdown denies.
    for (const tx of pendingByMonth.get(month) ?? []) {
      const flow = financialFlow(tx);
      if (flow.type === "income") plannedIncome += flow.amountTryMinor;
      else if (flow.type === "expense") plannedExpense += flow.amountTryMinor;
      else plannedTransfer += flow.amountTryMinor;
      if (tx.categoryId) {
        byCategory.set(tx.categoryId, (byCategory.get(tx.categoryId) ?? 0) + flow.amountTryMinor);
      } else uncategorized += flow.amountTryMinor;
    }
    const adjustment = adjustmentByMonth.get(month) ?? 0;
    const closing = opening + income - expense - transfer + adjustment;
    const projectedClosing =
      projectedOpening +
      (income + plannedIncome) -
      (expense + plannedExpense) -
      (transfer + plannedTransfer) +
      adjustment;
    ledger.push({
      month,
      openingMinor: opening,
      incomeMinor: income,
      expenseMinor: expense,
      transferMinor: transfer,
      adjustmentMinor: adjustment,
      closingMinor: closing,
      byCategory,
      uncategorizedMinor: uncategorized,
      plannedIncomeMinor: plannedIncome,
      plannedExpenseMinor: plannedExpense,
      plannedTransferMinor: plannedTransfer,
      projectedOpeningMinor: projectedOpening,
      projectedClosingMinor: projectedClosing,
    });
    opening = closing;
    projectedOpening = projectedClosing;
  }
  return ledger;
}

export interface LedgerBundle {
  ledger: MonthLedger[];
  yearMonths: MonthLedger[];
  startMonth: MonthKey;
  /**
   * The earliest month that actually HOLDS something, or null when nothing does.
   *
   * Distinct from `startMonth`, which is where the balance chain has to begin.
   * An anchor can sit years before the first record — an import writes one, a
   * setup screen writes one — and the chain then carries the opening figure
   * across every empty month in between. That is right for the arithmetic and
   * wrong for navigation: the Mali Tablo offered six years of blank rows with
   * a balance column filled in, which reads as data that went missing rather
   * than as months that never had any.
   */
  firstRecordedMonth: MonthKey | null;
  actualBalanceMinor: Minor;
  txLike: TxLike[];
}

/**
 * The chain itself, which does not depend on which year is being looked at.
 *
 * Splitting this out is the difference between a year switch costing a full
 * rebuild and costing an array filter. `buildLedger` walks every transaction
 * the account has and chains every month from the anchor forward; for any year
 * at or before the current one the result is byte-identical whichever year the
 * screen is showing, because only the SLICE differs. Measured at 6x CPU
 * throttle on a five-year, 3.000-row workspace, moving between years blocked
 * the main thread for 208ms doing arithmetic it had already done.
 *
 * `endYear` is the one thing a requested year can change: looking at 2028 has
 * to extend the chain that far. It is therefore part of the cache key rather
 * than the year itself, so browsing backwards through history never rebuilds.
 */
export function ledgerChainEndYear(year: number, today: ISODate): number {
  return Math.max(year, yearOf(today));
}

export interface LedgerChain {
  ledger: MonthLedger[];
  startMonth: MonthKey;
  /** See `LedgerBundle.firstRecordedMonth`. */
  firstRecordedMonth: MonthKey | null;
  actualBalanceMinor: Minor;
  txLike: TxLike[];
}

/**
 * The whole chain, anchored or not.
 *
 * An unset `start_month` is NOT a missing ledger, and modelling it as one is
 * the defect this signature used to carry: it returned `null`, and each of the
 * seven screens reading it invented its own meaning for that. The dashboard
 * held a loading skeleton that never resolved, Mali Tablo announced the month
 * was empty, and the opening-balance editor — the one screen that can SET the
 * anchor — refused to open because there was no anchor to read, which is a
 * deadlock a person cannot leave without reinstalling.
 *
 * It is reached by clearing the whole ledger, which the reset does on purpose,
 * so "no anchor" is an ordinary state rather than a corrupt one. Worse, every
 * row entered AFTERWARDS was invisible too: the chain refused before it ever
 * looked at the transactions.
 *
 * Unanchored therefore means what a person would assume it means — the table
 * opens at zero, in the earliest month that carries anything, or in this month
 * when nothing does. `null` no longer travels from here, so a screen holding
 * one is holding exactly one fact: the queries have not answered yet.
 */
export function buildLedgerChain(input: {
  configuredStart: MonthKey | null;
  openingBalanceMinor: Minor;
  includePendingInCells: boolean;
  transactions: TxLike[];
  adjustments: AdjustmentLike[];
  endYear: number;
  today: ISODate;
}): LedgerChain {
  const { configuredStart, transactions, adjustments, endYear, today } = input;

  const { startMonth, openingBalanceMinor } = configuredStart == null
    ? {
        startMonth: earliestRecordedMonth(monthKeyOf(today), transactions, adjustments),
        openingBalanceMinor: 0,
      }
    : resolveLedgerAnchor(
        configuredStart,
        input.openingBalanceMinor,
        transactions,
        adjustments,
        today,
      );
  const ledger = buildLedger({
    openingBalanceMinor,
    startMonth,
    endMonth: makeMonthKey(endYear, 12),
    transactions,
    adjustments,
    today,
    includePendingInCells: input.includePendingInCells,
  });
  // buildLedger already scanned every transaction and applies the same
  // realized/today rules. Its current-month close is the actual balance, so a
  // normal render does not need a second O(N) currentBalance pass. Keep the
  // direct calculation only for the unusual case where the configured anchor
  // starts after the current month.
  const currentLedgerMonth = ledger.find((entry) => entry.month === monthKeyOf(today));
  const actualBalanceMinor = currentLedgerMonth?.closingMinor ?? currentBalance({
    openingBalanceMinor,
    transactions,
    adjustments,
    today,
  });
  return {
    ledger,
    startMonth,
    firstRecordedMonth: firstRecordedMonth(transactions, adjustments),
    actualBalanceMinor,
    txLike: transactions,
  };
}

/** One year's view of a chain that has already been built. */
export function sliceLedgerYear(chain: LedgerChain, year: number): LedgerBundle {
  return {
    ledger: chain.ledger,
    yearMonths: chain.ledger.filter((month) => yearOf(month.month) === year),
    startMonth: chain.startMonth,
    firstRecordedMonth: chain.firstRecordedMonth,
    actualBalanceMinor: chain.actualBalanceMinor,
    txLike: chain.txLike,
  };
}

/**
 * Actual balance as of `today` (partial current month included).
 *
 * It sums EVERY row that counts, with no month window at all — so
 * `openingBalanceMinor` has to be the balance at the anchor
 * `resolveLedgerAnchor` returned, not the one the user configured. The
 * signature used to accept a `startMonth` and quietly ignore it, which reads
 * as a window that is applied and is not; a property test walked straight into
 * it and reported the chain and this disagreeing.
 */
export function currentBalance(
  input: {
    openingBalanceMinor: Minor;
    transactions: TxLike[];
    adjustments: AdjustmentLike[];
    today: ISODate;
  },
): Minor {
  const { openingBalanceMinor, transactions, adjustments, today } = input;
  let balance = openingBalanceMinor;
  for (const tx of transactions) {
    if (countsTowardBalance(tx, today)) balance += signedBalanceEffect(tx);
  }
  for (const adj of adjustments) {
    if (adj.date <= today) balance += adj.amountMinor;
  }
  return balance;
}

export interface UpcomingFlow {
  direction: "in" | "out";
  amountTryMinor: Minor;
  date: ISODate;
}

/**
 * Projected balance at `horizon` (spec §2.7 dashboard): actual balance plus
 * every known future flow (pending transactions and unpaid expected
 * payments) due on or before the horizon. It sums what it is given and does
 * not look for identity between flows: two entries for one obligation are
 * collapsed by `buildDashboardModel` before they get here, because only the
 * dashboard holds the rule references that establish the match.
 */
export function projectedBalance(actualMinor: Minor, flows: UpcomingFlow[], horizon: ISODate): Minor {
  let projected = actualMinor;
  for (const flow of flows) {
    if (flow.date > horizon) continue;
    projected += flow.direction === "in" ? flow.amountTryMinor : -flow.amountTryMinor;
  }
  return projected;
}
