import { describe, expect, it } from "vitest";
import {
  combineLiveQueryStatus,
  completeLiveQuery,
  failLiveQuery,
  initialLiveSnapshot,
  readSyncedFlag,
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

  it("reports an initial failure as error and preserves severity when combined", () => {
    const failed = failLiveQuery(initialLiveSnapshot<string[]>([]), 1, new Date());
    const ready = completeLiveQuery(["ok"], new Date());
    expect(failed.status).toBe("error");
    expect(combineLiveQueryStatus([ready, failed])).toBe("error");
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
        awaitingFirstPull: false,
        route: "protected",
      }),
    ).toEqual({ view: "stack", redirect: null });
  });
});
