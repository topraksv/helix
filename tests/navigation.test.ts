import { readFileSync } from "node:fs";
import { sourceFiles } from "./source-corpus";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { navigateBack, registerDirtyExitFallback } from "../src/ui/navigation";

const root = process.cwd();
const mockRouter = (canGoBack: boolean) => ({
  canGoBack: () => canGoBack,
  back: vi.fn(),
  replace: vi.fn(),
});

describe("safe back navigation", () => {
  it("uses stack history when a previous screen exists", () => {
    const router = mockRouter(true);
    navigateBack(router, "/fallback");
    expect(router.back).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("returns to the screen parent for a direct link", () => {
    const router = mockRouter(false);
    navigateBack(router, "/fallback");
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/fallback");
  });

  it("lets a focused dirty form confirm before a direct-link fallback", () => {
    const router = mockRouter(false);
    const confirm = vi.fn((action: () => void) => {
      action();
      return true;
    });
    const unregister = registerDirtyExitFallback(confirm);
    navigateBack(router, "/fallback");
    unregister();
    expect(confirm).toHaveBeenCalledOnce();
    expect(router.replace).toHaveBeenCalledWith("/fallback");
  });

  it("does not replace a direct link twice when the guard owns the exit", () => {
    const router = mockRouter(false);
    const unregister = registerDirtyExitFallback(() => true);
    navigateBack(router, "/fallback");
    unregister();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("lets a dirty form choose its deterministic parent before browser history", () => {
    const router = mockRouter(true);
    const unregister = registerDirtyExitFallback((action) => {
      action();
      return true;
    });
    navigateBack(router, "/fallback");
    unregister();
    expect(router.replace).toHaveBeenCalledWith("/fallback");
    expect(router.back).not.toHaveBeenCalled();
  });
});

/**
 * The structural rule that replaced the recorded-origin subsystem.
 *
 * A screen that lives in one tab but is reachable from another used to be
 * pushed with `{ withAnchor: true }`, which mounts that tab's index underneath.
 * Plain history then popped to a screen the user had never visited, so the back
 * button was taught to navigate to a recorded origin instead — and the iOS edge
 * swipe, which pops the stack without consulting any of that, kept landing on
 * the anchor.
 *
 * Those screens now have a root-level route, and a cross-tab push goes there.
 * What sits underneath is the screen the user came from, so history is right
 * for the button and the gesture alike. These assertions guard the structure,
 * because the structure is what makes the two agree.
 */
describe("cross-tab screens are reachable at the root", () => {
  const appDir = join(root, "src/app");
  const source = (path: string) => readFileSync(join(appDir, path), "utf8");
  const multiEntry = [
    { file: "analytics.tsx", inTab: "(tabs)/cash-flow/analytics" },
    { file: "payment-sources.tsx", inTab: "(tabs)/settings/payment-sources" },
    { file: "incomes.tsx", inTab: "(tabs)/settings/incomes" },
    { file: "budgets.tsx", inTab: "(tabs)/settings/budgets" },
  ];

  it("gives every multi-entry screen a root route over the same component", () => {
    for (const { file, inTab } of multiEntry) {
      expect(source(file), `${file} must re-export ${inTab}`).toContain(`export { default } from "./${inTab}"`);
    }
  });

  it("registers each of them on the root stack", () => {
    const layout = source("_layout.tsx");
    for (const { file } of multiEntry) {
      const name = file.replace(".tsx", "");
      expect(layout, `${name} needs a root Stack.Screen`).toContain(`<Stack.Screen name="${name}"`);
    }
  });

  /**
   * The anchor is the mechanism this design removes. One left behind would
   * reintroduce exactly the split it was removed to close: a button that goes
   * one way and a swipe that goes another.
   */
  it("pushes nothing with an anchor anywhere in the app", () => {
    // Comments are stripped first: the rule is about what the app does, and
    // the files that explain why the anchor is gone have to be able to name it.
    const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const offenders = sourceFiles("src/app", { extensions: [".tsx"], atLeast: 40 })
      .filter((path) => code(readFileSync(join(root, path), "utf8")).includes("withAnchor"));
    expect(offenders).toEqual([]);
  });
});
