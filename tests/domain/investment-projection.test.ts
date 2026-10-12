import { afterEach, describe, expect, it, vi } from "vitest";
import { projectInvestmentState } from "../../src/domain/investment-projection";

afterEach(() => vi.useRealTimers());

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

describe("investment projection cash events", () => {
  it("admits only realized, live, self-owned, due transfer-category cash events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T12:00:00Z"));
    const categories = [{ id: "transfer", isTransfer: true }, { id: "expense", isTransfer: false }];
    const transactions = [
      { id: "valid", type: "transfer", status: "realized", deletedAt: null, effectiveDate: "2026-07-18", categoryId: "transfer", amountTryMinor: 100, personIsSelf: true },
      { id: "wrong-type", type: "expense", status: "realized", deletedAt: null, effectiveDate: "2026-07-18", categoryId: "transfer", amountTryMinor: 1_000, personIsSelf: true },
      { id: "pending", type: "transfer", status: "pending", deletedAt: null, effectiveDate: "2026-07-18", categoryId: "transfer", amountTryMinor: 2_000, personIsSelf: true },
      { id: "deleted", type: "transfer", status: "realized", deletedAt: "2026-07-01", effectiveDate: "2026-07-18", categoryId: "transfer", amountTryMinor: 3_000, personIsSelf: true },
      { id: "watched", type: "transfer", status: "realized", deletedAt: null, effectiveDate: "2026-07-18", categoryId: "transfer", amountTryMinor: 4_000, personIsSelf: false },
      { id: "future", type: "transfer", status: "realized", deletedAt: null, effectiveDate: "2026-07-19", categoryId: "transfer", amountTryMinor: 5_000, personIsSelf: true },
      { id: "missing-category", type: "transfer", status: "realized", deletedAt: null, effectiveDate: "2026-07-18", categoryId: null, amountTryMinor: 6_000, personIsSelf: true },
      { id: "wrong-category", type: "transfer", status: "realized", deletedAt: null, effectiveDate: "2026-07-18", categoryId: "expense", amountTryMinor: 7_000, personIsSelf: true },
    ];
    const state = projectInvestmentState(
      { startedOn: "2026-01-01", openingCashMinor: 1_000 }, [], [], transactions, categories,
    );
    expect(state.cashMinor).toBe(1_100);
  });
});
