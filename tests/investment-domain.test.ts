import { describe, expect, it } from "vitest";
import {
  InvestmentDomainError,
  buildInvestmentState,
  parseInvestmentQuantity,
  resolveInvestmentQuote,
  type InvestmentCashEvent,
  type InvestmentOperationLike,
} from "../src/domain/investments";

const product = {
  id: "product-1",
  assetType: "metal" as const,
  name: "Gram Altın",
};

function operation(
  id: string,
  kind: InvestmentOperationLike["kind"],
  date: string,
  totalMinor: number,
  quantity: string | null,
): InvestmentOperationLike {
  return {
    id,
    productId: product.id,
    kind,
    operationDate: date,
    quantity,
    unitPriceMinor: quantity ? resolveInvestmentQuote({ quantity, totalMinor }).unitPriceMinor : null,
    totalMinor,
  };
}

describe("investment decimal and quote rules", () => {
  it("normalizes fractional Turkish and dot-decimal quantities without floats", () => {
    expect(parseInvestmentQuantity("17,23").normalized).toBe("17.23");
    expect(parseInvestmentQuantity("456.12000000").normalized).toBe("456.12");
    expect(parseInvestmentQuantity("1.234,5678").normalized).toBe("1234.5678");
  });

  it("derives the missing value from any two quote fields", () => {
    expect(resolveInvestmentQuote({ quantity: "17,23", totalMinor: 100_000_00 })).toEqual({
      quantity: "17.23",
      unitPriceMinor: 580_383,
      totalMinor: 100_000_00,
    });
    expect(resolveInvestmentQuote({ quantity: "2.5", unitPriceMinor: 12_345 })).toEqual({
      quantity: "2.5",
      unitPriceMinor: 12_345,
      totalMinor: 30_863,
    });
    expect(resolveInvestmentQuote({ unitPriceMinor: 12_345, totalMinor: 30_863 })).toEqual({
      quantity: "2.5000405",
      unitPriceMinor: 12_345,
      totalMinor: 30_863,
    });
  });

  it("accepts one-kuruş rounding tolerance and rejects a contradictory triple", () => {
    expect(resolveInvestmentQuote({ quantity: "3", unitPriceMinor: 333, totalMinor: 1_000 }).totalMinor).toBe(1_000);
    expect(() => resolveInvestmentQuote({ quantity: "3", unitPriceMinor: 333, totalMinor: 1_010 }))
      .toThrowError(InvestmentDomainError);
    expect(() => resolveInvestmentQuote({ quantity: "100", totalMinor: 49 }))
      .toThrowError(InvestmentDomainError);
  });
});

