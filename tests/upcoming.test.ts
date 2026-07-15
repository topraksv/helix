import { describe, expect, it } from "vitest";
import { standaloneUpcomingTransactions, upcomingCardStatements } from "../src/domain/upcoming";
import { tx } from "./helpers";

const TODAY = "2026-07-15";

describe("standalone upcoming transactions", () => {
  it("keeps real dated one-offs but leaves every credit-card charge to its statement", () => {
    const rows = [
      tx({ id: "cash-bill", type: "expense", amountTryMinor: 10_00, status: "pending", effectiveDate: "2026-07-20" }),
      tx({ id: "card-single", type: "expense", amountTryMinor: 20_00, status: "pending", effectiveDate: "2026-07-20", paymentSourceId: "card-1" }),
      tx({ id: "card-installment", type: "expense", amountTryMinor: 30_00, status: "pending", effectiveDate: "2026-07-21", paymentSourceId: "card-1", installmentPlanId: "plan-1" }),
      tx({ id: "aggregate", type: "expense", amountTryMinor: 40_00, status: "pending", effectiveDate: "2026-07-22", isAggregate: true }),
    ];
    expect(standaloneUpcomingTransactions(rows, new Set(["card-1"]), TODAY).map((row) => row.id)).toEqual(["cash-bill"]);
  });
});

describe("upcoming card statements", () => {
  it("creates one statement per card and sums only the earliest pending month", () => {
    const rows = [
      tx({ type: "expense", status: "pending", effectiveDate: "2026-07-20", paymentSourceId: "card-1", amountTryMinor: 100_00 }),
      tx({ type: "expense", status: "pending", effectiveDate: "2026-07-25", paymentSourceId: "card-1", amountTryMinor: 250_00 }),
      tx({ type: "expense", status: "pending", effectiveDate: "2026-08-20", paymentSourceId: "card-1", amountTryMinor: 999_00 }),
    ];
    expect(upcomingCardStatements(rows, [{ id: "card-1", name: "Kartım", dueDay: 28 }], TODAY)).toEqual([
      { cardId: "card-1", cardName: "Kartım", amountMinor: 350_00, dueDate: "2026-07-28" },
    ]);
  });

  it("shows nothing when a card has no real due date", () => {
    const rows = [tx({ type: "expense", amountTryMinor: 10_00, status: "pending", effectiveDate: "2026-07-20", paymentSourceId: "card-1" })];
    expect(upcomingCardStatements(rows, [{ id: "card-1", name: "Kartım", dueDay: null }], TODAY)).toEqual([]);
  });
});
