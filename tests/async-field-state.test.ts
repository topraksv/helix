/**
 * The reminder-days field is the reference case: its default arrives from a
 * live query whose first snapshot is empty. Seeding component state from that
 * unresolved value froze the placeholder `3`, and the save button — which
 * compared the frozen draft against the later-resolved `7` — stayed enabled, so
 * one tap silently overwrote the user's real setting.
 *
 * The fix is that dirtiness is USER INTENT (a draft exists), never value
 * equality, and that nothing can be saved while the stored value is unknown.
 */

import { describe, expect, it } from "vitest";

import { asyncFieldState } from "../src/domain/form-state";

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

  it("FOLLOWS a slow default instead of freezing the placeholder", () => {
    // The regression: field mounts unresolved, then the real value lands.
    const mounting = asyncFieldState(null, null);
    const resolvedLate = asyncFieldState(null, "7");
    expect(mounting.value).toBe("");
    expect(resolvedLate.value).toBe("7");
    // Critically, the save button is never armed by the transition itself.
    expect(mounting.canSave).toBe(false);
    expect(resolvedLate.canSave).toBe(false);
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
});

describe("asyncFieldState — resets", () => {
  it("returns to the persisted value after a save releases the draft", () => {
    const saved = asyncFieldState(null, "10", isPositiveInteger);
    expect(saved).toEqual({ value: "10", edited: false, canSave: false });
  });

  it("returns to the persisted value after cancelling an edit", () => {
    const editing = asyncFieldState("99", "7", isPositiveInteger);
    expect(editing.canSave).toBe(true);
    const cancelled = asyncFieldState(null, "7", isPositiveInteger);
    expect(cancelled).toEqual({ value: "7", edited: false, canSave: false });
  });

  it("follows the new account's value after an account change releases the draft", () => {
    // Account B's settings replace A's; with the draft released the field shows
    // B's value and offers no save, so A's number cannot be written into B.
    expect(asyncFieldState(null, "21", isPositiveInteger)).toEqual({
      value: "21",
      edited: false,
      canSave: false,
    });
  });

  it("never arms a save purely because the resolved value changed", () => {
    // Sync pulls a new value while the user is not editing.
    expect(asyncFieldState(null, "3").canSave).toBe(false);
    expect(asyncFieldState(null, "7").canSave).toBe(false);
    expect(asyncFieldState(null, "30").canSave).toBe(false);
  });
});
