import { describe, expect, it } from "vitest";
import {
  InvestmentDomainError,
  buildInvestmentState,
  formatInvestmentQuantityAtoms,
  parseInvestmentQuantity,
  resolveInvestmentQuote,
  type InvestmentCashEvent,
  type InvestmentOperationLike,
} from "../src/domain/investments";
import { MAX_ABS_AMOUNT_MINOR } from "../src/domain/money";

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

function expectDomainError(run: () => unknown, code: InvestmentDomainError["code"]): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({ name: "InvestmentDomainError", code });
}

describe("investment decimal and quote rules", () => {
  it("keeps stable error codes and diagnostic messages", () => {
    const messages: Record<InvestmentDomainError["code"], string> = {
      invalid_quantity: "invalid investment quantity",
      invalid_money: "invalid investment money",
      quote_incomplete: "two investment quote fields are required",
      quote_inconsistent: "investment quote fields are inconsistent",
      unknown_product: "investment product does not exist",
      invalid_operation: "investment operation does not match product type",
      insufficient_cash: "insufficient investment cash",
      unknown_quantity: "investment quantity is unknown",
      oversold: "sale exceeds holding",
    };
    for (const [code, message] of Object.entries(messages)) {
      expect(new InvestmentDomainError(code as InvestmentDomainError["code"])).toMatchObject({
        name: "InvestmentDomainError",
        code,
        message,
      });
    }
  });

  it("normalizes fractional Turkish and dot-decimal quantities without floats", () => {
    expect(parseInvestmentQuantity("17,23").normalized).toBe("17.23");
    expect(parseInvestmentQuantity("456.12000000").normalized).toBe("456.12");
    expect(parseInvestmentQuantity("1.234,5678").normalized).toBe("1234.5678");
    expect(parseInvestmentQuantity("  001 234,50000000 ").normalized).toBe("1234.5");
    expect(parseInvestmentQuantity("1,234.56").normalized).toBe("1234.56");
    expect(parseInvestmentQuantity("0.00000001").atoms).toBe(1n);
  });

  it("rejects signed, malformed, zero, over-precision and over-limit quantities", () => {
    for (const raw of [
      "", " ", "-1", "+1", ".5", ",5", "abc", "12a", "a12", "1,2a", "1,a2",
      "1.000000001", "0", "0.00000000",
    ]) {
      expectDomainError(() => parseInvestmentQuantity(raw), "invalid_quantity");
    }
    expect(parseInvestmentQuantity("999999999999").normalized).toBe("999999999999");
    expectDomainError(() => parseInvestmentQuantity("1000000000000"), "invalid_quantity");
    expect(formatInvestmentQuantityAtoms(0n)).toBe("0");
    expect(formatInvestmentQuantityAtoms(1n)).toBe("0.00000001");
    expect(formatInvestmentQuantityAtoms(99_999_999_999_900_000_000n)).toBe("999999999999");
    expectDomainError(() => formatInvestmentQuantityAtoms(-1n), "invalid_quantity");
    expectDomainError(() => formatInvestmentQuantityAtoms(100_000_000_000_000_000_000n), "invalid_quantity");
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
    expect(resolveInvestmentQuote({ quantity: "3", unitPriceMinor: 333, totalMinor: 998 }).totalMinor).toBe(998);
    expect(resolveInvestmentQuote({ quantity: "3", unitPriceMinor: 333, totalMinor: 997 }).totalMinor).toBe(997);
    expectDomainError(
      () => resolveInvestmentQuote({ quantity: "3", unitPriceMinor: 333, totalMinor: 996 }),
      "quote_inconsistent",
    );
    expectDomainError(
      () => resolveInvestmentQuote({ quantity: "2", unitPriceMinor: 100, totalMinor: 198 }),
      "quote_inconsistent",
    );
    expectDomainError(
      () => resolveInvestmentQuote({
        quantity: "1",
        unitPriceMinor: 200_000_000,
        totalMinor: 199_999_998,
      }),
      "quote_inconsistent",
    );
    expect(() => resolveInvestmentQuote({ quantity: "3", unitPriceMinor: 333, totalMinor: 1_010 }))
      .toThrowError(InvestmentDomainError);
    expectDomainError(
      () => resolveInvestmentQuote({ quantity: "100", totalMinor: 49 }),
      "invalid_money",
    );
  });

  it("distinguishes incomplete quotes from invalid supplied money", () => {
    for (const input of [{}, { quantity: "1" }, { unitPriceMinor: 100 }, { totalMinor: 100 }]) {
      expectDomainError(() => resolveInvestmentQuote(input), "quote_incomplete");
    }
    for (const unitPriceMinor of [0, -1, 1.5, MAX_ABS_AMOUNT_MINOR + 1]) {
      expectDomainError(
        () => resolveInvestmentQuote({ quantity: "1", unitPriceMinor, totalMinor: 100 }),
        "invalid_money",
      );
    }
    for (const totalMinor of [0, -1, 1.5, MAX_ABS_AMOUNT_MINOR + 1]) {
      expectDomainError(
        () => resolveInvestmentQuote({ quantity: "1", unitPriceMinor: 100, totalMinor }),
        "invalid_money",
      );
    }
  });
});

