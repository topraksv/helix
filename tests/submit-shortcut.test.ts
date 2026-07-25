/**
 * Enter belongs to the focused control before it belongs to the form.
 *
 * The submit shortcut listens on the window in the capture phase. Without this
 * rule the form's primary Save answered every Enter: focusing "Kaydet ve Yeni
 * Ekle" saved and left the screen instead of staying, focusing the refund
 * switch committed the entry instead of flipping its sign, and a category chip
 * could not be chosen with the keyboard at all.
 */

import { describe, expect, it } from "vitest";
import { focusOwnsEnterKey } from "../src/ui/submit-shortcut";

/** Minimal stand-in for a focused DOM element. */
function element(tagName: string, attributes: Record<string, string> = {}) {
  return {
    tagName,
    matches: (selector: string) =>
      selector.split(",").some((part) => {
        const token = part.trim();
        const tag = token.match(/^([a-z]+)/i)?.[1];
        const attribute = token.match(/\[([a-z-]+)(?:="([^"]*)")?\]/i);
        if (tag && tag.toUpperCase() !== tagName) return false;
        if (!attribute) return Boolean(tag);
        const [, name, value] = attribute;
        const actual = attributes[name!];
        return value === undefined ? actual !== undefined : actual === value;
      }),
  };
}

describe("focusOwnsEnterKey", () => {
  it("leaves Enter to controls that activate on Enter", () => {
    expect(focusOwnsEnterKey(element("DIV", { role: "button" }))).toBe(true);
    expect(focusOwnsEnterKey(element("BUTTON"))).toBe(true);
    expect(focusOwnsEnterKey(element("DIV", { role: "switch" }))).toBe(true);
    expect(focusOwnsEnterKey(element("DIV", { role: "radio" }))).toBe(true);
    expect(focusOwnsEnterKey(element("DIV", { role: "checkbox" }))).toBe(true);
    expect(focusOwnsEnterKey(element("DIV", { role: "tab" }))).toBe(true);
    expect(focusOwnsEnterKey(element("A", { href: "/helix/" }))).toBe(true);
    expect(focusOwnsEnterKey(element("SELECT"))).toBe(true);
    expect(focusOwnsEnterKey(element("DIV", { contenteditable: "true" }))).toBe(true);
  });

  it("keeps Enter as the form shortcut for text entry and empty focus", () => {
    expect(focusOwnsEnterKey(element("INPUT"))).toBe(false);
    expect(focusOwnsEnterKey(element("BODY"))).toBe(false);
    expect(focusOwnsEnterKey(null)).toBe(false);
    expect(focusOwnsEnterKey(undefined)).toBe(false);
  });

  it("still treats a note textarea as a newline, not a submit", () => {
    // No `matches` at all: the tag alone has to decide.
    expect(focusOwnsEnterKey({ tagName: "TEXTAREA" })).toBe(true);
  });

  it("submits when the platform gives no way to inspect the element", () => {
    expect(focusOwnsEnterKey({ tagName: "INPUT" })).toBe(false);
  });
});
