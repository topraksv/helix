import { describe, expect, it } from "vitest";
import { shouldBlockDirtyExit } from "../src/domain/form-state";

describe("dirty form navigation contract", () => {
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
