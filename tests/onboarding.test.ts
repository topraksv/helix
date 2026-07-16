import { describe, expect, it } from "vitest";
import { remapDraftOwnerIndex } from "../src/domain/onboarding";

describe("onboarding draft relationships", () => {
  it("reassigns a removed person's sources to self", () => {
    expect(remapDraftOwnerIndex(2, 2)).toBe(0);
  });

  it("shifts owners that followed the removed person", () => {
    expect(remapDraftOwnerIndex(3, 2)).toBe(2);
  });

  it("preserves self and earlier owners", () => {
    expect(remapDraftOwnerIndex(0, 2)).toBe(0);
    expect(remapDraftOwnerIndex(1, 2)).toBe(1);
  });
});
