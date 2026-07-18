import { beforeEach, describe, expect, it, vi } from "vitest";

const getFirstAsync = vi.fn();

vi.mock("../src/db/client", () => ({
  getSqliteAsync: vi.fn(async () => ({ getFirstAsync })),
}));

import { assertRecurringIncomeCategory } from "../src/data/repo/rule-validation";

describe("recurring income category boundary", () => {
  beforeEach(() => getFirstAsync.mockReset());

  it("requires a live category", async () => {
    await expect(assertRecurringIncomeCategory("user-a", null)).rejects.toThrow("required");
    getFirstAsync.mockResolvedValueOnce(null);
    await expect(assertRecurringIncomeCategory("user-a", "missing")).rejects.toThrow("must be income");
  });

  it("rejects expense categories and accepts income categories", async () => {
    getFirstAsync.mockResolvedValueOnce({ kind: "expense" });
    await expect(assertRecurringIncomeCategory("user-a", "expense-id")).rejects.toThrow("must be income");

    getFirstAsync.mockResolvedValueOnce({ kind: "income" });
    await expect(assertRecurringIncomeCategory("user-a", "income-id")).resolves.toBeUndefined();
    expect(getFirstAsync).toHaveBeenLastCalledWith(
      expect.stringContaining("user_id = ?"),
      ["income-id", "user-a"],
    );
  });
});
