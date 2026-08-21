/**
 * Analytics engine: category × month matrix, YTD cumulatives (user's Excel
 * habit: "how much have I paid to my credit card since January"),
 * distribution donut (transfers shown separately, never as spending), and
 * fixed-vs-variable breakdown.
 */

import { monthKeyOf, monthRange, type ISODate, type MonthKey } from "./dates";
import type { Minor } from "./money";
import { countsTowardBalance } from "./balance";
import type { TxLike } from "./types";
import { financialFlow } from "./transactions";

interface CategoryYearRow {
  categoryId: string;
  monthly: Map<MonthKey, Minor>;
  ytdMinor: Minor;
}

/**
 * Realized sums per category per month over a window, plus window totals.
 * Includes only rows that count toward the balance (is_self, realized).
 */
export function categoryRangeMatrix(
  transactions: TxLike[],
  start: MonthKey,
  end: MonthKey,
  today: ISODate,
  options: { includeTransfers?: boolean } = {},
): Map<string, CategoryYearRow> {
  const rows = new Map<string, CategoryYearRow>();
  for (const tx of transactions) {
    // Transfers move money rather than earn/spend it, so the default category
    // matrix excludes them. The dedicated all-flow analysis view opts in only
    // to keep those categories visible; expense totals remain separate.
    const flow = financialFlow(tx);
    if (
      !countsTowardBalance(tx, today) ||
      (flow.type === "transfer" && !options.includeTransfers) ||
      !tx.categoryId
    ) continue;
    const month = monthKeyOf(tx.effectiveDate);
    if (month < start || month > end) continue;
    let row = rows.get(tx.categoryId);
    if (!row) {
      row = { categoryId: tx.categoryId, monthly: new Map(), ytdMinor: 0 };
      rows.set(tx.categoryId, row);
    }
    row.monthly.set(month, (row.monthly.get(month) ?? 0) + flow.amountTryMinor);
    row.ytdMinor += flow.amountTryMinor;
  }
  return rows;
}

/**
 * What the category cost in each month of the window.
 *
 * This used to accumulate. A running total only ever climbs, so every category
 * drew the same rising line and the one question the chart is opened for —
 * which months were heavy — was the one it could not answer. A month is now
 * its own point, and a month with nothing in it is a zero rather than a
 * repeat of the previous value.
 */
export function monthlySeries(
  row: CategoryYearRow,
  start: MonthKey,
  end: MonthKey,
): { month: MonthKey; amountMinor: Minor }[] {
  return monthRange(start, end).map((month) => ({ month, amountMinor: row.monthly.get(month) ?? 0 }));
}

export interface Distribution {
  /** Spending per category — expenses only. */
  expenseByCategory: Map<string, Minor>;
  /** Legacy expenses whose category is missing or was deleted. */
  uncategorizedExpenseMinor: Minor;
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
  let uncategorizedExpense = 0;
  let transferTotal = 0;
  let incomeTotal = 0;
  for (const tx of transactions) {
    if (!countsTowardBalance(tx, today)) continue;
    if (tx.effectiveDate < from || tx.effectiveDate > to) continue;
    const flow = financialFlow(tx);
    if (flow.type === "expense") {
      expenseTotal += flow.amountTryMinor;
      if (tx.categoryId) {
        expenseByCategory.set(tx.categoryId, (expenseByCategory.get(tx.categoryId) ?? 0) + flow.amountTryMinor);
      } else uncategorizedExpense += flow.amountTryMinor;
    } else if (flow.type === "transfer") {
      transferTotal += flow.amountTryMinor;
    } else {
      incomeTotal += flow.amountTryMinor;
    }
  }
  return {
    expenseByCategory,
    uncategorizedExpenseMinor: uncategorizedExpense,
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
    const flow = financialFlow(tx);
    if (!countsTowardBalance(tx, today) || flow.type !== "expense") continue;
    if (tx.effectiveDate < from || tx.effectiveDate > to) continue;
    if (tx.installmentPlanId || tx.subscriptionId) fixed += flow.amountTryMinor;
    else variable += flow.amountTryMinor;
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
  return creditCardSplitsByMonth(transactions, creditCardSourceIds, today).get(month) ?? {
    singleMinor: 0,
    installmentMinor: 0,
  };
}

/** One pass for every month used by the cash-flow matrix. */
export function creditCardSplitsByMonth(
  transactions: TxLike[],
  creditCardSourceIds: ReadonlySet<string>,
  today: ISODate,
): Map<MonthKey, { singleMinor: Minor; installmentMinor: Minor }> {
  const result = new Map<MonthKey, { singleMinor: Minor; installmentMinor: Minor }>();
  for (const tx of transactions) {
    const flow = financialFlow(tx);
    if (!countsTowardBalance(tx, today) || flow.type !== "expense") continue;
    if (!tx.paymentSourceId || !creditCardSourceIds.has(tx.paymentSourceId)) continue;
    const month = monthKeyOf(tx.effectiveDate);
    const bucket = result.get(month) ?? { singleMinor: 0, installmentMinor: 0 };
    if (tx.installmentPlanId) bucket.installmentMinor += flow.amountTryMinor;
    else bucket.singleMinor += flow.amountTryMinor;
    result.set(month, bucket);
  }
  return result;
}

/**
 * Yearly subscription cost normalized to a true monthly load (spec §3.1).
 *
 * A corrupt `interval_months` of 0 produced `Infinity` here, which reached
 * `formatMinor` and threw `assertMinor` DURING RENDER on the subscriptions
 * screen. `recurrence.ts` already fails closed on the same field; treat an
 * unusable interval as "charged once per month" rather than crashing.
 */
export function normalizedMonthlyLoadMinor(amountMinor: Minor, intervalMonths: number): Minor {
  if (!Number.isInteger(intervalMonths) || intervalMonths < 1) return amountMinor;
  return Math.round(amountMinor / intervalMonths);
}
