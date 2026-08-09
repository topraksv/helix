import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createScreenVisitStore } from "../src/ui/screen-visit";

const root = process.cwd();

describe("screen visit motion", () => {
  it("does not put the visit counter in the Screen render path", () => {
    const motion = readFileSync(join(root, "src/ui/motion-primitives.tsx"), "utf8");
    const components = readFileSync(join(root, "src/ui/components.tsx"), "utf8");

    expect(motion).toContain("createScreenVisitStore");
    expect(components).toContain("useScreenVisitController");
    expect(components).not.toContain("const visit = useScreenVisit();");
  });

  it("notifies motion consumers without owning a page render", () => {
    const store = createScreenVisitStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.increment();

    expect(store.getSnapshot()).toBe(2);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    store.increment();
    expect(listener).toHaveBeenCalledOnce();
  });
});
