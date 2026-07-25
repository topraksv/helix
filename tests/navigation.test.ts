import { describe, expect, it, vi } from "vitest";
import { ANALYSIS_SOURCES, knownSource, navigateBack, resolveBackTarget } from "../src/ui/navigation";
import { classifyRecordId } from "../src/domain/route-params";

const mockRouter = (canGoBack: boolean) => ({
  canGoBack: () => canGoBack,
  back: vi.fn(),
  replace: vi.fn(),
  navigate: vi.fn(),
});

describe("safe back navigation", () => {
  it("uses stack history when a previous screen exists", () => {
    const router = mockRouter(true);
    navigateBack(router, "/fallback");
    expect(router.back).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("returns to the screen parent for a direct link", () => {
    const router = mockRouter(false);
    navigateBack(router, "/fallback");
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/fallback");
  });

  /**
   * The recorded origin is in another tab, and this screen sits on a stack the
   * anchored push mounted at its own index. Both have to be undone: a single
   * cross-navigator replace left native standing on the anchor (the Financial
   * Table), and would have left the stack wound up even where it "worked".
   */
  it("unwinds its own stack AND moves to the recorded source", () => {
    const router = mockRouter(true);
    navigateBack(router, "/(tabs)", true);
    expect(router.back).toHaveBeenCalledOnce();
    expect(router.navigate).toHaveBeenCalledWith("/(tabs)");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("still reaches the recorded source when there is no stack to unwind", () => {
    const router = mockRouter(false);
    navigateBack(router, "/(tabs)", true);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith("/(tabs)");
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

/**
 * An exact back navigation is a `replace` to a freshly built href, so anything
 * the returned-to screen was opened with is gone unless it is handed over and
 * put back. Summary → Analysis → Budgets → back → Analysis → back landed on
 * the Financial Table: Budgets returned to the bare `/cash-flow/analytics`,
 * which erased `from=summary`, and Analysis then behaved like a deep link.
 */
type Target = string | { pathname: string; params?: Record<string, string | undefined> };

describe("an origin survives a round trip through another screen", () => {
  const analysisBack = (from: unknown, origin: unknown) =>
    resolveBackTarget<Target>(
      from,
      {
        analysis: {
          pathname: "/(tabs)/cash-flow/analytics",
          ...(knownSource(origin, ANALYSIS_SOURCES) ? { params: { from: knownSource(origin, ANALYSIS_SOURCES) } } : {}),
        },
      },
      "/(tabs)/settings",
    );

  it("returns to Analysis WITH the origin Analysis was opened with", () => {
    expect(analysisBack("analysis", "summary")).toEqual({
      href: { pathname: "/(tabs)/cash-flow/analytics", params: { from: "summary" } },
      exact: true,
    });
  });

  it("returns to a bare Analysis when it had no origin of its own", () => {
    expect(analysisBack("analysis", undefined)).toEqual({
      href: { pathname: "/(tabs)/cash-flow/analytics" },
      exact: true,
    });
  });

  it("never forwards an origin the app did not define", () => {
    for (const hostile of ["", "table", "__proto__", "constructor", "https://evil.example", "/(tabs)/settings", 7, null, {}]) {
      expect(knownSource(hostile, ANALYSIS_SOURCES)).toBeUndefined();
      expect(analysisBack("analysis", hostile)).toEqual({
        href: { pathname: "/(tabs)/cash-flow/analytics" },
        exact: true,
      });
    }
  });

  it("keeps Summary reachable from Analysis once the origin is restored", () => {
    expect(resolveBackTarget("summary", ANALYSIS_SOURCES, "/(tabs)/cash-flow")).toEqual({
      href: "/(tabs)",
      exact: true,
    });
  });
});

/**
 * The same loss with a record id: "fix this card's cycle" pushed Payment
 * Sources from a half-edited transaction/plan/subscription, and its back
 * control returned to the bare modal route — a blank NEW-record form.
 */
describe("a record being edited survives the payment-sources detour", () => {
  const withRecord = (record: unknown) => (pathname: string): Target => {
    const id = classifyRecordId(record);
    return id?.mode === "edit" ? { pathname, params: { id: id.id } } : pathname;
  };
  const sourcesBack = (from: unknown, record: unknown) => {
    const target = withRecord(record);
    return resolveBackTarget<Target>(
      from,
      {
        transaction: target("/transaction"),
        installment: target("/installment-new"),
        subscription: target("/subscription-form"),
        upcoming: "/upcoming",
      },
      "/(tabs)/settings",
    );
  };

  it("reopens the very record the user was editing", () => {
    expect(sourcesBack("transaction", "abc-123")).toEqual({
      href: { pathname: "/transaction", params: { id: "abc-123" } },
      exact: true,
    });
    expect(sourcesBack("subscription", "sub-9")).toEqual({
      href: { pathname: "/subscription-form", params: { id: "sub-9" } },
      exact: true,
    });
    expect(sourcesBack("installment", "plan-4")).toEqual({
      href: { pathname: "/installment-new", params: { id: "plan-4" } },
      exact: true,
    });
  });

  it("opens the new-record form when there was no record", () => {
    expect(sourcesBack("transaction", undefined)).toEqual({ href: "/transaction", exact: true });
  });

  it("ignores a malformed record id instead of binding it to a route", () => {
    expect(sourcesBack("transaction", ["a", "b"])).toEqual({ href: "/transaction", exact: true });
    expect(sourcesBack("transaction", "   ")).toEqual({ href: "/transaction", exact: true });
  });

  it("leaves a source that carries no record alone", () => {
    expect(sourcesBack("upcoming", "abc-123")).toEqual({ href: "/upcoming", exact: true });
  });
});