describe("investment wallet and weighted-cost invariants", () => {
  it("validates opening cash, cash events, operation totals and product references", () => {
    const input = {
      startedOn: "2026-07-01",
      openingCashMinor: 0,
      products: [product],
      operations: [] as InvestmentOperationLike[],
      cashEvents: [] as InvestmentCashEvent[],
    };
    for (const openingCashMinor of [-1, 1.5, MAX_ABS_AMOUNT_MINOR + 1]) {
      expectDomainError(() => buildInvestmentState({ ...input, openingCashMinor }),
        openingCashMinor < 0 ? "insufficient_cash" : "invalid_money");
    }
    for (const amountMinor of [1.5, MAX_ABS_AMOUNT_MINOR + 1]) {
      expectDomainError(() => buildInvestmentState({
        ...input,
        cashEvents: [{ id: "invalid", date: "2026-07-01", amountMinor }],
      }), "invalid_money");
    }
    expectDomainError(() => buildInvestmentState({
      ...input,
      operations: [{ ...operation("zero", "buy", "2026-07-01", 1, "1"), totalMinor: 0 }],
    }), "invalid_money");
    expectDomainError(() => buildInvestmentState({
      ...input,
      operations: [{ ...operation("unknown", "existing", "2026-07-01", 100, "1"), productId: "missing" }],
    }), "unknown_product");
  });

  it("includes the cutoff day and excludes earlier cash events", () => {
    const state = buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 100,
      products: [product],
      operations: [],
      cashEvents: [
        { id: "before", date: "2026-06-30", amountMinor: 10_000 },
        { id: "cutoff", date: "2026-07-01", amountMinor: 200 },
      ],
    });
    expect(state.cashMinor).toBe(300);
  });
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
    expect(state).toMatchObject({ cashMinor: 5_000, investedCostMinor: 5_000 });
    expect(state.products[0]).toMatchObject({ quantity: null, costMinor: 5_000, active: true });
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

  it("requires quantity for every non-contribution operation", () => {
    for (const kind of ["existing", "buy", "sell"] as const) {
      expectDomainError(() => buildInvestmentState({
        startedOn: "2026-07-01",
        openingCashMinor: 10_000,
        products: [product],
        operations: [{
          id: kind, productId: product.id, kind, operationDate: "2026-07-01",
          quantity: null, unitPriceMinor: null, totalMinor: 100,
        }],
        cashEvents: [],
      }), "invalid_quantity");
    }
  });

  it("keeps pension quantity unknown after later quantity-bearing contributions", () => {
    const pension = { id: "pension", assetType: "pension" as const, name: "BES" };
    const state = buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 10_000,
      products: [pension],
      operations: [
        {
          id: "amount-only", productId: pension.id, kind: "contribution",
          operationDate: "2026-07-01", quantity: null, unitPriceMinor: null, totalMinor: 2_000,
        },
        {
          id: "quoted", productId: pension.id, kind: "contribution",
          operationDate: "2026-07-02", quantity: "1", unitPriceMinor: 1_000, totalMinor: 1_000,
        },
      ],
      cashEvents: [],
    });
    expect(state.products[0]).toMatchObject({ quantity: null, costMinor: 3_000, averageCostMinor: null });
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

  it("enforces cumulative quantity and cost limits", () => {
    expectDomainError(() => buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 0,
      products: [product],
      operations: [
        {
          id: "max", productId: product.id, kind: "existing", operationDate: "2026-07-01",
          quantity: "999999999999", unitPriceMinor: 1, totalMinor: 1,
        },
        {
          id: "overflow", productId: product.id, kind: "existing", operationDate: "2026-07-02",
          quantity: "0.00000001", unitPriceMinor: 1, totalMinor: 1,
        },
      ],
      cashEvents: [],
    }), "invalid_quantity");
    expectDomainError(() => buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 0,
      products: [product],
      operations: [
        operation("cost-1", "existing", "2026-07-01", MAX_ABS_AMOUNT_MINOR, "1"),
        operation("cost-2", "existing", "2026-07-02", 1, "1"),
      ],
      cashEvents: [],
    }), "invalid_money");

    expectDomainError(() => buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 0,
      products: [product],
      operations: [
        operation("cost-max", "existing", "2026-07-01", MAX_ABS_AMOUNT_MINOR, "2"),
        operation("cost-overflow", "existing", "2026-07-02", 1, "1"),
        operation("cost-reduce", "sell", "2026-07-03", 1, "1"),
      ],
      cashEvents: [],
    }), "invalid_money");

    expectDomainError(() => buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 0,
      products: [product],
      operations: [
        {
          id: "max", productId: product.id, kind: "existing", operationDate: "2026-07-01",
          quantity: "999999999999", unitPriceMinor: 1, totalMinor: 1,
        },
        {
          id: "temporary-overflow", productId: product.id, kind: "existing", operationDate: "2026-07-02",
          quantity: "0.00000001", unitPriceMinor: 1, totalMinor: 1,
        },
        {
          id: "reduce", productId: product.id, kind: "sell", operationDate: "2026-07-03",
          quantity: "0.00000001", unitPriceMinor: 1, totalMinor: 1,
        },
      ],
      cashEvents: [],
    }), "invalid_quantity");

    const atLimit = buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 0,
      products: [product],
      operations: [{
        id: "max", productId: product.id, kind: "existing", operationDate: "2026-07-01",
        quantity: "999999999999", unitPriceMinor: 1, totalMinor: 1,
      }],
      cashEvents: [],
    });
    expect(atLimit.products[0]).toMatchObject({ quantity: "999999999999", active: true });
  });

  it("rejects unsupported aggregate portfolio cost and per-product realized results", () => {
    const second = { id: "product-2", assetType: "equity" as const, name: "İkinci" };
    expectDomainError(() => buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 0,
      products: [product, second],
      operations: [
        operation("first", "existing", "2026-07-01", MAX_ABS_AMOUNT_MINOR, "1"),
        { ...operation("second", "existing", "2026-07-01", MAX_ABS_AMOUNT_MINOR, "1"), productId: second.id },
      ],
      cashEvents: [],
    }), "invalid_money");

    const operations: InvestmentOperationLike[] = [];
    const cashEvents: InvestmentCashEvent[] = [];
    for (let index = 0; index < 91; index += 1) {
      operations.push(
        operation(`holding-${index}`, "existing", "2026-07-01", 1, "1"),
        operation(`sale-${index}`, "sell", "2026-07-01", MAX_ABS_AMOUNT_MINOR, "1"),
      );
      cashEvents.push({ id: `offset-${index}`, date: "2026-07-01", amountMinor: -MAX_ABS_AMOUNT_MINOR });
    }
    expectDomainError(() => buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 0,
      products: [product],
      operations,
      cashEvents,
    }), "invalid_money");

    const gainProduct = { id: "gain", assetType: "equity" as const, name: "Kazanç" };
    const lossProduct = { id: "loss", assetType: "equity" as const, name: "Kayıp" };
    const offsettingOperations: InvestmentOperationLike[] = [];
    const offsettingCash: InvestmentCashEvent[] = [];
    let day = 0;
    const nextDate = () => {
      const value = new Date(Date.UTC(2000, 0, 1 + day));
      day += 1;
      return value.toISOString().slice(0, 10);
    };
    for (let index = 0; index < 91; index += 1) {
      offsettingOperations.push(
        { ...operation(`gain-holding-${index}`, "existing", nextDate(), 1, "1"), productId: gainProduct.id },
        { ...operation(`gain-sale-${index}`, "sell", nextDate(), MAX_ABS_AMOUNT_MINOR, "1"), productId: gainProduct.id },
        {
          ...operation(`loss-holding-${index}`, "existing", nextDate(), MAX_ABS_AMOUNT_MINOR, "1"),
          productId: lossProduct.id,
        },
        { ...operation(`loss-sale-${index}`, "sell", nextDate(), 1, "1"), productId: lossProduct.id },
      );
      offsettingCash.push(
        { id: `offset-max-${index}`, date: "2000-01-01", amountMinor: -MAX_ABS_AMOUNT_MINOR },
        { id: `offset-one-${index}`, date: "2000-01-01", amountMinor: -1 },
      );
    }
    expectDomainError(() => buildInvestmentState({
      startedOn: "2000-01-01",
      openingCashMinor: 0,
      products: [gainProduct, lossProduct],
      operations: offsettingOperations,
      cashEvents: offsettingCash,
    }), "invalid_money");
  });

  it("sorts products by Turkish name and then id", () => {
    const products = [
      { id: "z", assetType: "equity" as const, name: "I" },
      { id: "c", assetType: "equity" as const, name: "İ" },
      { id: "b", assetType: "equity" as const, name: "ı" },
      { id: "d", assetType: "equity" as const, name: "i" },
      { id: "a", assetType: "equity" as const, name: "ı" },
    ];
    const state = buildInvestmentState({
      startedOn: "2026-07-01",
      openingCashMinor: 0,
      products,
      operations: [],
      cashEvents: [],
    });
    expect(state.products.map(({ id }) => id)).toEqual(["a", "b", "z", "d", "c"]);
  });

  it("keeps a long gain/loss journal exact across unsafe intermediate sums", () => {
    const gain = MAX_ABS_AMOUNT_MINOR - 2;
    const highSale = gain + 1;
    const operations: InvestmentOperationLike[] = [];
    let day = 0;
    const date = () => {
      const value = new Date(Date.UTC(2000, 0, 1 + day++));
      return value.toISOString().slice(0, 10);
    };
    for (let index = 0; index < 100; index += 1) {
      operations.push(
        operation(`gain-existing-${index}`, "existing", date(), 1, "1"),
        operation(`gain-sale-${index}`, "sell", date(), highSale, "1"),
      );
    }
    for (let index = 0; index < 99; index += 1) {
      operations.push(
        operation(`loss-existing-${index}`, "existing", date(), highSale, "1"),
        operation(`loss-sale-${index}`, "sell", date(), 1, "1"),
      );
    }
    const cashEvents: InvestmentCashEvent[] = [
      ...Array.from({ length: 99 }, (_, index) => ({
        id: `cash-offset-${index}`,
        date: "2002-01-01",
        amountMinor: -MAX_ABS_AMOUNT_MINOR,
      })),
      { id: "cash-offset-final", date: "2002-01-01", amountMinor: -highSale },
    ];

    const state = buildInvestmentState({
      startedOn: "2000-01-01",
      openingCashMinor: 0,
      products: [product],
      operations,
      cashEvents,
    });

    expect(state.cashMinor).toBe(0);
    expect(state.realizedProfitLossMinor).toBe(gain);
    expect(state.products[0]?.realizedProfitLossMinor).toBe(gain);
  });
});
