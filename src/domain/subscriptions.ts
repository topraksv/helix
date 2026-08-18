/** Pure helpers for subscription category selection. */

import type { ISODate } from "./dates";
import { tr } from "../i18n/tr";

interface SubscriptionCategoryLike {
  id: string;
  name: string;
  kind: "expense" | "income";
  deletedAt?: string | null;
}

function normalizedCategoryName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr-TR");
}

/** Reuse a live expense category by Turkish-aware, whitespace-normalized name. */
export function findSubscriptionCategory(
  categories: SubscriptionCategoryLike[],
  requestedName: string,
): SubscriptionCategoryLike | null {
  const target = normalizedCategoryName(requestedName);
  return categories.find(
    (category) =>
      category.kind === "expense" &&
      category.deletedAt == null &&
      normalizedCategoryName(category.name) === target,
  ) ?? null;
}

/** An occurrence of a bill, as far as its amount is concerned. */
interface OccurrenceAmount {
  amountMinor: number;
  currency: string;
  /** Omitted legacy rows are known amounts. */
  amountIsEstimated?: boolean;
}

interface SubscriptionAmountModeLike {
  amountMode?: "fixed" | "variable";
}

/** One shared predicate for every surface that opens a variable invoice. */
export function isVariableSubscriptionOccurrence(
  occurrence: { kind: string; refId: string },
  subscriptionsById: ReadonlyMap<string, SubscriptionAmountModeLike>,
): boolean {
  return occurrence.kind === "subscription" && subscriptionsById.get(occurrence.refId)?.amountMode === "variable";
}

/** A variable occurrence needs entry only while its estimate flag is set. */
export function needsVariableAmountEntry(
  occurrence: { kind: string; refId: string; amountIsEstimated?: boolean },
  subscriptionsById: ReadonlyMap<string, SubscriptionAmountModeLike>,
): boolean {
  return occurrence.amountIsEstimated === true && isVariableSubscriptionOccurrence(occurrence, subscriptionsById);
}

/**
 * A variable bill whose invoice has not been entered yet.
 *
 * 0 is the "no estimate" sentinel on an occurrence that is still flagged
 * estimated — never a real free charge, which is why no surface may format
 * it as ₺0,00.
 */
export function hasUnknownAmount(occurrence: OccurrenceAmount): boolean {
  return occurrence.amountIsEstimated === true && occurrence.amountMinor === 0;
}

/**
 * How an occurrence's amount reads in a list.
 *
 * One rule, one place: the dashboard, the catch-up screen and the upcoming
 * calendar each carried their own copy of this three-way choice, which is
 * three chances for a figure to be presented as settled money when it is a
 * guess — or as ₺0,00 when it is simply unknown.
 */
export function occurrenceAmountText(
  occurrence: OccurrenceAmount,
  format: (amountMinor: number, currency: string) => string,
  labels: { unknown: string; estimated: string },
): string {
  if (occurrence.amountIsEstimated !== true) return format(occurrence.amountMinor, occurrence.currency);
  return hasUnknownAmount(occurrence)
    ? labels.unknown
    : `${format(occurrence.amountMinor, occurrence.currency)} · ${labels.estimated}`;
}

/** The two words the shared amount rule needs, kept beside it. */
export const AMOUNT_LABELS = { unknown: tr.subs.unknownAmount, estimated: tr.subs.estimatedAmount };

// ---------------------------------------------------------------------------
// Cost summary and price history
// ---------------------------------------------------------------------------

/** A stored `price_history` row, as the summary needs it. */
export interface PriceHistoryLike {
  subscriptionId: string;
  amountMinor: number;
  currency: string;
  effectiveFrom: ISODate;
}

/** The slice of a subscription a cost summary reads. */
export interface SubscriptionCostLike {
  id: string;
  name: string;
  amountMinor: number;
  currency: string;
  intervalMonths: number;
  nextDueDate: ISODate;
  isActive: boolean;
}

