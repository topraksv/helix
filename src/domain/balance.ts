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
  let startMonth = configuredStart;
  for (const tx of transactions) {
    const m = monthKeyOf(tx.effectiveDate);
    if (m < startMonth) startMonth = m;
  }
  for (const a of adjustments) {
    const m = monthKeyOf(a.date);
    if (m < startMonth) startMonth = m;
  }
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
  actualBalanceMinor: Minor;
  txLike: TxLike[];
}

/**
 * The whole ledger a screen reads: the back-anchored chain, the requested
 * year's slice and the balance that is true right now.
 *
 * One derivation, so the four rules that used to live inline in the data hook
 * — back-anchoring before the configured start, extending the end month to at
 * least the current year, taking the current balance from the chain rather
 * than a second full scan, and returning nothing at all until an opening month
 * is configured — are stated once and can be tested without a renderer.
 */
export function buildLedgerBundle(input: {
  configuredStart: MonthKey | null;
  openingBalanceMinor: Minor;
  includePendingInCells: boolean;
  transactions: TxLike[];
  adjustments: AdjustmentLike[];
  year: number;
  today: ISODate;
}): LedgerBundle | null {
  const { configuredStart, transactions, adjustments, year, today } = input;
  if (!configuredStart) return null;

  const { startMonth, openingBalanceMinor } = resolveLedgerAnchor(
    configuredStart,
    input.openingBalanceMinor,
    transactions,
    adjustments,
    today,
  );
  const endMonth = makeMonthKey(Math.max(year, yearOf(today)), 12);
  const ledger = buildLedger({
    openingBalanceMinor,
    startMonth,
    endMonth,
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
    yearMonths: ledger.filter((month) => yearOf(month.month) === year),
    startMonth,
    actualBalanceMinor,
    txLike: transactions,
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
 * payments) due on or before the horizon. It performs no identity de-duplication;
 * the dashboard currently includes a pending transaction and expected payment
 * independently even when they represent one obligation.
 */
export function projectedBalance(actualMinor: Minor, flows: UpcomingFlow[], horizon: ISODate): Minor {
  let projected = actualMinor;
  for (const flow of flows) {
    if (flow.date > horizon) continue;
    projected += flow.direction === "in" ? flow.amountTryMinor : -flow.amountTryMinor;
  }
  return projected;
}
