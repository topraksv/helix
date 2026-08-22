/** Pure dashboard projection/analytics model. UI supplies labels and colors. */

import { countsTowardBalance, projectedBalance, type MonthLedger, type UpcomingFlow } from "./balance";
import { addMonthsToKey, firstDayOf, monthKeyOf, type ISODate } from "./dates";
import type { Distribution } from "./analytics";
import type { ExpectedPaymentLike, TxLike } from "./types";
import { financialFlow, projectedTransactionFlow } from "./transactions";

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
  expectedTryMinor: (currency: string, amountMinor: number) => number | null;
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
  /**
   * Rule occurrences already projected as a transaction, so the expectation
   * that produced them is not counted a second time.
   *
   * Only a rule reference can establish identity here: two rows for one
   * obligation share the rule that generated them, and nothing else about them
   * has to agree. `subscriptionId` is the only such link a transaction carries
   * — `recurring_income` has no counterpart field, so an income rule cannot be
   * matched and is left counted as it was.
   *
   * The app's own flows cannot reach this state: confirming an expectation
   * marks it paid, which drops it from `pendingItems`, and reverting one
   * tombstones the transaction it created. What can reach it is data — a
   * restore, a sync from an older client, or a row left linked by the matching
   * surface that was removed. The match is therefore deliberately strict: it
   * requires the same date as well as the same rule, because counting one
   * obligation twice overstates what leaves the account, while collapsing two
   * real ones would understate it. Of those two errors only the first is safe.
   *
   * `kind + refId + dueDate` is not a key invented here: it is the same
   * identity `generateExpected` already uses to stay idempotent, so one
   * occurrence means the same thing on both sides of the engine.
   */
  const projectedRuleOccurrences = new Set<string>();
  const occurrenceKey = (kind: string, refId: string, date: string): string =>
    `${kind}\u0000${refId}\u0000${date}`;
  const expenseByCategory = new Map<string, number>();
  let uncategorizedExpenseMinor = 0;
  let expenseTotalMinor = 0;
  let transferTotalMinor = 0;
  let incomeTotalMinor = 0;
  let fixedMinor = 0;
  let variableMinor = 0;
  /**
   * Variable spend of each completed month in the window, keyed by month.
   *
   * Filled in the same pass as everything else. The date comparison that gates
   * it is two string compares, so the months outside the window cost that and
   * nothing more — `tests/performance.test.ts` holds this loop to one bounded
   * pass over the account and a second walk would break it.
   */
  const variableByPastMonth = new Map<string, number>();
  const historyStart = firstDayOf(addMonthsToKey(input.currentMonth, -TYPICAL_MONTH_WINDOW));

  for (const transaction of input.transactions) {
    if (
      transaction.personIsSelf &&
      transaction.status === "pending" &&
      transaction.effectiveDate >= input.today &&
      transaction.effectiveDate <= input.monthEnd
    ) {
      monthEndFlows.push({ ...projectedTransactionFlow(transaction), date: transaction.effectiveDate });
      if (transaction.subscriptionId) {
        projectedRuleOccurrences.add(
          occurrenceKey("subscription", transaction.subscriptionId, transaction.effectiveDate),
        );
      }
    }

    if (!countsTowardBalance(transaction, input.today)) continue;

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

  for (const item of pendingItems) {
    if (item.dueDate < input.today || item.dueDate > input.monthEnd) continue;
    if (projectedRuleOccurrences.has(occurrenceKey(item.kind, item.refId, item.dueDate))) continue;
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
    expectedVariableMinor: variableByPastMonth.size === 0
      ? null
      : Math.max(0, medianOf([...variableByPastMonth.values()]) - variableMinor),
    trendMonths: input.ledger.filter(
      (month) => Number(month.month.slice(0, 4)) === input.year && month.month <= input.currentMonth,
    ),
  };
}
