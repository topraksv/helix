import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLedger, buildLedgerBundle, currentBalance, projectedBalance, resolveLedgerAnchor } from "../src/domain/balance";
import { projectInvestmentState } from "../src/domain/investment-projection";
import { isValidItemParams } from "../src/domain/route-params";
import {
  findSubscriptionCategory,
  AMOUNT_LABELS,
  occurrenceAmountText,
} from "../src/domain/subscriptions";
import { previewTryMinor, resolveTransactionSave, type TransactionDraft } from "../src/domain/transaction-draft";
import { projectedTransactionFlow } from "../src/domain/transactions";
import { buildUpcomingTimeline, upcomingCardStatements } from "../src/domain/upcoming";
import { resolveYearColumns } from "../src/domain/year-columns";
import { required, tx } from "./helpers";

afterEach(() => vi.useRealTimers());

describe("mutation-sensitive balance contract", () => {
  it("back-anchors only strictly earlier realized flows and adjustments", () => {
    const result = resolveLedgerAnchor(
      "2026-01", 1_000,
      [
        tx({ type: "expense", amountTryMinor: 100, effectiveDate: "2025-12-31", categoryKind: "expense" }),
        tx({ type: "income", amountTryMinor: 200, effectiveDate: "2026-01-01", categoryKind: "income" }),
        tx({ type: "expense", amountTryMinor: 999, effectiveDate: "2025-11-01", status: "pending", categoryKind: "expense" }),
      ],
      [
        { date: "2025-12-31", amountMinor: 50 },
        { date: "2026-01-01", amountMinor: 500 },
        { date: "2027-01-01", amountMinor: 9_999 },
      ],
      "2026-07-01",
    );
    expect(result).toEqual({ startMonth: "2025-11", openingBalanceMinor: 1_050 });
  });

  it("back-anchors from adjustments while excluding future corrections", () => {
    expect(resolveLedgerAnchor(
      "2026-01", 1_000, [], [{ date: "2025-12-31", amountMinor: 50 }], "2026-07-18",
    )).toEqual({ startMonth: "2025-12", openingBalanceMinor: 950 });
    expect(resolveLedgerAnchor(
      "2027-01", 1_000, [], [{ date: "2026-08-01", amountMinor: 50 }], "2026-07-18",
    )).toEqual({ startMonth: "2026-08", openingBalanceMinor: 1_000 });
    expect(resolveLedgerAnchor(
      "2027-01", 1_000, [], [{ date: "2026-07-18", amountMinor: 50 }], "2026-07-18",
    )).toEqual({ startMonth: "2026-07", openingBalanceMinor: 950 });
  });

  it("keeps pending cells and future adjustments out of realized balances", () => {
    const ledger = buildLedger({
      openingBalanceMinor: 1_000, startMonth: "2026-07", endMonth: "2026-07", today: "2026-07-18",
      includePendingInCells: false,
      transactions: [tx({ status: "pending", type: "expense", amountTryMinor: 100, effectiveDate: "2026-07-18", categoryId: "food", categoryKind: "expense" })],
      adjustments: [{ date: "2026-07-19", amountMinor: 500 }],
    });
    expect(ledger[0]?.byCategory).toEqual(new Map());
    expect(ledger[0]?.adjustmentMinor).toBe(0);
    expect(ledger[0]?.closingMinor).toBe(1_000);
    const withPendingCells = buildLedger({
      openingBalanceMinor: 1_000, startMonth: "2026-07", endMonth: "2026-07", today: "2026-07-18",
      includePendingInCells: true,
      transactions: [
        tx({ status: "realized", personIsSelf: false, type: "expense", amountTryMinor: 100, effectiveDate: "2026-07-18", categoryId: "food", categoryKind: "expense" }),
        tx({ status: "realized", personIsSelf: true, type: "expense", amountTryMinor: 200, effectiveDate: "2026-07-19", categoryId: "food", categoryKind: "expense" }),
      ],
      adjustments: [],
    });
    expect(withPendingCells[0]?.byCategory).toEqual(new Map());
    expect(currentBalance({
      openingBalanceMinor: 1_000, transactions: [],
      adjustments: [{ date: "2026-07-18", amountMinor: 50 }], today: "2026-07-18",
    })).toBe(1_050);
  });

  it("uses the direct current calculation when the ledger begins after today", () => {
    const bundle = required(buildLedgerBundle({
      configuredStart: "2027-01", openingBalanceMinor: 1_000, includePendingInCells: false,
      transactions: [tx({ type: "income", amountTryMinor: 100, effectiveDate: "2027-01-01", categoryKind: "income" })],
      adjustments: [{ date: "2027-01-01", amountMinor: 50 }],
      year: 2027, today: "2026-07-18",
    }));
    expect(bundle.actualBalanceMinor).toBe(1_000);
    expect(bundle.startMonth).toBe("2027-01");
    expect(bundle.txLike).toHaveLength(1);
  });

  it("includes a flow exactly on the forecast horizon and excludes the next day", () => {
    expect(projectedBalance(1_000, [
      { direction: "in", amountTryMinor: 200, date: "2026-07-31" },
      { direction: "out", amountTryMinor: 300, date: "2026-08-01" },
    ], "2026-07-31")).toBe(1_200);
  });
});

