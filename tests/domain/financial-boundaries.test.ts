import { describe, expect, it } from "vitest";
import { budgetProgress } from "../../src/domain/budgets";
import { tx } from "../helpers";

describe("budgets", () => {
  it("drops unusable budgets and gives equal ratios deterministic category order", () => {
    const result = budgetProgress(
      [
        { id: "z", categoryId: "zebra", month: "2026-07", amountMinor: 10_000 },
        { id: "a", categoryId: "armut", month: "2026-07", amountMinor: 10_000 },
        { id: "zero", categoryId: "zero", month: "2026-07", amountMinor: 0 },
        { id: "other", categoryId: "other", month: "2026-08", amountMinor: 10_000 },
      ],
      [
        tx({ type: "expense", amountTryMinor: 2_000, effectiveDate: "2026-07-10", categoryId: "zebra", categoryKind: "expense" }),
        tx({ type: "expense", amountTryMinor: 2_000, effectiveDate: "2026-07-10", categoryId: "armut", categoryKind: "expense" }),
      ],
      "2026-07",
      "2026-07-18",
    );

    expect(result.map(({ id, spentMinor, ratio }) => ({ id, spentMinor, ratio }))).toEqual([
      { id: "a", spentMinor: 2_000, ratio: 0.2 },
      { id: "z", spentMinor: 2_000, ratio: 0.2 },
    ]);
  });

  const spend = (categoryId: string, amountTryMinor: number, effectiveDate = "2026-07-10") =>
    tx({ type: "expense", amountTryMinor, effectiveDate, categoryId, categoryKind: "expense" });

  it("computes spent, remaining and over-budget ratio from expense flows", () => {
    const rows = budgetProgress(
      [
        { id: "food-budget", categoryId: "food", month: "2026-07", amountMinor: 10_000 },
        { id: "rent-budget", categoryId: "rent", month: "2026-07", amountMinor: 20_000 },
      ],
      [spend("food", 12_000), spend("rent", 5_000)],
      "2026-07",
      "2026-07-18",
    );
    expect(rows.map((row) => row.id)).toEqual(["food-budget", "rent-budget"]);
    expect(rows[0]).toMatchObject({ spentMinor: 12_000, remainingMinor: -2_000, ratio: 1.2 });
    expect(rows[1]).toMatchObject({ spentMinor: 5_000, remainingMinor: 15_000, ratio: 0.25 });
  });

  it("ignores other months and watched-person spending", () => {
    const watched = { ...spend("food", 5_000), personIsSelf: false };
    expect(budgetProgress(
      [{ id: "food", categoryId: "food", month: "2026-07", amountMinor: 10_000 }],
      [watched, spend("food", 9_000, "2026-06-30")],
      "2026-07",
      "2026-07-18",
    )[0]?.spentMinor).toBe(0);
  });
});
