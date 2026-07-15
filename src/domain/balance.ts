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

import { monthKeyOf, monthRange, type ISODate, type MonthKey } from "./dates";
import type { Minor } from "./money";
import type { AdjustmentLike, TxLike } from "./types";
import { financialFlow, signedBalanceEffect } from "./transactions";

export function countsTowardBalance(tx: TxLike, today: ISODate): boolean {
  return tx.status === "realized" && tx.effectiveDate <= today && tx.personIsSelf;
}

/** Signed effect of a transaction on the cash balance. */
export function balanceEffect(tx: TxLike): Minor {
  return signedBalanceEffect(tx);
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
  /** Realized sums per category (TRY minor), for the cash-flow matrix. */
  byCategory: Map<string, Minor>;
}

export interface LedgerInput {
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
    if (tx.effectiveDate < anchorDay && countsTowardBalance(tx, today)) beforeAnchor += balanceEffect(tx);
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
  for (const month of months) {
    let income = 0;
    let expense = 0;
    let transfer = 0;
    const byCategory = new Map<string, Minor>();
    for (const tx of byMonth.get(month) ?? []) {
      const flow = financialFlow(tx);
      if (flow.type === "income") income += flow.amountTryMinor;
      else if (flow.type === "expense") expense += flow.amountTryMinor;
      else transfer += flow.amountTryMinor;
      if (tx.categoryId) {
        byCategory.set(tx.categoryId, (byCategory.get(tx.categoryId) ?? 0) + flow.amountTryMinor);
      }
    }
    for (const tx of pendingByMonth.get(month) ?? []) {
      if (tx.categoryId) {
        byCategory.set(tx.categoryId, (byCategory.get(tx.categoryId) ?? 0) + financialFlow(tx).amountTryMinor);
      }
    }
    const adjustment = adjustmentByMonth.get(month) ?? 0;
    const closing = opening + income - expense - transfer + adjustment;
    ledger.push({
      month,
      openingMinor: opening,
      incomeMinor: income,
      expenseMinor: expense,
      transferMinor: transfer,
      adjustmentMinor: adjustment,
      closingMinor: closing,
      byCategory,
    });
    opening = closing;
  }
  return ledger;
}

/** Actual balance as of `today` (partial current month included). */
export function currentBalance(
  input: Omit<LedgerInput, "endMonth">,
): Minor {
  const { openingBalanceMinor, transactions, adjustments, today } = input;
  let balance = openingBalanceMinor;
  for (const tx of transactions) {
    if (countsTowardBalance(tx, today)) balance += balanceEffect(tx);
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
 * payments) due on or before the horizon. Callers de-duplicate flows that
 * exist both as pending transaction and expected payment.
 */
export function projectedBalance(actualMinor: Minor, flows: UpcomingFlow[], horizon: ISODate): Minor {
  let projected = actualMinor;
  for (const flow of flows) {
    if (flow.date > horizon) continue;
    projected += flow.direction === "in" ? flow.amountTryMinor : -flow.amountTryMinor;
  }
  return projected;
}