describe("investment wallet and weighted-cost invariants", () => {
  it("keeps existing holdings outside cash and applies transfers from the cutoff only", () => {
    const cashEvents: InvestmentCashEvent[] = [
      { id: "old", date: "2026-01-01", amountMinor: 50_000_00 },
      { id: "deposit", date: "2026-07-02", amountMinor: 20_000_00 },
      { id: "refund", date: "2026-07-04", amountMinor: -2_000_00 },
    ];
    const operations = [
      operation("existing", "existing", "2026-06-01", 100_000_00, "17.23"),
      operation("buy", "buy", "2026-07-03", 5_000_00, "1"),
    ];
    const state = buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 10_000_00,
      products: [product],
      operations,
      cashEvents,
    });

    expect(state.cashMinor).toBe(23_000_00);
    expect(state.investedCostMinor).toBe(105_000_00);
    expect(state.products[0]).toMatchObject({
      quantity: "18.23",
      costMinor: 105_000_00,
    });
  });

  it("uses weighted average cost for partial and full sales and returns proceeds to cash", () => {
    const operations = [
      operation("buy-1", "buy", "2026-07-01", 10_000, "10"),
      operation("buy-2", "buy", "2026-07-02", 12_000, "5"),
      operation("sale-1", "sell", "2026-07-03", 9_000, "6"),
    ];
    const partial = buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 30_000,
      products: [product],
      operations,
      cashEvents: [],
    });
    expect(partial.cashMinor).toBe(17_000);
    expect(partial.products[0]).toMatchObject({
      quantity: "9",
      costMinor: 13_200,
      realizedProfitLossMinor: 200,
    });
    expect(partial.operationResults.get("sale-1")).toEqual({
      costBasisMinor: 8_800,
      realizedProfitLossMinor: 200,
    });

    const full = buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 30_000,
      products: [product],
      operations: [...operations, operation("sale-2", "sell", "2026-07-04", 14_000, "9")],
      cashEvents: [],
    });
    expect(full.cashMinor).toBe(31_000);
    expect(full.products[0]).toMatchObject({
      quantity: "0",
      costMinor: 0,
      realizedProfitLossMinor: 1_000,
      active: false,
    });
  });

  it("supports amount-only BES contributions but refuses quantity-based sales afterward", () => {
    const pension = { id: "pension-1", assetType: "pension" as const, name: "BES Planım" };
    const contribution: InvestmentOperationLike = {
      id: "bes-1",
      productId: pension.id,
      kind: "contribution",
      operationDate: "2026-07-01",
      quantity: null,
      unitPriceMinor: null,
      totalMinor: 5_000,
    };
    const state = buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 10_000,
      products: [pension],
      operations: [contribution],
      cashEvents: [],
    });
    expect(state.products[0]).toMatchObject({ quantity: null, costMinor: 5_000 });
    expect(() => buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 10_000,
      products: [pension],
      operations: [
        contribution,
        {
          ...operation("sale", "sell", "2026-07-02", 1_000, "1"),
          productId: pension.id,
        },
      ],
      cashEvents: [],
    })).toThrow("quantity is unknown");
  });

  it("keeps the BES contribution operation exclusive to pension products", () => {
    expect(() => buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 10_000,
      products: [product],
      operations: [{
        id: "wrong-contribution",
        productId: product.id,
        kind: "contribution",
        operationDate: "2026-07-01",
        quantity: null,
        unitPriceMinor: null,
        totalMinor: 5_000,
      }],
      cashEvents: [],
    })).toThrow("does not match product type");
  });

  it("rejects insufficient cash and overselling without producing a state", () => {
    expect(() => buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 9_999,
      products: [product],
      operations: [operation("buy", "buy", "2026-07-01", 10_000, "1")],
      cashEvents: [],
    })).toThrow("insufficient investment cash");

    expect(() => buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 20_000,
      products: [product],
      operations: [
        operation("buy", "buy", "2026-07-01", 10_000, "1"),
        operation("sell", "sell", "2026-07-02", 11_000, "1.01"),
      ],
      cashEvents: [],
    })).toThrow("sale exceeds holding");
  });

  it("validates the formula's final global cash instead of inventing dated sub-wallets", () => {
    const state = buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 0,
      products: [product],
      operations: [operation("buy-first", "buy", "2026-07-01", 10_000, "1")],
      cashEvents: [{ id: "deposit-later", date: "2026-07-02", amountMinor: 10_000 }],
    });
    expect(state.cashMinor).toBe(0);
  });

  it("is deterministic regardless of input row order", () => {
    const operations = [
      operation("b", "buy", "2026-07-02", 12_000, "5"),
      operation("a", "buy", "2026-07-01", 10_000, "10"),
      operation("c", "sell", "2026-07-03", 9_000, "6"),
    ];
    const input = {
      startedOn: "2026-07-01",
      openingCashMinor: 30_000,
      products: [product],
      cashEvents: [] as InvestmentCashEvent[],
    };
    expect(buildInvestmentState({ ...input, operations }).products)
      .toEqual(buildInvestmentState({ ...input, operations: [...operations].reverse() }).products);
  });

  it("applies same-day acquisitions before sales regardless of row ids", () => {
    const state = buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 10_000,
      products: [product],
      operations: [
        operation("a-sale", "sell", "2026-07-01", 6_000, "4"),
        operation("z-buy", "buy", "2026-07-01", 10_000, "10"),
      ],
      cashEvents: [],
    });

    expect(state.products[0]).toMatchObject({
      quantity: "6",
      costMinor: 6_000,
      realizedProfitLossMinor: 2_000,
    });
  });
});
