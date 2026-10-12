/** Dirtiness is user intent (a draft exists), never value equality; nothing saves while the stored value is unknown. */

import { describe, expect, it } from "vitest";

import { asyncFieldState, shouldBlockDirtyExit } from "../../src/domain/form-state";

// Mirrors the reminder field's guard. `Number("")` is 0, so emptiness has to be
// rejected explicitly or clearing the box would look like a valid "0 days".
const isPositiveInteger = (value: string) =>
  value.trim() !== "" && Number.isInteger(Number(value)) && Number(value) >= 0;

describe("asyncFieldState — before the user types", () => {
  it("shows nothing and offers no save while the value is still loading", () => {
    expect(asyncFieldState(null, null)).toEqual({ value: "", edited: false, canSave: false });
  });

  it("shows the resolved value once it arrives, still with nothing to save", () => {
    expect(asyncFieldState(null, "7")).toEqual({ value: "7", edited: false, canSave: false });
  });

  it("cannot overwrite a value that never loaded", () => {
    // Load failure: resolved stays null. Even a typed draft may not be saved,
    // because the stored value is unknown and would be clobbered.
    expect(asyncFieldState("99", null).canSave).toBe(false);
    expect(asyncFieldState("99", null).edited).toBe(true);
  });
});

describe("asyncFieldState — after the user types", () => {
  it("shows the draft and offers a save when it differs and is valid", () => {
    expect(asyncFieldState("10", "7", isPositiveInteger)).toEqual({
      value: "10",
      edited: true,
      canSave: true,
    });
  });

  it("treats typing the SAME value as edited but with nothing to persist", () => {
    const state = asyncFieldState("7", "7", isPositiveInteger);
    expect(state.edited).toBe(true);
    expect(state.canSave).toBe(false);
  });

  it("refuses to save an invalid draft", () => {
    for (const draft of ["", "abc", "-1", "1.5"]) {
      expect(asyncFieldState(draft, "7", isPositiveInteger).canSave, draft).toBe(false);
    }
  });

  it("keeps the user's input when a late default arrives underneath it", () => {
    // The user typed 10 while the query was still resolving; the value landing
    // afterwards must not replace what they are editing.
    expect(asyncFieldState("10", null).value).toBe("10");
    expect(asyncFieldState("10", "7", isPositiveInteger).value).toBe("10");
  });

  it("allows a changed draft when the caller has no extra validator", () => {
    expect(asyncFieldState("10", "7")).toEqual({
      value: "10",
      edited: true,
      canSave: true,
    });
  });
});

describe("asyncFieldState — resets", () => {
  it.each(["10", "21", "3", "7", "30"])("shows the persisted %s with nothing to save once no draft exists", (resolved) => {
    expect(asyncFieldState(null, resolved, isPositiveInteger)).toEqual({ value: resolved, edited: false, canSave: false });
  });
});

describe("shouldBlockDirtyExit", () => {
  // Two booleans have exactly four states; asserting three of them left the
  // fourth free. `dirty !== explicitlyAllowed` satisfies the other three rows
  // exactly and is only refuted by the clean-and-allowed one.
  it("blocks only an unapproved exit with unsaved changes", () => {
    expect(shouldBlockDirtyExit(true, false)).toBe(true);
    expect(shouldBlockDirtyExit(false, false)).toBe(false);
    expect(shouldBlockDirtyExit(true, true)).toBe(false);
    // A saved/deleted form that already called allowExit: nothing to warn about.
    expect(shouldBlockDirtyExit(false, true)).toBe(false);
  });
});
