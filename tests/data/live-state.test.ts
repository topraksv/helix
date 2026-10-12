import { describe, expect, it } from "vitest";
import {
  combineLiveStates,
  completeLiveQuery,
  failLiveQuery,
  initialLiveSnapshot,
  readSyncedFlag,
  retryDelayMs,
  startLiveQuery,
} from "../../src/data/live-state";

describe("live query state", () => {
  it("separates first loading, ready refresh and stale last-good data", () => {
    const initial = initialLiveSnapshot<number[]>([]);
    expect(initial.status).toBe("loading");

    const ready = completeLiveQuery([42], new Date("2026-07-18T10:00:00Z"));
    // A re-run of an answered query changes nothing anyone can see until it
    // answers: the same snapshot, so no subscriber renders for it.
    expect(startLiveQuery(ready)).toBe(ready);

    const stale = failLiveQuery(ready, 2, new Date("2026-07-18T10:01:00Z"));
    expect(stale).toMatchObject({ data: [42], status: "stale", error: { kind: "query_failed", attempt: 2 } });

    const recovered = completeLiveQuery([84], new Date("2026-07-18T10:02:00Z"));
    expect(recovered).toMatchObject({ data: [84], status: "ready", error: null });
  });

  it("backs off exponentially, caps the wait, and never gives up", () => {
    // The cap is what makes "retry forever" affordable: a wedged sqlite worker
    // is polled every 5s, not in a tight loop, and the screen keeps its last
    // good data with an explicit stale state while that happens.
    expect([1, 2, 3, 4, 5].map(retryDelayMs)).toEqual([250, 500, 1000, 2000, 4000]);
    expect(retryDelayMs(6)).toBe(5000);
    expect(retryDelayMs(50)).toBe(5000);
  });

  it("reports an initial failure as error and preserves severity when combined", () => {
    const failed = failLiveQuery(initialLiveSnapshot<string[]>([]), 1, new Date());
    const ready = completeLiveQuery(["ok"], new Date());
    expect(failed.status).toBe("error");
    expect(combineLiveStates([{ ...ready, retry: () => {} }, { ...failed, retry: () => {} }]).status).toBe("error");
  });
});

describe("combined live states", () => {
  const at = new Date("2026-08-06T09:00:00Z");
  const source = (snapshot: ReturnType<typeof initialLiveSnapshot<number[]>>) => ({ ...snapshot, retry: () => {} });

  it("is not ready until every source has answered, however healthy the status looks", () => {
    const answered = source(completeLiveQuery([1], at));
    const unanswered = source(initialLiveSnapshot<number[]>([]));
    expect(combineLiveStates([answered, unanswered]).ready).toBe(false);
    expect(combineLiveStates([answered, answered]).ready).toBe(true);
  });

  it("stays ready while re-running or stale — an answered query is still answered", () => {
    const rerunning = source(startLiveQuery(completeLiveQuery([1], at)));
    const stale = source(failLiveQuery(completeLiveQuery([1], at), 1, at));
    const group = combineLiveStates([rerunning, stale]);
    expect(group.ready).toBe(true);
    expect(group.status).toBe("stale");
  });

  it("reports the oldest completion, and never an Invalid Date", () => {
    const older = source(completeLiveQuery([1], new Date("2026-08-06T09:00:00Z")));
    const newer = source(completeLiveQuery([2], new Date("2026-08-06T09:05:00Z")));
    // The whole picture is only as current as its stalest source.
    expect(combineLiveStates([older, newer]).updatedAt?.toISOString()).toBe("2026-08-06T09:00:00.000Z");
    // An empty group has no moment at all. `Math.min()` is `Infinity` and
    // `new Date(Infinity)` passes every `!= null` check downstream as if the
    // data had genuinely loaded.
    expect(combineLiveStates([]).updatedAt).toBeUndefined();
  });

  it("retries every source, not just the one that failed", () => {
    const retried: string[] = [];
    const group = combineLiveStates([
      { ...completeLiveQuery([1], at), retry: () => retried.push("a") },
      { ...failLiveQuery(initialLiveSnapshot<number[]>([]), 1, at), retry: () => retried.push("b") },
    ]);
    group.retry();
    expect(retried).toEqual(["a", "b"]);
  });
});

describe("synced guard flags", () => {
  const row = (value: string) => [{ value }];
  const at = new Date("2026-07-19T10:00:00Z");

  it("resolves only once the query has completed for the signed-in user", () => {
    expect(readSyncedFlag(initialLiveSnapshot<{ value: string }[]>([]), true)).toBeNull();
    expect(readSyncedFlag(completeLiveQuery(row("true"), at), true)).toBe(true);
    expect(readSyncedFlag(completeLiveQuery(row("false"), at), true)).toBe(false);
    // A genuinely absent row is a real "not set" answer, not an unresolved one.
    expect(readSyncedFlag(completeLiveQuery([], at), true)).toBe(false);
    // Corrupt persisted JSON must fail closed, never throw into a render.
    expect(readSyncedFlag(completeLiveQuery(row("{oops"), at), true)).toBe(false);
  });

  it("stays unresolved while signed out, whatever the snapshot still holds", () => {
    expect(readSyncedFlag(completeLiveQuery(row("true"), at), false)).toBeNull();
  });
});
