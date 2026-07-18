/** Pure dashboard projection/analytics model. UI supplies labels and colors. */

import { countsTowardBalance, projectedBalance, type MonthLedger, type UpcomingFlow } from "./balance";
import type { ISODate } from "./dates";
import type { Distribution } from "./analytics";
import type { ExpectedPaymentLike, TxLike } from "./types";
import { financialFlow, projectedTransactionFlow } from "./transactions";

export interface DashboardModel<TExpected extends ExpectedPaymentLike = ExpectedPaymentLike> {
  pendingItems: TExpected[];
  lateItems: TExpected[];
  monthEndFlows: UpcomingFlow[];
  incomingMinor: number;
  outgoingMinor: number;
  projectedMinor: number | null;
  distribution: Distribution;
  fixedMinor: number;
  variableMinor: number;
  trendMonths: MonthLedger[];
}

export interface DashboardModelInput<TExpected extends ExpectedPaymentLike = ExpectedPaymentLike> {
  transactions: TxLike[];
  expected: TExpected[];
  ledger: MonthLedger[];
  actualBalanceMinor: number | null;
  today: ISODate;
  monthStart: ISODate;
  monthEnd: ISODate;
  currentMonth: string;
  year: number;
  expectedTryMinor: (currency: string, amountMinor: number) => number | null;
}

/**
 * Derive the dashboard's transaction-backed summaries in one O(N) pass.
 * Previously month-end forecast, distribution and fixed/variable each scanned
 * the same full ledger independently.
 */
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
  let fixedMinor = 0;
  let variableMinor = 0;

  for (const transaction of input.transactions) {
    if (
      transaction.personIsSelf &&
      transaction.status === "pending" &&
      transaction.effectiveDate >= input.today &&
      transaction.effectiveDate <= input.monthEnd
    ) {
      monthEndFlows.push({ ...projectedTransactionFlow(transaction), date: transaction.effectiveDate });
    }

    if (
      !countsTowardBalance(transaction, input.today) ||
      transaction.effectiveDate < input.monthStart ||
      transaction.effectiveDate > input.monthEnd
    ) {
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

  for (const item of pendingItems) {
    if (item.dueDate < input.today || item.dueDate > input.monthEnd) continue;
    const amountTryMinor = input.expectedTryMinor(item.currency, item.amountMinor);
    if (amountTryMinor == null) continue;
    monthEndFlows.push({ direction: item.direction, amountTryMinor, date: item.dueDate });
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
    },
    fixedMinor,
    variableMinor,
    trendMonths: input.ledger.filter(
      (month) => Number(month.month.slice(0, 4)) === input.year && month.month <= input.currentMonth,
    ),
  };
}
