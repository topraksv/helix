/**
 * The attention inbox: what is waiting for the owner right now.
 *
 * Deliberately small, and deliberately DERIVED. Every item here is a view of a
 * row that already exists — an unpaid expectation, a trial about to end, a
 * balance the owner said was something else. Nothing is a notification record
 * of its own, so there is no second inbox to keep in step with the ledger, and
 * an item disappears the moment the thing it is about is dealt with, wherever
 * that happened.
 *
 * The only stored state is what the OWNER did to an item: read it, dismissed
 * it, snoozed it. That is small, bounded and expires with the item, which is
 * why it lives in one settings value rather than a table.
 *
 * This is not a notifications product. The inbox reports what is actionable
 * today and holds nothing else: no history, no read receipts, no counts of
 * things that need no decision.
 */

import { addDaysISO, daysBetweenISO, type ISODate } from "./dates";
import type { Minor } from "./money";

/** What kind of attention an item wants. Ordering follows this list. */
export const ATTENTION_KINDS = ["late", "dueToday", "trialEnding", "driftedBalance", "finalInstallment", "upcoming"] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/** Where an item sits in the inbox. One group per decision the owner makes. */
export type AttentionGroup = "overdue" | "today" | "soon" | "watch";

export interface AttentionItem {
  /**
   * Stable across rebuilds, because the stored read/dismiss/snooze state is
   * keyed on it. Derived from the underlying row's identity, never from its
   * position in a list.
   */
  id: string;
  kind: AttentionKind;
  group: AttentionGroup;
  /** The day this became (or becomes) actionable. */
  date: ISODate;
  amountMinor: Minor | null;
  currency: string;
  /** The record this is about, so a tap opens it rather than a list. */
  target: { kind: "expected"; id: string } | { kind: "subscription"; id: string } | { kind: "installmentPlan"; id: string } | { kind: "balance" };
  /** Free-form label supplied by the caller (a rule name, a plan title). */
  name: string | null;
  unread: boolean;
  /** True when this item can meaningfully be put off rather than resolved. */
  snoozable: boolean;
}

/** What the owner has done to items, stored as one bounded value. */
export interface AttentionState {
  /** Item ids the owner has seen. */
  read: string[];
  /** Item ids the owner dismissed outright. */
  dismissed: string[];
  /** Item id → the day it should reappear. */
  snoozedUntil: Record<string, ISODate>;
}

export const EMPTY_ATTENTION_STATE: AttentionState = { read: [], dismissed: [], snoozedUntil: {} };

/**
 * How many decided items are remembered.
 *
 * The state is one synced settings value, so it must not grow without bound.
 * An item only needs to be remembered while it is still being derived; past
 * that, the item is gone and so is the reason to remember it. This cap is far
 * above the number of things that can be actionable at once and keeps the
 * value small enough to sync as a single row.
 */
export const ATTENTION_STATE_LIMIT = 200;

export function isAttentionState(value: unknown): value is AttentionState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AttentionState>;
  const strings = (list: unknown) => Array.isArray(list) && list.every((entry) => typeof entry === "string");
  if (!strings(candidate.read) || !strings(candidate.dismissed)) return false;
  if (typeof candidate.snoozedUntil !== "object" || candidate.snoozedUntil === null) return false;
  return Object.values(candidate.snoozedUntil).every((entry) => typeof entry === "string");
}

/** Keep the stored value bounded and free of ids nothing derives any more. */
export function pruneAttentionState(state: AttentionState, liveIds: ReadonlySet<string>): AttentionState {
  const keep = (list: string[]) => list.filter((id) => liveIds.has(id)).slice(-ATTENTION_STATE_LIMIT);
  const snoozedUntil: Record<string, ISODate> = {};
  for (const [id, until] of Object.entries(state.snoozedUntil)) {
    if (liveIds.has(id)) snoozedUntil[id] = until;
  }
  return { read: keep(state.read), dismissed: keep(state.dismissed), snoozedUntil };
}

/** How long "later" means. One working week: long enough to be a real defer. */
export const SNOOZE_DAYS = 7;

export function snoozeUntil(today: ISODate, days = SNOOZE_DAYS): ISODate {
  return addDaysISO(today, days);
}

/** A raw candidate, before the owner's own state is applied. */
export interface AttentionCandidate {
  id: string;
  kind: AttentionKind;
  date: ISODate;
  amountMinor: Minor | null;
  currency: string;
  target: AttentionItem["target"];
  name: string | null;
  snoozable: boolean;
}

function groupFor(kind: AttentionKind, date: ISODate, today: ISODate): AttentionGroup {
  if (kind === "driftedBalance") return "watch";
  const days = daysBetweenISO(today, date);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  return days <= 7 ? "soon" : "watch";
}

const KIND_ORDER = new Map(ATTENTION_KINDS.map((kind, index) => [kind, index]));
const GROUP_ORDER: Record<AttentionGroup, number> = { overdue: 0, today: 1, soon: 2, watch: 3 };

/**
 * Turn candidates into the inbox, applying what the owner already decided.
 *
 * Dismissed items are gone. Snoozed items are gone UNTIL their day, and then
 * come back unread — a defer is not a decision, and an item that quietly never
 * returned would be a reminder the product silently dropped.
 */
export function buildAttentionInbox(
  candidates: readonly AttentionCandidate[],
  state: AttentionState,
  today: ISODate,
): AttentionItem[] {
  const dismissed = new Set(state.dismissed);
  const read = new Set(state.read);
  return candidates
    .flatMap((candidate) => {
      if (dismissed.has(candidate.id)) return [];
      const snoozed = state.snoozedUntil[candidate.id];
      if (snoozed && snoozed > today) return [];
      return [{
        id: candidate.id,
        kind: candidate.kind,
        group: groupFor(candidate.kind, candidate.date, today),
        date: candidate.date,
        amountMinor: candidate.amountMinor,
        currency: candidate.currency,
        target: candidate.target,
        name: candidate.name,
        // A snooze that has come due is news again, whatever was read before.
        unread: snoozed ? snoozed <= today : !read.has(candidate.id),
        snoozable: candidate.snoozable,
      }];
    })
    .sort((a, b) =>
      GROUP_ORDER[a.group] - GROUP_ORDER[b.group]
      || a.date.localeCompare(b.date)
      || (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0)
      || a.id.localeCompare(b.id));
}

/** Items per group, in group order, skipping groups with nothing in them. */
export function groupAttention(items: readonly AttentionItem[]): { group: AttentionGroup; items: AttentionItem[] }[] {
  const byGroup = new Map<AttentionGroup, AttentionItem[]>();
  for (const item of items) {
    const bucket = byGroup.get(item.group);
    if (bucket) bucket.push(item);
    else byGroup.set(item.group, [item]);
  }
  return (["overdue", "today", "soon", "watch"] as const)
    .flatMap((group) => {
      const bucket = byGroup.get(group);
      return bucket && bucket.length > 0 ? [{ group, items: bucket }] : [];
    });
}

/** How many items are still unread — the only number the tab bar needs. */
export function unreadCount(items: readonly AttentionItem[]): number {
  return items.reduce((count, item) => count + (item.unread ? 1 : 0), 0);
}
