import { describe, expect, it } from "vitest";
import { classifyBootFailure, classifyRootRoute, resolveRootGuard } from "../../src/domain/app-guard";
import {
  completeLiveQuery,
  initialLiveSnapshot,
  readSyncedFlag,
  snapshotForParameters,
} from "../../src/data/live-state";

const base = {
  ready: true,
  locked: false,
  userId: "user-a",
  onboarded: true,
  frozen: false,
  awaitingFirstPull: false,
} as const;

describe("root guard state machine", () => {
  it("never mounts protected hooks for an anonymous workspace", () => {
    expect(resolveRootGuard({ ...base, userId: null, onboarded: null, route: "protected" })).toEqual({
      view: "wait",
      redirect: "/(auth)/sign-in",
    });
  });

  it("sends a signed-out visitor to sign-in from onboarding too", () => {
    expect(resolveRootGuard({ ...base, userId: null, onboarded: null, route: "onboarding" })).toEqual({
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

  it("allows importer routes without weakening normal guards", () => {
    expect(resolveRootGuard({ ...base, onboarded: false, route: "setup-helper" }).view).toBe("stack");
    expect(resolveRootGuard({ ...base, route: "auth" }).redirect).toBe("/(tabs)");
  });

  /** The KVKK notice must open in every session state: the disclosure is required before an account exists. */
  it("opens the legal notice in every session state", () => {
    expect(classifyRootRoute(["privacy"])).toBe("public");
    // Sign-in sends a failure to the feedback form, which needs no account.
    expect(classifyRootRoute(["feedback"])).toBe("public");
    for (const state of [
      { userId: null, onboarded: null, frozen: null },
      { userId: "user-a", onboarded: false, frozen: null },
      { userId: "user-a", onboarded: true, frozen: null },
      { userId: "user-a", onboarded: true, frozen: true },
    ]) {
      expect(resolveRootGuard({ ...base, ...state, route: "public" })).toEqual({
        view: "stack",
        redirect: null,
      });
    }
  });

  /** Opening one route to everyone must not open the rest. */
  it("keeps every other route guarded while signed out", () => {
    for (const route of ["protected", "onboarding", "setup-helper", "root"] as const) {
      expect(resolveRootGuard({ ...base, userId: null, onboarded: null, route }).redirect)
        .toBe("/(auth)/sign-in");
    }
  });
});

describe("root guard boundary decisions", () => {
  it("classifies every route area that changes guard behavior", () => {
    expect(classifyRootRoute([])).toBe("root");
    expect(classifyRootRoute(["(auth)", "sign-in"])).toBe("auth");
    expect(classifyRootRoute(["(onboarding)", "setup"])).toBe("onboarding");
    expect(classifyRootRoute(["import-wizard"])).toBe("setup-helper");
    expect(classifyRootRoute(["bulk-entry"])).toBe("setup-helper");
    expect(classifyRootRoute(["(tabs)", "dashboard"])).toBe("protected");
  });

  it("waits until both bootstrap and the lock state are resolved", () => {
    expect(resolveRootGuard({ ...base, ready: false, route: "protected" }))
      .toEqual({ view: "wait", redirect: null });
    expect(resolveRootGuard({ ...base, locked: null, route: "protected" }))
      .toEqual({ view: "wait", redirect: null });
    expect(resolveRootGuard({ ...base, locked: true, route: "protected" }))
      .toEqual({ view: "wait", redirect: null });
  });

  it("keeps anonymous auth routes mounted and incomplete setup routes reachable", () => {
    expect(resolveRootGuard({ ...base, userId: null, onboarded: null, route: "auth" }))
      .toEqual({ view: "stack", redirect: null });
    expect(resolveRootGuard({ ...base, onboarded: false, route: "onboarding" }))
      .toEqual({ view: "stack", redirect: null });
  });

  it("pins the route guard's protected/setup-helper distinction and redirects", () => {
    expect(classifyRootRoute(["(auth)", "other"])).toBe("auth");
    expect(resolveRootGuard({ ...base, route: "protected" })).toEqual({ view: "stack", redirect: null });
    expect(resolveRootGuard({ ...base, route: "setup-helper" })).toEqual({ view: "stack", redirect: null });
    expect(resolveRootGuard({ ...base, route: "root" })).toEqual({ view: "wait", redirect: "/(tabs)" });
  });
});

/**
 * Which ending the boot screen shows.
 *
 * The two are not cosmetic variants of one message. "Another tab has it" ends
 * by closing that tab and needs no action here; anything else is a retry. Get
 * it backwards and the screen tells someone to retry a thing that provably
 * cannot succeed in this document, or tells someone whose database is actually
 * damaged to go looking for a second tab that does not exist.
 */
describe("boot failure classification", () => {
  it("recognises the app already holding the database elsewhere", () => {
    // The four shapes this arrives in: wa-sqlite's own VFS message, the OPFS
    // DOMException underneath it, and SQLite's own lock errors on native.
    expect(classifyBootFailure(new Error("Error: Invalid VFS state"))).toBe("busy");
    expect(classifyBootFailure(new Error("NoModificationAllowedError: could not create handle"))).toBe("busy");
    expect(classifyBootFailure(new Error("failed to create sync access handle"))).toBe("busy");
    expect(classifyBootFailure(new Error("database is locked"))).toBe("busy");
  });

  it("reads a DOMException by its name as well as its text", () => {
    expect(classifyBootFailure(Object.assign(new Error("boom"), { name: "NoModificationAllowedError" }))).toBe("busy");
  });

  it("sends everything else to the ending that offers a retry", () => {
    expect(classifyBootFailure(new Error("file is not a database"))).toBe("unknown");
    expect(classifyBootFailure(new Error("disk I/O error"))).toBe("unknown");
    expect(classifyBootFailure("migration 0007 failed")).toBe("unknown");
    expect(classifyBootFailure(null)).toBe("unknown");
    expect(classifyBootFailure(undefined)).toBe("unknown");
  });

  it("reads the stringified error the boot screen actually holds", () => {
    // `_layout.tsx` stores `String(error)`, not the Error itself.
    expect(classifyBootFailure(String(new Error("Invalid VFS state")))).toBe("busy");
  });
});

/** Logout → login, render by render: `useLive` drops a changed-params snapshot only after the render, so every step here must decide "wait", never the onboarding redirect. */
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

