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
      tx({ id: "bank-loan", type: "expense", amountTryMinor: 35_00, status: "pending", effectiveDate: "2026-07-21", paymentSourceId: "bank-1", installmentPlanId: "plan-2" }),
      tx({ id: "aggregate", type: "expense", amountTryMinor: 40_00, status: "pending", effectiveDate: "2026-07-22", isAggregate: true }),
    ];
    expect(standaloneUpcomingTransactions(rows, new Set(["card-1"]), TODAY).map((row) => row.id)).toEqual(["cash-bill", "bank-loan"]);
  });
});

describe("upcoming card statements", () => {
  it("creates one statement per card and sums only the earliest pending month", () => {
    const rows = [
      tx({ type: "expense", status: "pending", effectiveDate: "2026-07-28", paymentSourceId: "card-1", cardStatementId: "st-1", amountTryMinor: 100_00 }),
      tx({ type: "expense", status: "pending", effectiveDate: "2026-07-28", paymentSourceId: "card-1", cardStatementId: "st-1", amountTryMinor: 250_00 }),
      tx({ type: "expense", status: "pending", effectiveDate: "2026-08-28", paymentSourceId: "card-1", cardStatementId: "st-2", amountTryMinor: 999_00 }),
    ];
    const statements = [
      { id: "st-1", paymentSourceId: "card-1", periodMonth: "2026-07", statementDate: "2026-07-20", dueDate: "2026-07-28" },
      { id: "st-2", paymentSourceId: "card-1", periodMonth: "2026-08", statementDate: "2026-08-20", dueDate: "2026-08-28" },
    ];
    expect(upcomingCardStatements(rows, [{ id: "card-1", name: "Kartım" }], statements, TODAY)).toEqual([
      { cardId: "card-1", cardName: "Kartım", amountMinor: 350_00, dueDate: "2026-07-28" },
    ]);
  });

  it("shows nothing without a persisted real statement", () => {
    const rows = [tx({ type: "expense", amountTryMinor: 10_00, status: "pending", effectiveDate: "2026-07-20", paymentSourceId: "card-1" })];
    expect(upcomingCardStatements(rows, [{ id: "card-1", name: "Kartım" }], [], TODAY)).toEqual([]);
  });
});
