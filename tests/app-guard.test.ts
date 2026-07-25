import { describe, expect, it } from "vitest";
import { classifyRootRoute, resolveRootGuard } from "../src/domain/app-guard";
import {
  completeLiveQuery,
  initialLiveSnapshot,
  readSyncedFlag,
  snapshotForParameters,
} from "../src/data/live-state";

const base = {
  ready: true,
  locked: false,
  userId: "user-a",
  onboarded: true,
  frozen: false,
  awaitingFirstPull: false,
} as const;

describe("root guard state machine", () => {
  it("classifies recovery and onboarding helpers before generic protected routes", () => {
    expect(classifyRootRoute(["(auth)", "reset-password"])).toBe("recovery");
    expect(classifyRootRoute(["import-wizard"])).toBe("setup-helper");
    expect(classifyRootRoute(["(tabs)"])).toBe("protected");
  });

  it("never mounts protected hooks for an anonymous workspace", () => {
    expect(resolveRootGuard({ ...base, userId: null, onboarded: null, route: "protected" })).toEqual({
      view: "wait",
      redirect: "/(auth)/sign-in",
    });
  });

  it("holds an existing account for first pull, then routes a real incomplete setup", () => {
    expect(resolveRootGuard({ ...base, onboarded: false, awaitingFirstPull: true, route: "protected" })).toEqual({
      view: "wait",
      redirect: null,
    });
    expect(resolveRootGuard({ ...base, onboarded: false, route: "protected" })).toEqual({
      view: "wait",
      redirect: "/(onboarding)/setup",
    });
  });

  it("does not expose protected UI until the freeze flag resolves", () => {
    expect(resolveRootGuard({ ...base, frozen: null, route: "protected" })).toEqual({
      view: "wait",
      redirect: null,
    });
  });

  it("allows recovery and importer routes without weakening normal guards", () => {
    expect(resolveRootGuard({ ...base, onboarded: false, route: "setup-helper" }).view).toBe("stack");
    expect(resolveRootGuard({ ...base, userId: null, onboarded: null, route: "recovery" }).view).toBe("stack");
    expect(resolveRootGuard({ ...base, route: "auth" }).redirect).toBe("/(tabs)");
  });
});

/**
 * Logout → login, render by render.
 *
 * The flash was never a slow pull: it was one render. `useLive` drops a
 * snapshot whose parameters changed inside an effect, and effects run after the
 * render that changed them, so the guard read the signed-out query's resolved
 * empty result as this account's answer — "not onboarded" — and redirected to
 * Quick Start before the first-pull grace effect had even started. Once that
 * redirect lands, the onboarding route legitimately renders until the pull
 * arrives, which is the second or two the user sees.
 *
 * This replays the exact sequence through the real snapshot rules and the real
 * guard. Every step must decide "wait", never the onboarding redirect.
 */
describe("returning to an account that is already set up", () => {
  const resolvedEmpty = completeLiveQuery<{ value: string }[]>([], new Date("2026-07-25T10:00:00.000Z"));
  const pending = initialLiveSnapshot<{ value: string }[]>([]);

  const guardFor = (snapshot: typeof pending, awaitingFirstPull: boolean, route: "auth" | "onboarding" | "protected") =>
    resolveRootGuard({
      ready: true,
      locked: false,
      userId: "user-a",
      onboarded: readSyncedFlag(snapshot, true),
      frozen: null,
      awaitingFirstPull,
      route,
    });

  it("does not route to onboarding on the render the account signs in", () => {
    // The signed-out query resolved for the previous parameters; the new user
    // id is this render's question, so that answer is not available yet.
    const readable = snapshotForParameters(resolvedEmpty, '["signed-out"]', '["user-a"]', pending);
    expect(readSyncedFlag(readable, true)).toBeNull();
    expect(guardFor(readable, false, "auth")).toEqual({ view: "wait", redirect: null });
  });

  it("would have flashed Quick Start if the stale answer were readable", () => {
    // The defect, stated as a test: same render, previous parameters' snapshot.
    expect(readSyncedFlag(resolvedEmpty, true)).toBe(false);
    expect(guardFor(resolvedEmpty, false, "auth")).toEqual({
      view: "wait",
      redirect: "/(onboarding)/setup",
    });
  });

  it("keeps waiting through the empty local database until the pull lands", () => {
    const forThisUser = snapshotForParameters(resolvedEmpty, '["user-a"]', '["user-a"]', pending);
    // The workspace was wiped at sign-out, so the local answer is a real
    // "no onboarded row" — the grace is what makes it non-authoritative.
    expect(readSyncedFlag(forThisUser, true)).toBe(false);
    expect(guardFor(forThisUser, true, "auth")).toEqual({ view: "wait", redirect: null });

    const pulled = completeLiveQuery([{ value: "true" }], new Date("2026-07-25T10:00:05.000Z"));
    expect(readSyncedFlag(pulled, true)).toBe(true);
    expect(
      resolveRootGuard({
        ready: true,
        locked: false,
        userId: "user-a",
        onboarded: true,
        frozen: false,
        awaitingFirstPull: false,
        route: "auth",
      }),
    ).toEqual({ view: "wait", redirect: "/(tabs)" });
  });

  it("does not let a previous account's freeze flag gate the new one", () => {
    const previousAccountFrozen = completeLiveQuery([{ value: "true" }], new Date("2026-07-25T10:00:00.000Z"));
    const readable = snapshotForParameters(previousAccountFrozen, '["user-a"]', '["user-b"]', pending);
    expect(readSyncedFlag(readable, true)).toBeNull();
    expect(
      resolveRootGuard({
        ready: true,
        locked: false,
        userId: "user-b",
        onboarded: true,
        frozen: readSyncedFlag(readable, true),
        awaitingFirstPull: false,
        route: "protected",
      }),
    ).toEqual({ view: "wait", redirect: null });
  });
});
