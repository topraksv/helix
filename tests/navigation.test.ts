import { describe, expect, it, vi } from "vitest";
import { navigateBack, resolveBackTarget } from "../src/ui/navigation";

describe("safe back navigation", () => {
  it("uses stack history when a previous screen exists", () => {
    const router = { canGoBack: () => true, back: vi.fn(), replace: vi.fn() };
    navigateBack(router, "/fallback");
    expect(router.back).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("returns to the screen parent for a direct link", () => {
    const router = { canGoBack: () => false, back: vi.fn(), replace: vi.fn() };
    navigateBack(router, "/fallback");
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/fallback");
  });

  it("ignores available history when the source was recorded exactly", () => {
    const router = { canGoBack: () => true, back: vi.fn(), replace: vi.fn() };
    navigateBack(router, "/(tabs)", true);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/(tabs)");
  });
});

// Analysis sits inside the Cash Flow stack but is reachable from Summary too.
// The anchored push required for a cross-tab entry mounts that stack at its own
// index, so history says "Financial Table" for a user who came from Summary.
describe("back target for a screen with several entry points", () => {
  const sources = { summary: "/(tabs)" } as const;
  const fallback = "/(tabs)/cash-flow";

  it("returns to Summary when Summary pushed the screen", () => {
    expect(resolveBackTarget("summary", sources, fallback)).toEqual({ href: "/(tabs)", exact: true });
  });

  it("pops history normally for a same-stack entry", () => {
    expect(resolveBackTarget(undefined, sources, fallback)).toEqual({ href: fallback, exact: false });
  });

  it("treats an unknown or hostile source as a direct link, never as a match", () => {
    for (const hostile of ["", "settings", "__proto__", "toString", "constructor", 42, null, {}]) {
      expect(resolveBackTarget(hostile, sources, fallback)).toEqual({ href: fallback, exact: false });
    }
  });
});
