import { describe, expect, it } from "vitest";
import { buildCashFlowMatrixModel } from "../src/domain/cash-flow-matrix";
import { buildLedger } from "../src/domain/balance";
import { tx } from "./helpers";

describe("cash-flow matrix model", () => {
  it("keeps category, computed, system and missing-category values in parity", () => {
    const transactions = [
      tx({ id: "a", type: "expense", categoryId: "food", amountTryMinor: 100_00, effectiveDate: "2026-01-05" }),
      tx({ id: "b", type: "expense", categoryId: "deleted", amountTryMinor: 25_00, effectiveDate: "2026-01-06" }),
    ];
    const ledger = buildLedger({
      openingBalanceMinor: 1_000_00,
      startMonth: "2026-01",
      endMonth: "2026-12",
      transactions,
      adjustments: [],
      today: "2026-12-31",
    });
    const model = buildCashFlowMatrixModel({
      year: 2026,
      yearMonths: ledger,
      categories: [{ id: "food", name: "Market" }],
      computedColumns: [{
        id: "sum", name: "Toplam", definition: JSON.stringify({ op: "sum", categoryIds: ["food"] }),
      }],
      transactions,
      creditCardIds: new Set(),
      liveCategoryIds: new Set(["food"]),
      today: "2026-12-31",
      openingLabel: "Ay Başı",
      closingLabel: "Güncel Bakiye",
    });

    expect(model.months).toHaveLength(12);
    expect(model.columns.map((column) => column.key)).toEqual(["food", "sum", "opening", "closing"]);
    expect(model.columns[0]?.values.get("2026-01")).toBe(100_00);
    expect(model.columns[1]?.values.get("2026-01")).toBe(100_00);
    expect(model.columns[3]?.values.get("2026-01")).toBe(875_00);
    expect(model.uncategorizedTotal).toBe(25_00);
  });
});
