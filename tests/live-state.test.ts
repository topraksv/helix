import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sourceFiles } from "./source-corpus";
import { join } from "node:path";
import {
  combineLiveStates,
  completeLiveQuery,
  failLiveQuery,
  initialLiveSnapshot,
  readSyncedFlag,
  retryDelayMs,
  startLiveQuery,
} from "../src/data/live-state";
import { resolveRootGuard } from "../src/domain/app-guard";

describe("live query state", () => {
  it("separates first loading, ready refresh and stale last-good data", () => {
    const initial = initialLiveSnapshot<number[]>([]);
    expect(initial.status).toBe("loading");

    const ready = completeLiveQuery([42], new Date("2026-07-18T10:00:00Z"));
    expect(startLiveQuery(ready)).toMatchObject({ data: [42], status: "refreshing", error: null });

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

  it("stays ready while refreshing or stale — an answered query is still answered", () => {
    const refreshing = source(startLiveQuery(completeLiveQuery([1], at)));
    const stale = source(failLiveQuery(completeLiveQuery([1], at), 1, at));
    const group = combineLiveStates([refreshing, stale]);
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

describe("live screen contract", () => {
  const root = process.cwd();
  const screens = [
    ...sourceFiles("src/app", { extensions: [".tsx"], atLeast: 40 }),
    ...sourceFiles("src/ui", { extensions: [".tsx"], atLeast: 25 }),
  ];
  const convenienceHook = /\buse(?:Categories|Persons|Sources|Subscriptions|Plans|CreditCardStatements|RecurringIncomes|ComputedColumns|CategoryBudgets|TransactionsBetween|AllTransactions|Adjustments|SettingsMap|Ledger|PendingExpected|LastEntryInfo)\(/;
  const stateHook = /\buse(?:Categories|Persons|Sources|Subscriptions|Plans|CreditCardStatements|RecurringIncomes|ComputedColumns|CategoryBudgets|TransactionsBetween|AllTransactions|Adjustments|SettingsMap|Ledger|PendingExpected|LastEntryInfo)State\(/;

  it("never lets a first-load empty collection masquerade as screen data", () => {
    for (const file of screens) {
      expect(readFileSync(join(root, file), "utf8"), file).not.toMatch(convenienceHook);
    }
  });

  it("gives every stateful financial-data screen a shared loading/retry notice", () => {
    for (const file of screens) {
      const source = readFileSync(join(root, file), "utf8");
      if (stateHook.test(source)) expect(source, file).toContain("DataStateNotice");
    }
  });

  it("asks whether the data is ready in exactly one place", () => {
    // Seventeen screens each spelled out `every(state => state.updatedAt !=
    // null)` and a retry naming every source again. Both drift the moment a
    // query is added above them and neither failure is visible — the screen
    // just renders an empty account, or stops retrying one of its sources.
    for (const file of screens) {
      expect(readFileSync(join(root, file), "utf8"), file).not.toMatch(/\.every\(\s*\(\w+\)\s*=>\s*\w+\.updatedAt/);
    }
  });
});

// A signed-in account that has not yet resolved its `onboarded` flag is not an
// un-onboarded account. Reading it as `false` is what routed a fully set-up
// user to Quick Start for ~2 seconds after logout → login.
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

  it("never shows onboarding to an existing account across sign-out → sign-in", () => {
    // Frame 1 — signed in, flag resolved: the account is on its normal screens.
    const resolved = completeLiveQuery(row("true"), at);
    expect(
      resolveRootGuard({
        ready: true,
        locked: false,
        userId: "user-a",
        onboarded: readSyncedFlag(resolved, true),
        frozen: false,
        awaitingFirstPull: false,
        route: "protected",
      }),
    ).toEqual({ view: "stack", redirect: null });

    // Frame 2 — sign-out wipes the local workspace, so the same query now
    // legitimately returns nothing for the signed-out session.
    const signedOut = completeLiveQuery<{ value: string }[]>([], at);
    expect(readSyncedFlag(signedOut, false)).toBeNull();

    // Frame 3 — sign-in re-scopes the query to the user again. `useLive` must
    // restart from an EMPTY snapshot here: the previous result answered a
    // different question. Carrying it over is the defect, so both branches are
    // asserted — the reset holds the guard, the carried snapshot flashes.
    const restarted = initialLiveSnapshot<{ value: string }[]>([]);
    const carried = startLiveQuery(signedOut);

    expect(readSyncedFlag(restarted, true)).toBeNull();
    expect(
      resolveRootGuard({
        ready: true,
        locked: false,
        userId: "user-a",
        onboarded: readSyncedFlag(restarted, true),
        frozen: false,
        awaitingFirstPull: false,
        route: "protected",
      }),
    ).toEqual({ view: "wait", redirect: null });

    // The regression this locks down: a carried snapshot reports a completion
    // that never happened for this user and sends the account to Quick Start.
    expect(carried.updatedAt).toBeDefined();
    expect(readSyncedFlag(carried, true)).toBe(false);
    expect(
      resolveRootGuard({
        ready: true,
        locked: false,
        userId: "user-a",
        onboarded: readSyncedFlag(carried, true),
        frozen: false,
        awaitingFirstPull: false,
        route: "protected",
      }).redirect,
    ).toBe("/(onboarding)/setup");

    // Frame 4 — the first pull lands and the flag resolves true again.
    const afterPull = completeLiveQuery(row("true"), new Date("2026-07-19T10:00:04Z"));
    expect(
      resolveRootGuard({
        ready: true,
        locked: false,
        userId: "user-a",
        onboarded: readSyncedFlag(afterPull, true),
        frozen: false,
        awaitingFirstPull: false,
        route: "protected",
      }),
    ).toEqual({ view: "stack", redirect: null });
  });
});
