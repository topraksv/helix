/**
 * Expected payment/income engine (spec §2.6): subscriptions and recurring
 * incomes yield expected items with a due date; installment plans materialize
 * scheduled transactions directly. State machine: pending → paid (user
 * confirms / auto-pay) or late (due date passed without confirmation).
 * Confirmation is the source of truth; automation only assists.
 */

import { addMonthsToKey, isMonthDay, lastDayOf, monthKeyOf, type ISODate } from "./dates";
import { dayIntervalDatesInRange, dueDateInMonth, dueDatesInRange } from "./recurrence";
import type { Minor } from "./money";
import type {
  ExpectedKind,
  ExpectedPaymentLike,
  RecurringIncomeLike,
  SubscriptionLike,
  TxLike,
} from "./types";

interface ExpectedDraft {
  direction: "in" | "out";
  kind: "subscription" | "recurring_income";
  refId: string;
  dueDate: ISODate;
  amountMinor: number;
  amountIsEstimated: boolean;
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
    // Fail closed on a corrupt nominal day (hand-edited backup, tampered sync):
    // there is no due date to anchor on, so the rule generates nothing rather
    // than an invented one. Same contract as an invalid interval.
    if (!isMonthDay(sub.billingDay)) continue;
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
        amountIsEstimated: sub.amountMode === "variable",
        currency: sub.currency,
      };
      if (!seen.has(expectedKey(draft))) drafts.push(draft);
    }
  }

  for (const income of incomes) {
    if (!income.isActive || !income.personIsSelf) continue;
    // Both cadences produce the same row and differ only in which dates they
    // land on, so the draft is described once — a field added to one schedule
    // and not the other would be invisible until a reminder went missing.
    const addIncomeDraft = (dueDate: ISODate): void => {
      const draft: ExpectedDraft = {
        direction: "in",
        kind: "recurring_income",
        refId: income.id,
        dueDate,
        amountMinor: income.defaultAmountMinor,
        amountIsEstimated: false,
        currency: income.currency,
      };
      if (!seen.has(expectedKey(draft))) drafts.push(draft);
    };
    if (income.recurrence === "weekly" || income.recurrence === "biweekly") {
      if (!income.anchorDate) continue;
      const intervalDays = income.recurrence === "weekly" ? 7 : 14;
      for (const dueDate of dayIntervalDatesInRange(income.anchorDate, intervalDays, today, horizon)) {
        addIncomeDraft(dueDate);
      }
      continue;
    }
    // Monthly incomes anchor on a nominal pay day; a corrupt one fails closed
    // exactly like a missing weekly anchor above.
    if (!isMonthDay(income.payDay)) continue;
    let month = monthKeyOf(today);
    for (let i = 0; i <= horizonMonths; i++) {
      const dueDate = dueDateInMonth(month, income.payDay);
      if (dueDate >= today) addIncomeDraft(dueDate);
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

/**
 * Auto-pay items due on/before today are auto-confirmed (user can revert).
 *
 * Auto-pay automates the billing dates a rule LIVES THROUGH; it never
 * back-fills one that already passed when the rule was written down. Saving a
 * rule is a statement about a schedule, not a statement that money has moved,
 * and `subscription-form.tsx` defaults `nextDueDate` to today whenever the
 * billing day is today — so an unguarded `dueDate <= today` confirmed a
 * realized expense the instant an auto-pay subscription was created, and the
 * current balance dropped by its amount before anything had been paid
 * (spec §2.6, §2.7: the actual balance is confirmed money only).
 *
 * Occurrences on or before the creation day stay pending, so they remain
 * visible as an obligation, count toward the projection, and are one tap from
 * confirmed — rather than being asserted as spent on the user's behalf.
 *
 * `autoPayRules` maps an auto-pay rule's id to the day it was created. A rule
 * whose creation day is unknown (absent from the map's value, e.g. a corrupt
 * row) keeps the documented behavior: the guard exists to stop same-day
 * back-fill, not to silently disable a user's automation.
 */
export function findAutoConfirmable(
  expected: ExpectedPaymentLike[],
  autoPayRules: ReadonlyMap<string, ISODate | null>,
  today: ISODate,
): ExpectedPaymentLike[] {
  return expected.filter((e) => {
    if (e.status !== "pending" || e.dueDate > today) return false;
    if (e.kind !== "subscription" || e.amountIsEstimated === true) return false;
    if (!autoPayRules.has(e.refId)) return false;
    const createdDay = autoPayRules.get(e.refId) ?? null;
    return createdDay == null || e.dueDate > createdDay;
  });
}

/**
 * The rows auto-pay recorded as paid without asking, by transaction id, so a
 * list can say which charges the app made on its own.
 */
export function autoConfirmedTransactionIds(
  expected: readonly { autoConfirmed: boolean; transactionId: string | null }[],
): Set<string> {
  return new Set(expected.flatMap((item) => (item.autoConfirmed && item.transactionId ? [item.transactionId] : [])));
}

/** An unpaid expectation as a planned flow: in TRY, in its rule's category. */
export interface PlannedExpectation {
  id: string;
  kind: ExpectedKind;
  refId: string;
  direction: "in" | "out";
  dueDate: ISODate;
  amountTryMinor: Minor;
  categoryId: string | null;
  /** The rule's name, so a list can say what the planned amount is. */
  name: string | null;
}

/** The rule occurrences a pending row already carries, keyed as `expectedKey` keys them. */
function pendingOccurrences(transactions: readonly TxLike[]): Set<string> {
  const keys = new Set<string>();
  for (const tx of transactions) {
    if (tx.personIsSelf && tx.status === "pending" && tx.subscriptionId) {
      keys.add(expectedKey({ kind: "subscription", refId: tx.subscriptionId, dueDate: tx.effectiveDate }));
    }
  }
  return keys;
}

/** What an expectation does to the balance, signed the way a row's effect is. */
export function expectationEffect(item: Pick<PlannedExpectation, "direction" | "amountTryMinor">): Minor {
  return item.direction === "in" ? item.amountTryMinor : -item.amountTryMinor;
}

/**
 * The expectations a forecast counts, computed once for the Mali Tablo and the
 * Summary card alike, so the table's month close and "Ay sonu tahmini" are one
 * figure rather than two kept equal by hand.
 *
 * Unpaid and due today or later: an overdue one is on the late list, waiting
 * to be confirmed on the day it was actually paid. A foreign amount without a
 * rate is left out rather than read as TRY.
 *
 * One obligation can reach here twice, as an expectation and as a pending row
 * of the rule that generated it. The app's own flows cannot do that —
 * confirming marks the expectation paid, reverting tombstones the row — but a
 * restore or a sync from an older client can. Only a rule reference
 * establishes identity, and `subscriptionId` is the only one a transaction
 * carries, so an income rule cannot be matched. The match also requires the
 * same date, because counting one obligation twice overstates what leaves the
 * account while collapsing two real ones would understate it, and only the
 * first error is safe. `kind + refId + dueDate` is the identity
 * `generateExpected` already stays idempotent on.
 */
export function plannedExpectations(input: {
  expected: readonly ExpectedPaymentLike[];
  transactions: readonly TxLike[];
  today: ISODate;
  toTryMinor: (currency: string, amountMinor: number) => number | null;
  ruleOf: (kind: ExpectedKind, refId: string) => { categoryId: string | null; name: string } | undefined;
}): PlannedExpectation[] {
  const carried = pendingOccurrences(input.transactions);
  const planned: PlannedExpectation[] = [];
  for (const item of input.expected) {
    if ((item.status !== "pending" && item.status !== "late") || item.dueDate < input.today) continue;
    if (carried.has(expectedKey(item))) continue;
    const amountTryMinor = input.toTryMinor(item.currency, item.amountMinor);
    if (amountTryMinor == null) continue;
    const rule = input.ruleOf(item.kind, item.refId);
    planned.push({
      id: item.id,
      kind: item.kind,
      refId: item.refId,
      direction: item.direction,
      dueDate: item.dueDate,
      amountTryMinor,
      categoryId: rule?.categoryId ?? null,
      name: rule?.name ?? null,
    });
  }
  return planned;
}
