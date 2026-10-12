import { describe, expect, it } from "vitest";
import { buildUpcomingTimeline, standaloneUpcomingTransactions, upcomingCardStatements } from "../../src/domain/upcoming";
import { tx } from "../helpers";

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
      { cardId: "card-1", cardName: "Kartım", statementId: "st-1", amountMinor: 350_00, paidMinor: 0, dueDate: "2026-07-28" },
    ]);
  });

  it("shows nothing without a persisted real statement", () => {
    const rows = [tx({ type: "expense", amountTryMinor: 10_00, status: "pending", effectiveDate: "2026-07-20", paymentSourceId: "card-1" })];
    expect(upcomingCardStatements(rows, [{ id: "card-1", name: "Kartım" }], [], TODAY)).toEqual([]);
  });

  it("preserves card order and ignores a mismatched statement relationship", () => {
    const rows = [
      tx({ type: "expense", status: "pending", effectiveDate: "2026-07-28", paymentSourceId: "card-2", cardStatementId: "st-1", amountTryMinor: 999_00 }),
      tx({ type: "expense", status: "pending", effectiveDate: "2026-07-28", paymentSourceId: "card-1", cardStatementId: "st-1", amountTryMinor: 100_00 }),
      tx({ type: "expense", status: "pending", effectiveDate: "2026-07-29", paymentSourceId: "card-2", cardStatementId: "st-2", amountTryMinor: 200_00 }),
    ];
    const statements = [
      { id: "st-2", paymentSourceId: "card-2", periodMonth: "2026-07", statementDate: "2026-07-21", dueDate: "2026-07-29" },
      { id: "st-1", paymentSourceId: "card-1", periodMonth: "2026-07", statementDate: "2026-07-20", dueDate: "2026-07-28" },
    ];
    expect(upcomingCardStatements(rows, [
      { id: "card-1", name: "Birinci" },
      { id: "card-2", name: "İkinci" },
    ], statements, TODAY)).toEqual([
      { cardId: "card-1", cardName: "Birinci", statementId: "st-1", amountMinor: 100_00, paidMinor: 0, dueDate: "2026-07-28" },
      { cardId: "card-2", cardName: "İkinci", statementId: "st-2", amountMinor: 200_00, paidMinor: 0, dueDate: "2026-07-29" },
    ]);
  });

  it("owes only what a partial payment left, and moves on once nothing is left", () => {
    const rows = [
      tx({ type: "expense", status: "pending", effectiveDate: "2026-07-28", paymentSourceId: "card-1", cardStatementId: "st-1", amountTryMinor: 1_000_00 }),
      tx({ type: "expense", status: "pending", effectiveDate: "2026-08-28", paymentSourceId: "card-1", cardStatementId: "st-2", amountTryMinor: 400_00 }),
    ];
    const statements = [
      { id: "st-1", paymentSourceId: "card-1", periodMonth: "2026-07", statementDate: "2026-07-20", dueDate: "2026-07-28" },
      { id: "st-2", paymentSourceId: "card-1", periodMonth: "2026-08", statementDate: "2026-08-20", dueDate: "2026-08-28" },
    ];
    const card = [{ id: "card-1", name: "Kartım" }];
    expect(upcomingCardStatements(rows, card, statements, TODAY, 45, new Map([["st-1", 300_00]]))).toEqual([
      { cardId: "card-1", cardName: "Kartım", statementId: "st-1", amountMinor: 700_00, paidMinor: 300_00, dueDate: "2026-07-28" },
    ]);
    expect(upcomingCardStatements(rows, card, statements, TODAY, 45, new Map([["st-1", 1_000_00]]))).toEqual([
      { cardId: "card-1", cardName: "Kartım", statementId: "st-2", amountMinor: 400_00, paidMinor: 0, dueDate: "2026-08-28" },
    ]);
  });
});

