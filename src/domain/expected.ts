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

function expectedKey(e: Pick<ExpectedPaymentLike, "kind" | "refId" | "dueDate">): string {
  return `${e.kind}:${e.refId}:${e.dueDate}`;
}

/**
 * Which derived unpaid rows must be tombstoned when a rule is edited. Active
 * rules retain genuinely overdue obligations, replace today's/future schedule,
 * and never touch paid/skipped history. Inactive/watch-only/deleted rules drop
 * every unpaid derivative so stale dashboard cards cannot survive.
 */
export function obsoleteExpectedIds(
  existing: ExpectedPaymentLike[],
  drafts: ExpectedDraft[],
  today: ISODate,
  sourceActive: boolean,
): string[] {
  const generated = new Set(drafts.map((draft) => expectedKey(draft)));
  return existing
    .filter((row) => row.status === "pending" || row.status === "late")
    .filter((row) => !sourceActive || row.dueDate >= today)
    .filter((row) => !generated.has(expectedKey(row)))
    .map((row) => row.id);
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
    if (!sub.isActive || !sub.personIsSelf) continue;
    // A free trial cannot create a charge before it ends. If the trial ends
    // after the stored next due date, use the first scheduled billing date on
    // or after that boundary as the generation anchor.
    let anchor = sub.nextDueDate;
    if (sub.trialEndDate && sub.trialEndDate > anchor) {
      const trialMonthDue = dueDateInMonth(monthKeyOf(sub.trialEndDate), sub.billingDay);
      anchor = trialMonthDue >= sub.trialEndDate
        ? trialMonthDue
        : dueDateInMonth(addMonthsToKey(monthKeyOf(sub.trialEndDate), sub.intervalMonths), sub.billingDay);
    }
    for (const dueDate of dueDatesInRange(anchor, sub.intervalMonths, sub.billingDay, today, horizon)) {
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
    if (!income.isActive || !income.personIsSelf) continue;
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

/**
 * The ledger (effective) date to stamp on the transaction created when an
 * expected item is confirmed.
 *
 * - Without a manual `paidOn`: the due date once it has passed, otherwise today
 *   (a not-yet-due auto-confirm realizes as of today, never in the future).
 * - With a manual `paidOn`: that day wins, so a user who paid early ("due the
 *   15th, paid the 12th") records the payment on the real day and it becomes a
 *   realized flow there. A *future* `paidOn` is rejected — you cannot have
 *   already paid a bill on a day that hasn't arrived — and falls back to the
 *   default.
 */
export function confirmEffectiveDate(dueDate: ISODate, today: ISODate, paidOn?: ISODate | null): ISODate {
  if (paidOn && paidOn <= today) return paidOn;
  return dueDate <= today ? dueDate : today;
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
