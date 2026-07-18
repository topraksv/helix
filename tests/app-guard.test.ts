import { describe, expect, it } from "vitest";
import { classifyRootRoute, resolveRootGuard } from "../src/domain/app-guard";

const base = {
  ready: true,
  locked: false,
  userId: "user-a",
  onboarded: true,
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

  it("allows recovery and importer routes without weakening normal guards", () => {
    expect(resolveRootGuard({ ...base, onboarded: false, route: "setup-helper" }).view).toBe("stack");
    expect(resolveRootGuard({ ...base, userId: null, onboarded: null, route: "recovery" }).view).toBe("stack");
    expect(resolveRootGuard({ ...base, route: "auth" }).redirect).toBe("/(tabs)");
  });
});
