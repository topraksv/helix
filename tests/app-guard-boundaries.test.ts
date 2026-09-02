import { describe, expect, it } from "vitest";
import { classifyBootFailure, classifyRootRoute, resolveRootGuard } from "../src/domain/app-guard";

const signedIn = {
  ready: true,
  locked: false,
  userId: "user-a",
  onboarded: true,
  frozen: false,
  awaitingFirstPull: false,
} as const;

describe("root guard boundary decisions", () => {
  it("classifies every route area that changes guard behavior", () => {
    expect(classifyRootRoute([])).toBe("root");
    expect(classifyRootRoute(["(auth)", "sign-in"])).toBe("auth");
    expect(classifyRootRoute(["(auth)", "reset-password"])).toBe("recovery");
    expect(classifyRootRoute(["(onboarding)", "setup"])).toBe("onboarding");
    expect(classifyRootRoute(["import-wizard"])).toBe("setup-helper");
    expect(classifyRootRoute(["bulk-entry"])).toBe("setup-helper");
    expect(classifyRootRoute(["(tabs)", "dashboard"])).toBe("protected");
  });

  it("waits until both bootstrap and the lock state are resolved", () => {
    expect(resolveRootGuard({ ...signedIn, ready: false, route: "protected" }))
      .toEqual({ view: "wait", redirect: null });
    expect(resolveRootGuard({ ...signedIn, locked: null, route: "protected" }))
      .toEqual({ view: "wait", redirect: null });
    expect(resolveRootGuard({ ...signedIn, locked: true, route: "protected" }))
      .toEqual({ view: "wait", redirect: null });
  });

  it("keeps anonymous auth routes mounted and incomplete setup routes reachable", () => {
    expect(resolveRootGuard({ ...signedIn, userId: null, onboarded: null, route: "auth" }))
      .toEqual({ view: "stack", redirect: null });
    expect(resolveRootGuard({ ...signedIn, onboarded: false, route: "onboarding" }))
      .toEqual({ view: "stack", redirect: null });
  });

  it("keeps credential recovery reachable for a signed-in frozen account", () => {
    expect(resolveRootGuard({ ...signedIn, frozen: true, route: "recovery" }))
      .toEqual({ view: "stack", redirect: null });
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
