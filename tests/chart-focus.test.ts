import { describe, expect, it } from "vitest";
import { chartFocusReducer, type ChartFocusState } from "../src/ui/chart-focus";

/**
 * A chart carries two signals and they are not the same thing. A pointer
 * HOVERING a slice asks a passing question; a tap or a click is a decision.
 * They used to share one piece of state, so on the web a click could not be
 * held at all — moving the mouse one pixel off the row threw the selection
 * straight back — and the only way out of a selection was to find and press
 * the exact element that made it.
 */
describe("chart focus", () => {
  const none: ChartFocusState = { locked: null, hovered: null };
  const active = (s: ChartFocusState) => s.locked ?? s.hovered;

  it("previews on hover and forgets when the pointer leaves", () => {
    const hovering = chartFocusReducer(none, { type: "preview", index: 2 });
    expect(active(hovering)).toBe(2);
    expect(active(chartFocusReducer(hovering, { type: "endPreview", index: 2 }))).toBeNull();
  });

  it("holds a click after the pointer leaves", () => {
    const locked = chartFocusReducer(none, { type: "toggle", index: 3 });
    expect(active(locked)).toBe(3);
    // This is the case the web could not do before.
    expect(active(chartFocusReducer(locked, { type: "endPreview", index: 3 }))).toBe(3);
  });

  it("does not let a passing hover displace a deliberate lock", () => {
    const locked = chartFocusReducer(none, { type: "toggle", index: 1 });
    const hoveredElsewhere = chartFocusReducer(locked, { type: "preview", index: 5 });
    expect(active(hoveredElsewhere)).toBe(1);
  });

  it("moves the lock when another element is clicked", () => {
    const first = chartFocusReducer(none, { type: "toggle", index: 1 });
    expect(active(chartFocusReducer(first, { type: "toggle", index: 4 }))).toBe(4);
  });

  it("releases when the locked element is clicked again", () => {
    const locked = chartFocusReducer(none, { type: "toggle", index: 4 });
    expect(active(chartFocusReducer(locked, { type: "toggle", index: 4 }))).toBeNull();
  });

  it("releases on empty space, which is the way out that did not exist", () => {
    const locked = chartFocusReducer(none, { type: "toggle", index: 7 });
    const cleared = chartFocusReducer(locked, { type: "clear" });
    expect(cleared).toEqual({ locked: null, hovered: null });
  });

  it("drops a stale hover when a lock is taken, so releasing shows nothing", () => {
    const hovering = chartFocusReducer(none, { type: "preview", index: 2 });
    const locked = chartFocusReducer(hovering, { type: "toggle", index: 2 });
    expect(active(chartFocusReducer(locked, { type: "toggle", index: 2 }))).toBeNull();
  });
});
