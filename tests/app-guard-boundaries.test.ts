import { describe, expect, it } from "vitest";
import { classifyRootRoute, resolveRootGuard } from "../src/domain/app-guard";

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