describe("unified upcoming timeline", () => {
  it("combines late rules, future entries and one card statement in date order", () => {
    const result = buildUpcomingTimeline({
      today: "2026-07-18",
      horizonDays: 60,
      expected: [
        { id: "late", direction: "out", kind: "subscription", refId: "sub", dueDate: "2026-07-10", amountMinor: 1000, currency: "TRY", status: "late" },
        { id: "income", direction: "in", kind: "recurring_income", refId: "income", dueDate: "2026-07-20", amountMinor: 5000, currency: "TRY", status: "pending" },
      ],
      expectedSources: [
        { id: "sub", name: "Müzik", sourceType: "subscription", categoryName: "Abonelikler" },
        { id: "income", name: "Maaş", sourceType: "recurring_income", categoryName: "Gelir" },
      ],
      categories: [{ id: "bill", name: "Fatura" }],
      cards: [],
      statements: [],
      transactions: [tx({ id: "tx", type: "expense", amountTryMinor: 2500, effectiveDate: "2026-07-22", status: "pending", categoryId: "bill", categoryKind: "expense" })],
    });
    expect(result.map((item) => item.key)).toEqual(["expected:late", "expected:income", "transaction:tx"]);
    expect(result[0]?.status).toBe("late");
    expect(result[1]?.direction).toBe("in");
  });

  it("omits completed rules, watched transactions and items past the horizon", () => {
    const result = buildUpcomingTimeline({
      today: "2026-07-18",
      horizonDays: 10,
      expected: [
        { id: "paid", direction: "out", kind: "subscription", refId: "sub", dueDate: "2026-07-20", amountMinor: 1000, currency: "TRY", status: "paid" },
        { id: "far", direction: "out", kind: "subscription", refId: "sub", dueDate: "2026-09-20", amountMinor: 1000, currency: "TRY", status: "pending" },
      ],
      expectedSources: [], categories: [], cards: [], statements: [],
      transactions: [tx({ id: "watched", type: "expense", amountTryMinor: 2500, effectiveDate: "2026-07-20", status: "pending", personIsSelf: false })],
    });
    expect(result).toEqual([]);
  });

  it("carries a variable subscription's estimate marker to the timeline", () => {
    const result = buildUpcomingTimeline({
      today: "2026-07-18",
      expected: [{
        id: "variable", direction: "out", kind: "subscription", refId: "sub", dueDate: "2026-07-20",
        amountMinor: 1000, amountIsEstimated: true, currency: "TRY", status: "pending",
      }],
      expectedSources: [{ id: "sub", name: "Elektrik", sourceType: "subscription", categoryName: null }],
      categories: [], cards: [], statements: [], transactions: [],
    });
    expect(result[0]?.amountIsEstimated).toBe(true);
  });
});

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
      { cardId: "card-1", cardName: "Bir", statementId: "early", amountMinor: 200, paidMinor: 0, dueDate: "2026-07-20" },
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
    expect(result.find((item) => item.key === "card:card-1")).toMatchObject({ kind: "card_statement", statementId: "statement", paidMinor: 0, amountMinor: 400, direction: "out" });
  });
});