/** One rule's price moving from one figure to another on a known day. */
export interface PriceChange {
  subscriptionId: string;
  name: string;
  currency: string;
  fromMinor: number;
  toMinor: number;
  changedOn: ISODate;
}

export interface SubscriptionCostSummary {
  /** Active TRY rules only, normalized to what they cost per month. */
  monthlyTryMinor: number;
  /** Twelve months of that same load — a restatement, not a second model. */
  annualTryMinor: number;
  /** Active rules whose currency has no TRY figure here, so the totals can
   *  say what they exclude instead of quietly under-reporting. */
  excludedCurrencyCount: number;
  /** Most recent first, newest `limit` only. */
  recentChanges: PriceChange[];
  /** The next charge due on or after today, if any active rule has one. */
  nextRenewal: { subscriptionId: string; name: string; dueDate: ISODate; amountMinor: number; currency: string } | null;
}

/**
 * What the subscriptions screen reports about cost, in one pass.
 *
 * Deliberately small: it re-uses `normalizedMonthlyLoadMinor` for the monthly
 * figure the screen already showed and adds only the two things the stored
 * data could support but nothing read — the annual restatement, and the price
 * changes `upsertSubscription` has been appending to `price_history` since the
 * table existed without any surface ever reading them back.
 *
 * Foreign-currency rules are COUNTED, not converted. Converting here would
 * need a rate this module has no business holding, and silently dropping them
 * would make a total that is wrong in a direction the user cannot see.
 */
export function subscriptionCostSummary(
  subscriptions: SubscriptionCostLike[],
  priceHistory: PriceHistoryLike[],
  today: ISODate,
  monthlyLoad: (amountMinor: number, intervalMonths: number) => number,
  limit = 3,
): SubscriptionCostSummary {
  const active = subscriptions.filter((subscription) => subscription.isActive);
  let monthlyTryMinor = 0;
  let excludedCurrencyCount = 0;
  for (const subscription of active) {
    if (subscription.currency !== "TRY") {
      excludedCurrencyCount += 1;
      continue;
    }
    monthlyTryMinor += monthlyLoad(subscription.amountMinor, subscription.intervalMonths);
  }

  const nameById = new Map(subscriptions.map((subscription) => [subscription.id, subscription.name]));
  // A change needs the price BEFORE it, so history is walked per rule in
  // chronological order and the first entry of each rule is its opening price,
  // never a change from nothing.
  const byRule = new Map<string, PriceHistoryLike[]>();
  for (const row of priceHistory) {
    const bucket = byRule.get(row.subscriptionId);
    if (bucket) bucket.push(row);
    else byRule.set(row.subscriptionId, [row]);
  }
  const changes: PriceChange[] = [];
  for (const [subscriptionId, rows] of byRule) {
    const name = nameById.get(subscriptionId);
    if (name == null) continue; // deleted rule: no record to point at
    const ordered = [...rows].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      // A currency switch is not a price change; reporting "₺100 → $5" as one
      // states a rise or a fall that the two figures cannot support.
      if (previous.currency !== current.currency) continue;
      if (previous.amountMinor === current.amountMinor) continue;
      changes.push({
        subscriptionId,
        name,
        currency: current.currency,
        fromMinor: previous.amountMinor,
        toMinor: current.amountMinor,
        changedOn: current.effectiveFrom,
      });
    }
  }
  changes.sort((a, b) => b.changedOn.localeCompare(a.changedOn) || a.name.localeCompare(b.name, "tr-TR"));

  const upcoming = active
    .filter((subscription) => subscription.nextDueDate >= today)
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
  const next = upcoming[0] ?? null;

  return {
    monthlyTryMinor,
    annualTryMinor: monthlyTryMinor * 12,
    excludedCurrencyCount,
    recentChanges: changes.slice(0, Math.max(0, limit)),
    nextRenewal: next
      ? {
          subscriptionId: next.id,
          name: next.name,
          dueDate: next.nextDueDate,
          amountMinor: next.amountMinor,
          currency: next.currency,
        }
      : null,
  };
}
