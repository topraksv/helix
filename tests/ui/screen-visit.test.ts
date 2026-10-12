import { describe, expect, it, vi } from "vitest";
import { createScreenVisitStore } from "../../src/ui/screen-visit";

describe("screen visit motion", () => {
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
