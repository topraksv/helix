import { describe, expect, it } from "vitest";
import { projectInvestmentState } from "../src/domain/investment-projection";

describe("investment projection ownership", () => {
  it("excludes watch-only transfer rows from the investment wallet", () => {
    const state = projectInvestmentState(
      { startedOn: "2026-07-01", openingCashMinor: 1_000 },
      [],
      [],
      [
        {
          id: "self-deposit",
          type: "transfer" as const,
          status: "realized" as const,
          deletedAt: null,
          effectiveDate: "2026-07-03",
          categoryId: "transfer",
          amountTryMinor: 200,
          personIsSelf: true,
        },
        {
          id: "watch-deposit",
          type: "transfer" as const,
          status: "realized" as const,
          deletedAt: null,
          effectiveDate: "2026-07-03",
          categoryId: "transfer",
          amountTryMinor: 900,
          personIsSelf: false,
        },
      ],
      [{ id: "transfer", isTransfer: true }],
    );

    expect(state.cashMinor).toBe(1_200);
  });
});
