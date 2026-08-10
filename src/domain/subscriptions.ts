/** Pure helpers for subscription category selection. */

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
