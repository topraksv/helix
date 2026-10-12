/** Pure helpers for subscription category selection. */

import { normalizedMonthlyLoadMinor } from "./analytics";
import { groupBy } from "./card-statements";
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
 * How an occurrence's amount reads in a list: settled, estimated, or unknown.
 * One rule for every surface, so a guess is never shown as settled money nor an
 * unknown as ₺0,00.
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
interface PriceHistoryLike {
  subscriptionId: string;
  amountMinor: number;
  currency: string;
  effectiveFrom: ISODate;
}

/** The slice of a subscription a cost summary reads. */
interface SubscriptionCostLike {
  id: string;
  name: string;
  amountMinor: number;
  currency: string;
  intervalMonths: number;
  nextDueDate: ISODate;
  isActive: boolean;
  amountMode?: "fixed" | "variable";
}

/**
 * The range a variable bill has actually charged, from its own
 * `price_history`: the stored 0 for "invoice not in yet" would read as a free
 * bill. A plain min/max, not an average: a seasonal bill's mean over a few
 * samples is a confident number with nothing behind it.
 */
interface VariableAmountBand {
  minMinor: number;
  maxMinor: number;
  currency: string;
  samples: number;
}

export function variableAmountBand(
  history: readonly PriceHistoryLike[],
  currency: string,
): VariableAmountBand | null {
  let minMinor = Number.POSITIVE_INFINITY;
  let maxMinor = 0;
  let samples = 0;
  for (const row of history) {
    if (row.currency !== currency || row.amountMinor <= 0) continue;
    samples += 1;
    if (row.amountMinor < minMinor) minMinor = row.amountMinor;
    if (row.amountMinor > maxMinor) maxMinor = row.amountMinor;
  }
  return samples === 0 ? null : { minMinor, maxMinor, currency, samples };
}

/** One rule's price moving from one figure to another on a known day. */
interface PriceChange {
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
  /** The same rules over twelve months, each rounded once: twelve rounded
   *  monthly loads report a yearly ₺1.199 as ₺1.199,04. */
  annualTryMinor: number;
  /** Active rules whose currency has no TRY figure here, so the totals can
   *  say what they exclude instead of quietly under-reporting. */
  excludedCurrencyCount: number;
  /** Active variable rules whose invoice has not arrived, counted for the same
   *  reason: they enter the monthly total as zero, and a total that silently
   *  under-reports an electricity bill is worse than one that says so. */
  unknownAmountCount: number;
  /** Most recent first, newest `limit` only. */
  recentChanges: PriceChange[];
  /** The next charge due on or after today, if any active rule has one. */
  nextRenewal: { subscriptionId: string; name: string; dueDate: ISODate; amountMinor: number; currency: string } | null;
}

/**
 * What the subscriptions screen reports about cost: monthly and annual totals
 * and recent price changes.
 *
 * Foreign-currency rules are COUNTED, not converted: converting needs a rate
 * this module must not hold, and silently dropping them would make a total
 * wrong in a direction the user cannot see.
 */
export function subscriptionCostSummary(
  subscriptions: SubscriptionCostLike[],
  priceHistory: PriceHistoryLike[],
  today: ISODate,
  limit = 3,
): SubscriptionCostSummary {
  const active = subscriptions.filter((subscription) => subscription.isActive);
  let monthlyTryMinor = 0;
  let annualTryMinor = 0;
  let excludedCurrencyCount = 0;
  let unknownAmountCount = 0;
  for (const subscription of active) {
    if (subscription.currency !== "TRY") {
      excludedCurrencyCount += 1;
      continue;
    }
    if (subscription.amountMode === "variable" && subscription.amountMinor === 0) unknownAmountCount += 1;
    monthlyTryMinor += normalizedMonthlyLoadMinor(subscription.amountMinor, subscription.intervalMonths);
    annualTryMinor += normalizedMonthlyLoadMinor(subscription.amountMinor * 12, subscription.intervalMonths);
  }

  const nameById = new Map(subscriptions.map((subscription) => [subscription.id, subscription.name]));
  // A change needs the price BEFORE it, so history is walked per rule in
  // chronological order and the first entry of each rule is its opening price,
  // never a change from nothing.
  const byRule = groupBy(priceHistory, (row) => row.subscriptionId);
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
    annualTryMinor,
    excludedCurrencyCount,
    unknownAmountCount,
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

/** Each subscription's latest realized charge date, so an auto-paid cycle is not read as unpaid. */
export function lastRealizedCharges(
  transactions: readonly { subscriptionId?: string | null; status: string; effectiveDate: ISODate }[],
): Map<string, ISODate> {
  const latest = new Map<string, ISODate>();
  for (const transaction of transactions) {
    if (!transaction.subscriptionId || transaction.status !== "realized") continue;
    const current = latest.get(transaction.subscriptionId);
    if (!current || transaction.effectiveDate > current) {
      latest.set(transaction.subscriptionId, transaction.effectiveDate);
    }
  }
  return latest;
}
