/**
 * Analytics engine: category × month matrix, YTD cumulatives (user's Excel
 * habit: "how much have I paid to my credit card since January"),
 * distribution donut (transfers shown separately, never as spending), and
 * fixed-vs-variable breakdown.
 */

import { makeMonthKey, monthKeyOf, monthRange, type ISODate, type MonthKey } from "./dates";
import type { Minor } from "./money";
import { countsTowardBalance } from "./balance";
import type { TxLike } from "./types";

export interface CategoryYearRow {
  categoryId: string;
  monthly: Map<MonthKey, Minor>;
  ytdMinor: Minor;
}

/**
 * Realized sums per category per month for a year, plus YTD totals.
 * Includes only rows that count toward the balance (is_self, realized).
 */
export function categoryMonthMatrix(
  transactions: TxLike[],
  year: number,
  today: ISODate,
): Map<string, CategoryYearRow> {
  const start = makeMonthKey(year, 1);
  const end = makeMonthKey(year, 12);
  const rows = new Map<string, CategoryYearRow>();
  for (const tx of transactions) {
    if (!countsTowardBalance(tx, today) || !tx.categoryId) continue;
    const month = monthKeyOf(tx.effectiveDate);
    if (month < start || month > end) continue;
    let row = rows.get(tx.categoryId);
    if (!row) {
      row = { categoryId: tx.categoryId, monthly: new Map(), ytdMinor: 0 };
      rows.set(tx.categoryId, row);
    }
    row.monthly.set(month, (row.monthly.get(month) ?? 0) + tx.amountTryMinor);
    row.ytdMinor += tx.amountTryMinor;
  }
  return rows;
}

/** Cumulative series for one category across a month range (trend chart). */
export function cumulativeSeries(
  row: CategoryYearRow,
  start: MonthKey,
  end: MonthKey,
): { month: MonthKey; cumulativeMinor: Minor }[] {
  let running = 0;
  return monthRange(start, end).map((month) => {
    running += row.monthly.get(month) ?? 0;
    return { month, cumulativeMinor: running };
  });
}

export interface Distribution {
  /** Spending per category — expenses only. */
  expenseByCategory: Map<string, Minor>;
  expenseTotalMinor: Minor;
  /** Transfers (e.g. Yatırım) reported separately, never mixed into spending. */
  transferTotalMinor: Minor;
  incomeTotalMinor: Minor;
}

export function distributionForRange(
  transactions: TxLike[],
  from: ISODate,
  to: ISODate,
  today: ISODate,
): Distribution {
  const expenseByCategory = new Map<string, Minor>();
  let expenseTotal = 0;
  let transferTotal = 0;
  let incomeTotal = 0;
  for (const tx of transactions) {
    if (!countsTowardBalance(tx, today)) continue;
    if (tx.effectiveDate < from || tx.effectiveDate > to) continue;
    if (tx.type === "expense") {
      expenseTotal += tx.amountTryMinor;
      if (tx.categoryId) {
        expenseByCategory.set(tx.categoryId, (expenseByCategory.get(tx.categoryId) ?? 0) + tx.amountTryMinor);
      }
    } else if (tx.type === "transfer") {
      transferTotal += tx.amountTryMinor;
    } else {
      incomeTotal += tx.amountTryMinor;
    }
  }
  return {
    expenseByCategory,
    expenseTotalMinor: expenseTotal,
    transferTotalMinor: transferTotal,
    incomeTotalMinor: incomeTotal,
  };
}

/**
 * Fixed obligations = installment/loan/subscription-linked expenses;
 * variable = everything else. Answers "bu ay bankalara/kurumlara toplam ne
 * kadar ödüyorum" (spec §3.2).
 */
export function fixedVsVariable(
  transactions: TxLike[],
  from: ISODate,
  to: ISODate,
  today: ISODate,
): { fixedMinor: Minor; variableMinor: Minor } {
  let fixed = 0;
  let variable = 0;
  for (const tx of transactions) {
    if (!countsTowardBalance(tx, today) || tx.type !== "expense") continue;
    if (tx.effectiveDate < from || tx.effectiveDate > to) continue;
    if (tx.installmentPlanId || tx.subscriptionId) fixed += tx.amountTryMinor;
    else variable += tx.amountTryMinor;
  }
  return { fixedMinor: fixed, variableMinor: variable };
}

/**
 * Credit-card split for a month: single-shot vs installment spending
 * (Excel's "Kredi Kartı Tek Çekim" vs "KK Taksitli Harcamalar").
 */
export function creditCardSplit(
  transactions: TxLike[],
  creditCardSourceIds: Set<string>,
  month: MonthKey,
  today: ISODate,
): { singleMinor: Minor; installmentMinor: Minor } {
  let single = 0;
  let installment = 0;
  for (const tx of transactions) {
    if (!countsTowardBalance(tx, today) || tx.type !== "expense") continue;
    if (monthKeyOf(tx.effectiveDate) !== month) continue;
    if (!tx.paymentSourceId || !creditCardSourceIds.has(tx.paymentSourceId)) continue;
    if (tx.installmentPlanId) installment += tx.amountTryMinor;
    else single += tx.amountTryMinor;
  }
  return { singleMinor: single, installmentMinor: installment };
}

/** Yearly subscription cost normalized to a true monthly load (spec §3.1). */
export function normalizedMonthlyLoadMinor(amountMinor: Minor, intervalMonths: number): Minor {
  return Math.round(amountMinor / intervalMonths);
}