describe("mutation-sensitive investment projection", () => {
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

describe("mutation-sensitive transaction form and classification", () => {
  const valid: TransactionDraft = {
    dataReady: true, type: "expense", amountMinor: 100, isReversal: false, currency: "TRY", rateTry: 1,
    categoryId: "cat", person: { id: "self", isSelf: true }, dateValid: true, installmentValid: true,
    cardCycleValid: true, installment: false,
  };

  it("distinguishes zero, reversal, readiness, and every validation flag", () => {
    expect(previewTryMinor(100, false, 1)).toBe(100);
    expect(previewTryMinor(100, true, 1)).toBe(-100);
    expect(previewTryMinor(null, false, 1)).toBeNull();
    expect(previewTryMinor(100, false, null)).toBeNull();
    expect(resolveTransactionSave({ ...valid, amountMinor: 0 })).toBeNull();
    expect(resolveTransactionSave({ ...valid, amountMinor: -1 })).toBeNull();
    expect(resolveTransactionSave({ ...valid, amountMinor: 1, rateTry: 0.1 })).toBeNull();
    for (const patch of [
      { dataReady: false }, { dateValid: false }, { installmentValid: false }, { cardCycleValid: false },
      { categoryId: null }, { person: null }, { rateTry: null }, { installment: true, isReversal: true },
    ]) expect(resolveTransactionSave({ ...valid, ...patch })).toBeNull();
    expect(resolveTransactionSave({ ...valid, isReversal: true })).toEqual({
      amountMinor: 100, signedAmountMinor: -100, tryMinor: -100, rateTry: 1,
      person: { id: "self", isSelf: true }, categoryId: "cat",
    });
  });

  it("classifies zero projected effects as incoming with an explicit direction", () => {
    expect(projectedTransactionFlow(tx({ type: "income", amountTryMinor: 0, effectiveDate: "2026-07-18", categoryKind: "income" })))
      .toEqual({ direction: "in", amountTryMinor: 0 });
  });
});

describe("mutation-sensitive upcoming contract", () => {
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
});

describe("mutation-sensitive membership and route contracts", () => {
  it("rejects prefixed, suffixed, and exclusive-boundary route years", () => {
    expect(isValidItemParams("id", "1970", "category")).toEqual({ col: "id", year: 1970, kind: "category" });
    expect(isValidItemParams("id", "2999", "computed")).toEqual({ col: "id", year: 2999, kind: "computed" });
    for (const year of ["1969", "3000", "x2026", "2026x"]) expect(isValidItemParams("id", year, "category")).toBeNull();
    expect(isValidItemParams("id", "2026 ", "category")).toBeNull();
  });

  it("never admits inactive recorded ids or duplicates active recorded members", () => {
    const categories = [{ id: "active", isColumn: true }, { id: "inactive", isColumn: false }, { id: "new", isColumn: true }];
    expect(resolveYearColumns(categories, { "2026": ["active", "inactive", "active"] }, 2026, 2027, new Set()))
      .toEqual([{ id: "active", isColumn: true }]);
  });

  it("normalizes category names without changing category eligibility", () => {
    const categories = [
      { id: "match", name: "  ABONELİKLER   VE SERVİSLER ", kind: "expense" as const, deletedAt: null },
      { id: "income", name: "Abonelikler ve Servisler", kind: "income" as const, deletedAt: null },
    ];
    expect(findSubscriptionCategory(categories, "abonelikler ve servisler")?.id).toBe("match");
    expect(findSubscriptionCategory([
      { id: "wrong", name: "Market", kind: "expense", deletedAt: null },
      { id: "right", name: "Abonelikler", kind: "expense", deletedAt: null },
    ], "abonelikler")?.id).toBe("right");
    expect(findSubscriptionCategory([
      { id: "spacing", name: "ab c", kind: "expense", deletedAt: null },
    ], "a bc")).toBeNull();
    expect(findSubscriptionCategory([
      { id: "income-only", name: "Abonelikler", kind: "income", deletedAt: null },
    ], "abonelikler")).toBeNull();
    expect(findSubscriptionCategory([
      { id: "deleted-only", name: "Abonelikler", kind: "expense", deletedAt: "2026-07-01" },
    ], "abonelikler")).toBeNull();
    expect(occurrenceAmountText({ amountMinor: 0, currency: "TRY", amountIsEstimated: true }, () => "formatted", { unknown: "Bilinmiyor", estimated: "Tahmini" }))
      .toBe("Bilinmiyor");
    expect(AMOUNT_LABELS).toEqual({ unknown: "Tutar belirtilmedi", estimated: "Tahmini tutar" });
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