describe("upcoming horizon and timeline field contracts", () => {
  const card = [{ id: "card", name: "Kart" }];
  const charge = (id: string, statementId: string, amountTryMinor: number) => tx({
    id, type: "expense", amountTryMinor, effectiveDate: "2026-07-18", status: "pending",
    paymentSourceId: "card", cardStatementId: statementId, categoryKind: "expense",
  });

  it("accepts today and horizon statements but rejects past, beyond, and zero-only statements", () => {
    expect(upcomingCardStatements([charge("today-charge", "today", 100)], card, [
      { id: "today", paymentSourceId: "card", periodMonth: "2026-07", statementDate: "2026-07-01", dueDate: "2026-07-18" },
    ], "2026-07-18", 45)[0]?.amountMinor).toBe(100);
    expect(upcomingCardStatements([charge("horizon-charge", "horizon", 200)], card, [
      { id: "horizon", paymentSourceId: "card", periodMonth: "2026-09", statementDate: "2026-09-01", dueDate: "2026-09-01" },
    ], "2026-07-18", 45)[0]?.amountMinor).toBe(200);
    expect(upcomingCardStatements([charge("past-charge", "past", 300)], card, [
      { id: "past", paymentSourceId: "card", periodMonth: "2026-07", statementDate: "2026-07-01", dueDate: "2026-07-17" },
    ], "2026-07-18", 45)).toEqual([]);
    expect(upcomingCardStatements([charge("far-charge", "far", 400)], card, [
      { id: "far", paymentSourceId: "card", periodMonth: "2026-09", statementDate: "2026-09-01", dueDate: "2026-09-02" },
    ], "2026-07-18", 45)).toEqual([]);
    expect(upcomingCardStatements([charge("zero-charge", "zero", 0)], card, [
      { id: "zero", paymentSourceId: "card", periodMonth: "2026-07", statementDate: "2026-07-01", dueDate: "2026-07-20" },
    ], "2026-07-18", 45)).toEqual([]);
  });

  it("keeps the first equal-date statement and exposes complete timeline values", () => {
    expect(upcomingCardStatements([charge("first-charge", "first", 100), charge("second-charge", "second", 200)], card, [
      { id: "first", paymentSourceId: "card", periodMonth: "2026-07", statementDate: "2026-07-01", dueDate: "2026-07-20" },
      { id: "second", paymentSourceId: "card", periodMonth: "2026-07", statementDate: "2026-07-02", dueDate: "2026-07-20" },
    ], "2026-07-18", 45)[0]?.amountMinor).toBe(100);

    const timeline = buildUpcomingTimeline({
      today: "2026-07-18", horizonDays: 2,
      expected: [
        { id: "late-future", direction: "out", kind: "subscription", refId: "source", dueDate: "2026-07-20", amountMinor: 100, amountIsEstimated: false, currency: "EUR", status: "late" },
        { id: "today", direction: "in", kind: "recurring_income", refId: "income", dueDate: "2026-07-18", amountMinor: 200, currency: "USD", status: "pending" },
      ],
      expectedSources: [
        { id: "source", name: "Kaynak", sourceType: "subscription", categoryName: "Fatura" },
        { id: "income", name: "Maaş", sourceType: "recurring_income", categoryName: "Gelir" },
      ],
      categories: [], cards: [], statements: [], transactions: [],
    });
    expect(timeline).toEqual([
      { key: "expected:today", kind: "expected", sourceType: "recurring_income", refId: "income", expectedId: "today", direction: "in", name: "Maaş", categoryName: "Gelir", amountMinor: 200, amountIsEstimated: false, currency: "USD", date: "2026-07-18", status: "upcoming" },
      { key: "expected:late-future", kind: "expected", sourceType: "subscription", refId: "source", expectedId: "late-future", direction: "out", name: "Kaynak", categoryName: "Fatura", amountMinor: 100, amountIsEstimated: false, currency: "EUR", date: "2026-07-20", status: "late" },
    ]);
  });

  it("pins late, exact-horizon, category, and TRY timeline fields", () => {
    const timeline = buildUpcomingTimeline({
      today: "2026-07-18", horizonDays: 2,
      expected: [
        { id: "past", direction: "out", kind: "subscription", refId: "past", dueDate: "2026-07-17", amountMinor: 10, currency: "EUR", status: "pending" },
        { id: "horizon", direction: "in", kind: "recurring_income", refId: "horizon", dueDate: "2026-07-20", amountMinor: 20, currency: "USD", status: "pending" },
      ],
      expectedSources: [], categories: [{ id: "food", name: "Market" }], cards: [], statements: [],
      transactions: [tx({ id: "scheduled", type: "expense", status: "pending", amountTryMinor: 30, effectiveDate: "2026-07-20", categoryId: "food", categoryKind: "expense" })],
    });
    expect(timeline).toEqual([
      { key: "expected:past", kind: "expected", sourceType: "subscription", refId: "past", expectedId: "past", direction: "out", name: null, categoryName: null, amountMinor: 10, amountIsEstimated: false, currency: "EUR", date: "2026-07-17", status: "late" },
      { key: "expected:horizon", kind: "expected", sourceType: "recurring_income", refId: "horizon", expectedId: "horizon", direction: "in", name: null, categoryName: null, amountMinor: 20, amountIsEstimated: false, currency: "USD", date: "2026-07-20", status: "upcoming" },
      { key: "transaction:scheduled", kind: "transaction", sourceType: "scheduled_transaction", refId: "scheduled", direction: "out", name: "Market", categoryName: "Market", amountMinor: 30, currency: "TRY", date: "2026-07-20", status: "upcoming" },
    ]);
  });

  it("labels persisted card statement amounts as TRY", () => {
    const timeline = buildUpcomingTimeline({
      today: "2026-07-18", horizonDays: 2, expected: [], expectedSources: [], categories: [],
      cards: [{ id: "card", name: "Kart" }],
      statements: [{ id: "statement", paymentSourceId: "card", periodMonth: "2026-07", statementDate: "2026-07-01", dueDate: "2026-07-20" }],
      transactions: [tx({ type: "expense", status: "pending", amountTryMinor: 100, effectiveDate: "2026-07-20", paymentSourceId: "card", cardStatementId: "statement", categoryKind: "expense" })],
    });
    expect(timeline[0]?.currency).toBe("TRY");
  });
});
