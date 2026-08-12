import { describe, expect, it } from "vitest";
import {
  buildUpcomingTimeline,
  standaloneUpcomingTransactions,
  upcomingCardStatements,
} from "../src/domain/upcoming";
import { tx } from "./helpers";

const TODAY = "2026-07-15";

describe("upcoming transaction boundaries", () => {
  it("includes only self-owned, non-aggregate, non-card pending rows inside the horizon", () => {
    const valid = tx({ id: "valid", type: "expense", amountTryMinor: 100, effectiveDate: "2026-08-15", status: "pending" });
    const rows = [
      valid,
      tx({ id: "watched", type: "expense", amountTryMinor: 100, effectiveDate: "2026-07-16", status: "pending", personIsSelf: false }),
      tx({ id: "aggregate", type: "expense", amountTryMinor: 100, effectiveDate: "2026-07-16", status: "pending", isAggregate: true }),
      tx({ id: "card", type: "expense", amountTryMinor: 100, effectiveDate: "2026-07-16", status: "pending", paymentSourceId: "card-1" }),
      tx({ id: "realized", type: "expense", amountTryMinor: 100, effectiveDate: "2026-07-16", status: "realized" }),
      tx({ id: "today", type: "expense", amountTryMinor: 100, effectiveDate: TODAY, status: "pending" }),
      tx({ id: "far", type: "expense", amountTryMinor: 100, effectiveDate: "2026-08-16", status: "pending" }),
    ];

    expect(standaloneUpcomingTransactions(rows, new Set(["card-1"]), TODAY, 31).map((row) => row.id)).toEqual(["valid"]);
  });

  it("selects the earliest positive persisted statement for each known card", () => {
    const rows = [
      tx({ id: "valid-late", type: "expense", amountTryMinor: 500, effectiveDate: "2026-07-25", status: "pending", paymentSourceId: "card-1", cardStatementId: "late" }),
      tx({ id: "valid-early", type: "expense", amountTryMinor: 200, effectiveDate: "2026-07-20", status: "pending", paymentSourceId: "card-1", cardStatementId: "early" }),
      tx({ id: "watched", type: "expense", amountTryMinor: 999, effectiveDate: "2026-07-20", status: "pending", paymentSourceId: "card-1", cardStatementId: "early", personIsSelf: false }),
      tx({ id: "realized", type: "expense", amountTryMinor: 999, effectiveDate: "2026-07-20", status: "realized", paymentSourceId: "card-1", cardStatementId: "early" }),
      tx({ id: "unlinked", type: "expense", amountTryMinor: 999, effectiveDate: "2026-07-20", status: "pending", paymentSourceId: "card-1" }),
      tx({ id: "income", type: "income", amountTryMinor: 999, effectiveDate: "2026-07-20", status: "pending", paymentSourceId: "card-1", cardStatementId: "early", categoryKind: "income" }),
      tx({ id: "refund-only", type: "expense", amountTryMinor: -100, effectiveDate: "2026-07-20", status: "pending", paymentSourceId: "card-2", cardStatementId: "zero" }),
    ];
    const statements = [
      { id: "unknown-card", paymentSourceId: "missing", periodMonth: "2026-07", statementDate: "2026-07-15", dueDate: "2026-07-20" },
      { id: "past", paymentSourceId: "card-1", periodMonth: "2026-06", statementDate: "2026-06-10", dueDate: "2026-07-14" },
      { id: "far", paymentSourceId: "card-1", periodMonth: "2026-09", statementDate: "2026-09-10", dueDate: "2026-09-20" },
      { id: "late", paymentSourceId: "card-1", periodMonth: "2026-08", statementDate: "2026-08-10", dueDate: "2026-08-10" },
      { id: "early", paymentSourceId: "card-1", periodMonth: "2026-07", statementDate: "2026-07-10", dueDate: "2026-07-20" },
      { id: "later-again", paymentSourceId: "card-1", periodMonth: "2026-08", statementDate: "2026-08-11", dueDate: "2026-08-11" },
      { id: "zero", paymentSourceId: "card-2", periodMonth: "2026-07", statementDate: "2026-07-10", dueDate: "2026-07-20" },
    ];

    expect(upcomingCardStatements(rows, [
      { id: "card-1", name: "Bir" },
      { id: "card-2", name: "İki" },
      { id: "card-3", name: "Üç" },
    ], statements, TODAY, 45)).toEqual([
      { cardId: "card-1", cardName: "Bir", amountMinor: 200, dueDate: "2026-07-20" },
    ]);
  });
});

describe("upcoming timeline boundaries", () => {
  it("fills safe fallbacks, includes a card, and sorts same-day items by stable key", () => {
    const result = buildUpcomingTimeline({
      today: TODAY,
      horizonDays: 31,
      expected: [
        { id: "z", direction: "in", kind: "recurring_income", refId: "unknown-income", dueDate: "2026-07-20", amountMinor: 300, currency: "TRY", status: "pending" },
        { id: "a", direction: "out", kind: "subscription", refId: "unknown-sub", dueDate: "2026-07-20", amountMinor: 100, currency: "TRY", status: "pending" },
      ],
      expectedSources: [],
      categories: [{ id: "known", name: "Bilinen" }],
      cards: [{ id: "card-1", name: "Kart" }],
      statements: [{ id: "statement", paymentSourceId: "card-1", periodMonth: "2026-07", statementDate: "2026-07-15", dueDate: "2026-07-20" }],
      transactions: [
        tx({ id: "unknown-category", type: "income", amountTryMinor: 200, effectiveDate: "2026-07-20", status: "pending", categoryId: "missing", categoryKind: "income" }),
        tx({ id: "no-category", type: "expense", amountTryMinor: 250, effectiveDate: "2026-07-21", status: "pending", categoryId: null, categoryKind: null }),
        tx({ id: "card-charge", type: "expense", amountTryMinor: 400, effectiveDate: "2026-07-20", status: "pending", paymentSourceId: "card-1", cardStatementId: "statement", categoryKind: "expense" }),
      ],
    });

    expect(result.map((item) => item.key)).toEqual([
      "card:card-1",
      "expected:a",
      "expected:z",
      "transaction:unknown-category",
      "transaction:no-category",
    ]);
    expect(result.find((item) => item.key === "expected:a")).toMatchObject({ sourceType: "subscription", name: null, categoryName: null });
    expect(result.find((item) => item.key === "expected:z")).toMatchObject({ sourceType: "recurring_income", direction: "in" });
    expect(result.find((item) => item.key === "transaction:unknown-category")).toMatchObject({ name: null, categoryName: null, direction: "in" });
    expect(result.find((item) => item.key === "card:card-1")).toMatchObject({ kind: "card_statement", amountMinor: 400, direction: "out" });
  });
});
