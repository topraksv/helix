/**
 * Expected payment/income engine (spec §2.6): every subscription,
 * installment plan and recurring income yields expected items with a due
 * date. State machine: pending → paid (user confirms / auto-pay) or late
 * (due date passed without confirmation). Confirmation is the source of
 * truth; automation only assists.
 */

import { addMonthsToKey, lastDayOf, monthKeyOf, type ISODate } from "./dates";
import { dueDateInMonth, dueDatesInRange } from "./recurrence";
import type {
  ExpectedPaymentLike,
  RecurringIncomeLike,
  SubscriptionLike,
} from "./types";

export interface ExpectedDraft {
  direction: "in" | "out";
  kind: "subscription" | "recurring_income";
  refId: string;
  dueDate: ISODate;
  amountMinor: number;
  currency: string;
}

export function expectedKey(e: Pick<ExpectedPaymentLike, "kind" | "refId" | "dueDate">): string {
  return `${e.kind}:${e.refId}:${e.dueDate}`;
}

/**
 * Generate missing expected items from today through `horizonMonths` full
 * months ahead. Idempotent: anything already present in `existing` (by
 * kind+refId+dueDate) is skipped, so re-running on every app open is safe.
 * Installment expecteds are not generated here — installment plans already
 * materialize monthly transactions; the UI derives their reminders from
 * pending transactions to avoid double counting.
 */
export function generateExpected(
  subscriptions: SubscriptionLike[],
  incomes: RecurringIncomeLike[],
  existing: Pick<ExpectedPaymentLike, "kind" | "refId" | "dueDate">[],
  today: ISODate,
  horizonMonths = 3,
): ExpectedDraft[] {
  const horizon = lastDayOf(addMonthsToKey(monthKeyOf(today), horizonMonths));
  const seen = new Set(existing.map(expectedKey));
  const drafts: ExpectedDraft[] = [];

  for (const sub of subscriptions) {
    if (!sub.isActive) continue;
    for (const dueDate of dueDatesInRange(sub.nextDueDate, sub.intervalMonths, sub.billingDay, today, horizon)) {
      const draft: ExpectedDraft = {
        direction: "out",
        kind: "subscription",
        refId: sub.id,
        dueDate,
        amountMinor: sub.amountMinor,
        currency: sub.currency,
      };
      if (!seen.has(expectedKey(draft))) drafts.push(draft);
    }
  }

  for (const income of incomes) {
    if (!income.isActive) continue;
    let month = monthKeyOf(today);
    for (let i = 0; i <= horizonMonths; i++) {
      const dueDate = dueDateInMonth(month, income.payDay);
      if (dueDate >= today) {
        const draft: ExpectedDraft = {
          direction: "in",
          kind: "recurring_income",
          refId: income.id,
          dueDate,
          amountMinor: income.defaultAmountMinor,
          currency: income.currency,
        };
        if (!seen.has(expectedKey(draft))) drafts.push(draft);
      }
      month = addMonthsToKey(month, 1);
    }
  }

  return drafts.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Items whose due date passed without confirmation become late. */
export function findLate(expected: ExpectedPaymentLike[], today: ISODate): ExpectedPaymentLike[] {
  return expected.filter((e) => e.status === "pending" && e.dueDate < today);
}

/** Auto-pay items due on/before today are auto-confirmed (user can revert). */
export function findAutoConfirmable(
  expected: ExpectedPaymentLike[],
  autoPayRefIds: Set<string>,
  today: ISODate,
): ExpectedPaymentLike[] {
  return expected.filter(
    (e) =>
      e.status === "pending" &&
      e.dueDate <= today &&
      e.kind === "subscription" &&
      autoPayRefIds.has(e.refId),
  );
}

/** Reminder window check: due within `days` days from today (inclusive). */
export function isDueWithin(e: ExpectedPaymentLike, today: ISODate, days: number): boolean {
  if (e.status !== "pending") return false;
  const due = new Date(`${e.dueDate}T00:00:00`);
  const now = new Date(`${today}T00:00:00`);
  const diffDays = Math.round((due.getTime() - now.getTime()) / 86_400_000);
  return diffDays >= 0 && diffDays <= days;
}
