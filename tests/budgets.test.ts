import { describe, expect, it } from "vitest";
import { budgetProgress } from "../src/domain/budgets";
import type { TxLike } from "../src/domain/types";

const tx = (id: string, categoryId: string, amountTryMinor: number, effectiveDate = "2026-07-10"): TxLike => ({
  id, type: "expense", amountTryMinor, effectiveDate, status: "realized", categoryId,
  categoryKind: "expense", paymentSourceId: null, personIsSelf: true,
  installmentPlanId: null, subscriptionId: null, isAggregate: false,
});

describe("monthly category budgets", () => {
  it("computes spent, remaining and over-budget ratio from expense flows", () => {
    const rows = budgetProgress(
      [
        { id: "food-budget", categoryId: "food", month: "2026-07", amountMinor: 10_000 },
        { id: "rent-budget", categoryId: "rent", month: "2026-07", amountMinor: 20_000 },
      ],
      [tx("food-1", "food", 12_000), tx("rent-1", "rent", 5_000)],
      "2026-07",
      "2026-07-18",
    );
    expect(rows.map((row) => row.id)).toEqual(["food-budget", "rent-budget"]);
    expect(rows[0]).toMatchObject({ spentMinor: 12_000, remainingMinor: -2_000, ratio: 1.2 });
    expect(rows[1]).toMatchObject({ spentMinor: 5_000, remainingMinor: 15_000, ratio: 0.25 });
  });

  it("ignores other months and watched-person spending", () => {
    const watched = { ...tx("watched", "food", 5_000), personIsSelf: false };
    expect(budgetProgress(
      [{ id: "food", categoryId: "food", month: "2026-07", amountMinor: 10_000 }],
      [watched, tx("old", "food", 9_000, "2026-06-30")],
      "2026-07",
      "2026-07-18",
    )[0]?.spentMinor).toBe(0);
  });
});
