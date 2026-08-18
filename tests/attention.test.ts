/**
 * The attention inbox.
 *
 * Its whole value is that it is honest about what is waiting, so the tests are
 * mostly about the ways it could quietly lose something: a snooze that never
 * comes back, a dismissal that outlives the thing dismissed, a stored value
 * that grows for ever.
 */
import { describe, expect, it } from "vitest";
import {
  ATTENTION_STATE_LIMIT,
  EMPTY_ATTENTION_STATE,
  SNOOZE_DAYS,
  buildAttentionInbox,
  groupAttention,
  isAttentionState,
  pruneAttentionState,
  snoozeUntil,
  unreadCount,
  type AttentionCandidate,
  type AttentionState,
} from "../src/domain/attention";

const TODAY = "2026-08-18";
const candidate = (over: Partial<AttentionCandidate> & Pick<AttentionCandidate, "id">): AttentionCandidate => ({
  kind: "dueToday",
  date: TODAY,
  amountMinor: 100_00,
  currency: "TRY",
  target: { kind: "expected", id: over.id },
  name: "Netflix",
  snoozable: true,
  ...over,
});

describe("what the inbox shows", () => {
  it("groups by the decision the owner has to make, overdue first", () => {
    const items = buildAttentionInbox([
      candidate({ id: "soon", date: "2026-08-21", kind: "upcoming" }),
      candidate({ id: "late", date: "2026-08-10", kind: "late" }),
      candidate({ id: "today" }),
      candidate({ id: "far", date: "2026-09-30", kind: "upcoming" }),
    ], EMPTY_ATTENTION_STATE, TODAY);
    expect(items.map((item) => [item.id, item.group])).toEqual([
      ["late", "overdue"],
      ["today", "today"],
      ["soon", "soon"],
      ["far", "watch"],
    ]);
  });

  it("puts a standing condition in the watch group whatever its date", () => {
    const [item] = buildAttentionInbox(
      [candidate({ id: "drift", kind: "driftedBalance", date: "2026-08-10", amountMinor: null })],
      EMPTY_ATTENTION_STATE,
      TODAY,
    );
    expect(item?.group).toBe("watch");
  });

  it("collapses to the groups that actually have something in them", () => {
    const grouped = groupAttention(buildAttentionInbox([candidate({ id: "a" })], EMPTY_ATTENTION_STATE, TODAY));
    expect(grouped.map((entry) => entry.group)).toEqual(["today"]);
  });

  it("counts only what has not been read", () => {
    const state: AttentionState = { ...EMPTY_ATTENTION_STATE, read: ["seen"] };
    const items = buildAttentionInbox([candidate({ id: "seen" }), candidate({ id: "fresh" })], state, TODAY);
    expect(unreadCount(items)).toBe(1);
    expect(items.find((item) => item.id === "seen")?.unread).toBe(false);
  });
});

describe("what the owner already decided", () => {
  it("removes a dismissed item outright", () => {
    const state: AttentionState = { ...EMPTY_ATTENTION_STATE, dismissed: ["gone"] };
    expect(buildAttentionInbox([candidate({ id: "gone" })], state, TODAY)).toEqual([]);
  });

  it("hides a snoozed item until its day", () => {
    const state: AttentionState = { ...EMPTY_ATTENTION_STATE, snoozedUntil: { later: "2026-08-25" } };
    expect(buildAttentionInbox([candidate({ id: "later" })], state, TODAY)).toEqual([]);
  });

  /** A defer is not a decision: it must come back, and come back as news. */
  it("brings a snoozed item back unread on its day, even if it was read before", () => {
    const state: AttentionState = { read: ["later"], dismissed: [], snoozedUntil: { later: TODAY } };
    const [item] = buildAttentionInbox([candidate({ id: "later" })], state, TODAY);
    expect(item?.id).toBe("later");
    expect(item?.unread).toBe(true);
  });

  it("computes a snooze a real week out", () => {
    expect(snoozeUntil(TODAY)).toBe("2026-08-25");
    expect(SNOOZE_DAYS).toBe(7);
  });
});

describe("the stored value stays small and current", () => {
  it("forgets ids nothing derives any more", () => {
    const state: AttentionState = {
      read: ["live", "dead"],
      dismissed: ["dead"],
      snoozedUntil: { live: "2026-09-01", dead: "2026-09-01" },
    };
    expect(pruneAttentionState(state, new Set(["live"]))).toEqual({
      read: ["live"],
      dismissed: [],
      snoozedUntil: { live: "2026-09-01" },
    });
  });

  it("keeps the value bounded however long the account lives", () => {
    const ids = Array.from({ length: ATTENTION_STATE_LIMIT + 50 }, (_, index) => `item-${index}`);
    const pruned = pruneAttentionState(
      { read: ids, dismissed: ids, snoozedUntil: {} },
      new Set(ids),
    );
    expect(pruned.read).toHaveLength(ATTENTION_STATE_LIMIT);
    expect(pruned.dismissed).toHaveLength(ATTENTION_STATE_LIMIT);
    // The most recent decisions are the ones worth keeping.
    expect(pruned.read.at(-1)).toBe(ids.at(-1));
  });

  it("refuses a stored shape a newer build might have written", () => {
    expect(isAttentionState(EMPTY_ATTENTION_STATE)).toBe(true);
    for (const value of [null, undefined, 3, "x", {}, { read: [1], dismissed: [], snoozedUntil: {} }, { read: [], dismissed: [], snoozedUntil: null }, { read: [], dismissed: [], snoozedUntil: { a: 5 } }]) {
      expect(isAttentionState(value), JSON.stringify(value)).toBe(false);
    }
  });
});
