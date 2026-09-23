/** Pure dashboard projection/analytics model. UI supplies labels and colors. */

import { countsTowardBalance, projectedBalance, type MonthLedger, type UpcomingFlow } from "./balance";
import { addMonthsToKey, firstDayOf, monthKeyOf, type ISODate } from "./dates";
import type { Distribution } from "./analytics";
import type { PlannedExpectation } from "./expected";
import type { ExpectedPaymentLike, TxLike } from "./types";
import { financialFlow, projectedTransactionFlow, signedBalanceEffect } from "./transactions";

interface DashboardModel<TExpected extends ExpectedPaymentLike = ExpectedPaymentLike> {
  pendingItems: TExpected[];
  lateItems: TExpected[];
  monthEndFlows: UpcomingFlow[];
  incomingMinor: number;
  outgoingMinor: number;
  projectedMinor: number | null;
  distribution: Distribution;
  fixedMinor: number;
  variableMinor: number;
  /**
   * What this month still has left to spend on everything that is not a rule,
   * or `null` when no completed month exists to learn it from.
   *
   * `projectedMinor` above is the balance plus every KNOWN flow, and nothing
   * the owner has not already recorded is known — so on its own it claims the
   * rest of the month costs nothing. This is the other half of that sentence,
   * kept separate so a screen can show the pair rather than one number
   * pretending to be both.
   */
  expectedVariableMinor: number | null;
  trendMonths: MonthLedger[];
}

interface DashboardModelInput<TExpected extends ExpectedPaymentLike = ExpectedPaymentLike> {
  transactions: TxLike[];
  expected: TExpected[];
  ledger: MonthLedger[];
  actualBalanceMinor: number | null;
  today: ISODate;
  monthStart: ISODate;
  monthEnd: ISODate;
  currentMonth: string;
  year: number;
  /** The chain's own list, so the forecast counts exactly what the table draws. */
  plannedExpectations: readonly PlannedExpectation[];
  /**
   * Statements paid in part. Their charges stay pending on the due date, but
   * the ledger gives every one of them back there: the balance has already
   * lost what was paid, and the rest is owed to the card, not taken from the
   * account (spec §3.1f). Counting them here would take them twice.
   */
  partlyPaidStatementIds?: ReadonlySet<string>;
}

/**
 * Derive the dashboard's transaction-backed summaries in one O(N) pass.
 * Previously month-end forecast, distribution and fixed/variable each scanned
 * the same full ledger independently.
 */
/**
 * How many completed months a typical month is learned from.
 *
 * Six is long enough that one unusual month cannot define normal and short
 * enough to follow a real change in how much things cost — which in this
 * currency is not a hypothetical.
 */
const TYPICAL_MONTH_WINDOW = 6;

/** The middle value, so one boiler repair does not become the new normal. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

export function buildDashboardModel<TExpected extends ExpectedPaymentLike>(
  input: DashboardModelInput<TExpected>,
): DashboardModel<TExpected> {
  const pendingItems = input.expected.filter((item) => item.status === "pending" || item.status === "late");
  const lateItems = pendingItems.filter(
    (item) => item.status === "late" || (item.status === "pending" && item.dueDate < input.today),
  );
  const monthEndFlows: UpcomingFlow[] = [];
  const expenseByCategory = new Map<string, number>();
  let uncategorizedExpenseMinor = 0;
  let expenseTotalMinor = 0;
  let transferTotalMinor = 0;
  let incomeTotalMinor = 0;
  let workbookRemainderMinor = 0;
  let fixedMinor = 0;
  let variableMinor = 0;
  /**
   * Variable spend of each completed month in the window, keyed by month.
   *
   * Filled in the same pass as everything else. The date comparison that gates
   * it is two string compares, so the months outside the window cost that and
   * nothing more — `tests/domain/performance.test.ts` holds this loop to one bounded
   * pass over the account and a second walk would break it.
   */
  const variableByPastMonth = new Map<string, number>();
  const historyStart = firstDayOf(addMonthsToKey(input.currentMonth, -TYPICAL_MONTH_WINDOW));

  for (const transaction of input.transactions) {
    if (
      transaction.personIsSelf &&
      transaction.status === "pending" &&
      transaction.effectiveDate >= input.today &&
      transaction.effectiveDate <= input.monthEnd &&
      !(transaction.cardStatementId && input.partlyPaidStatementIds?.has(transaction.cardStatementId))
    ) {
      monthEndFlows.push({ ...projectedTransactionFlow(transaction), date: transaction.effectiveDate });
    }

    if (!countsTowardBalance(transaction, input.today)) continue;

    // A workbook remainder keeps an imported column equal to the file. It is
    // not spending, so it stays out of every split below and out of what a
    // typical month is learned from; the balance already carries it.
    if (transaction.isWorkbookRemainder) {
      if (transaction.effectiveDate >= input.monthStart && transaction.effectiveDate <= input.monthEnd) {
        workbookRemainderMinor += signedBalanceEffect(transaction);
      }
      continue;
    }

    if (transaction.effectiveDate >= historyStart && transaction.effectiveDate < input.monthStart) {
      if (!transaction.installmentPlanId && !transaction.subscriptionId) {
        const past = financialFlow(transaction);
        if (past.type === "expense") {
          const key = monthKeyOf(transaction.effectiveDate);
          variableByPastMonth.set(key, (variableByPastMonth.get(key) ?? 0) + past.amountTryMinor);
        }
      }
      continue;
    }

    if (transaction.effectiveDate < input.monthStart || transaction.effectiveDate > input.monthEnd) {
      continue;
    }
    const flow = financialFlow(transaction);
    if (flow.type === "expense") {
      expenseTotalMinor += flow.amountTryMinor;
      if (transaction.categoryId) {
        expenseByCategory.set(
          transaction.categoryId,
          (expenseByCategory.get(transaction.categoryId) ?? 0) + flow.amountTryMinor,
        );
      } else {
        uncategorizedExpenseMinor += flow.amountTryMinor;
      }
      if (transaction.installmentPlanId || transaction.subscriptionId) fixedMinor += flow.amountTryMinor;
      else variableMinor += flow.amountTryMinor;
    } else if (flow.type === "transfer") {
      transferTotalMinor += flow.amountTryMinor;
    } else {
      incomeTotalMinor += flow.amountTryMinor;
    }
  }

  for (const item of input.plannedExpectations) {
    if (item.dueDate <= input.monthEnd) {
      monthEndFlows.push({ direction: item.direction, amountTryMinor: item.amountTryMinor, date: item.dueDate });
    }
  }

  let incomingMinor = 0;
  let outgoingMinor = 0;
  for (const flow of monthEndFlows) {
    if (flow.direction === "in") incomingMinor += flow.amountTryMinor;
    else outgoingMinor += flow.amountTryMinor;
  }

  return {
    pendingItems,
    lateItems,
    monthEndFlows,
    incomingMinor,
    outgoingMinor,
    projectedMinor:
      input.actualBalanceMinor == null
        ? null
        : projectedBalance(input.actualBalanceMinor, monthEndFlows, input.monthEnd),
    distribution: {
      expenseByCategory,
      uncategorizedExpenseMinor,
      expenseTotalMinor,
      transferTotalMinor,
      incomeTotalMinor,
      workbookRemainderMinor,
    },
    fixedMinor,
    variableMinor,
    expectedVariableMinor: variableByPastMonth.size === 0
      ? null
      : Math.max(0, medianOf([...variableByPastMonth.values()]) - variableMinor),
    trendMonths: input.ledger.filter(
      (month) => Number(month.month.slice(0, 4)) === input.year && month.month <= input.currentMonth,
    ),
  };
}
