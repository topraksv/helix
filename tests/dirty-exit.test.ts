import { describe, expect, it } from "vitest";
import { shouldBlockDirtyExit } from "../src/domain/form-state";

describe("dirty form navigation contract", () => {
  it("blocks only an unapproved exit with unsaved changes", () => {
    expect(shouldBlockDirtyExit(true, false)).toBe(true);
    expect(shouldBlockDirtyExit(false, false)).toBe(false);
    expect(shouldBlockDirtyExit(true, true)).toBe(false);
  });
});
