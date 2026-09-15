import { describe, expect, it } from "vitest";
import { categoryRangeMatrix, distributionForRange, fixedVsVariable } from "../src/domain/analytics";
import { buildLedger } from "../src/domain/balance";
import { buildDashboardModel } from "../src/domain/dashboard";
import { tr } from "../src/i18n/tr";
import {
  categoryAcceptsTransaction,
  categoryTableEntryType,
  financialFlow,
  isWorkbookRemainderRow,
  projectedTransactionFlow,
} from "../src/domain/transactions";
import { required, tx } from "./helpers";

const TODAY = "2026-07-31";

describe("canonical transaction classification", () => {
  it("requires income/expense categories and keeps transfers in expense columns", () => {
    expect(categoryAcceptsTransaction("expense", "expense")).toBe(true);
    expect(categoryAcceptsTransaction("income", "income")).toBe(true);
    expect(categoryAcceptsTransaction("income", "expense")).toBe(false);
    expect(categoryAcceptsTransaction("transfer", "expense")).toBe(true);
    expect(categoryAcceptsTransaction("transfer", "income")).toBe(false);
  });

  it("keeps month-table transfer semantics stable across category renames", () => {
    expect(categoryTableEntryType({ kind: "expense", isTransfer: true })).toBe("transfer");
    expect(categoryTableEntryType({ kind: "expense", isTransfer: false })).toBe("expense");
    expect(categoryTableEntryType({ kind: "income", isTransfer: false })).toBe("income");
  });

  it("normalizes a legacy mismatched refund without changing its cash effect", () => {
    const legacy = tx({
      type: "income",
      amountTryMinor: 20_00,
      effectiveDate: "2026-07-10",
      categoryId: "market",
      categoryKind: "expense",
    });
    expect(financialFlow(legacy)).toEqual({ type: "expense", amountTryMinor: -20_00 });
    expect(projectedTransactionFlow(legacy)).toEqual({ direction: "in", amountTryMinor: 20_00 });
  });

  it("nets refunds identically in ledger, distribution and category cells", () => {
    const rows = [
      tx({
        type: "expense",
        amountTryMinor: 100_00,
        effectiveDate: "2026-07-05",
        categoryId: "market",
        categoryKind: "expense",
      }),
      tx({
        type: "expense",
        amountTryMinor: -20_00,
        effectiveDate: "2026-07-10",
        categoryId: "market",
        categoryKind: "expense",
      }),
    ];
    const ledger = required(buildLedger({
      openingBalanceMinor: 1_000_00,
      startMonth: "2026-07",
      endMonth: "2026-07",
      transactions: rows,
      adjustments: [],
      today: TODAY,
    })[0]);
    const distribution = distributionForRange(rows, "2026-07-01", "2026-07-31", TODAY);
    const matrix = categoryRangeMatrix(rows, "2026-07", "2026-07", TODAY);

    expect(ledger.expenseMinor).toBe(80_00);
    expect(ledger.byCategory.get("market")).toBe(80_00);
    expect(ledger.closingMinor).toBe(920_00);
    expect(distribution.expenseByCategory.get("market")).toBe(80_00);
    expect(distribution.expenseTotalMinor).toBe(80_00);
    expect(matrix.get("market")?.ytdMinor).toBe(80_00);
  });

  it("keeps fixed and variable totals reconciled after reversals", () => {
    const rows = [
      tx({ type: "expense", amountTryMinor: 100_00, effectiveDate: "2026-07-05", subscriptionId: "s1" }),
      tx({ type: "expense", amountTryMinor: -10_00, effectiveDate: "2026-07-06", subscriptionId: "s1" }),
      tx({ type: "expense", amountTryMinor: 30_00, effectiveDate: "2026-07-07" }),
    ];
    const split = fixedVsVariable(rows, "2026-07-01", "2026-07-31", TODAY);
    const distribution = distributionForRange(rows, "2026-07-01", "2026-07-31", TODAY);
    expect(split).toEqual({ fixedMinor: 90_00, variableMinor: 30_00 });
    expect(split.fixedMinor + split.variableMinor).toBe(distribution.expenseTotalMinor);
  });
});

/**
 * A workbook column's remainder keeps the imported column equal to its file
 * (spec §3.1e). It is in the balance and the table cell, and in no chart or
 * category split, where a negative one read as a refund nobody made.
 */
describe("workbook column remainders", () => {
  const remainder = tx({
    id: "remainder", type: "expense", amountTryMinor: -250_00, effectiveDate: "2026-07-01",
    categoryId: "kk", categoryKind: "expense", isAggregate: true, isWorkbookRemainder: true,
  });
  const spending = tx({
    id: "spending", type: "expense", amountTryMinor: 400_00, effectiveDate: "2026-07-10",
    categoryId: "kk", categoryKind: "expense",
  });
  const transactions = [remainder, spending];

  it("is recognised only by the importer's origin, month-level shape and exact note", () => {
    const row = { origin: "spreadsheet", isAggregate: true, note: tr.importer.columnRemainder };
    expect(isWorkbookRemainderRow(row)).toBe(true);
    expect(isWorkbookRemainderRow({ ...row, origin: "manual" })).toBe(false);
    expect(isWorkbookRemainderRow({ ...row, isAggregate: false })).toBe(false);
    expect(isWorkbookRemainderRow({ ...row, note: `${tr.importer.columnRemainder} ` })).toBe(false);
    expect(isWorkbookRemainderRow({ ...row, note: null })).toBe(false);
  });

  it("stays out of the distribution and is reported beside it", () => {
    const distribution = distributionForRange(transactions, "2026-07-01", "2026-07-31", TODAY);
    expect(distribution.expenseByCategory).toEqual(new Map([["kk", 400_00]]));
    expect(distribution.expenseTotalMinor).toBe(400_00);
    expect(distribution.workbookRemainderMinor).toBe(250_00);
    expect(categoryRangeMatrix(transactions, "2026-07", "2026-07", TODAY).get("kk")?.ytdMinor).toBe(400_00);
    expect(fixedVsVariable(transactions, "2026-07-01", "2026-07-31", TODAY)).toEqual({ fixedMinor: 0, variableMinor: 400_00 });
  });

  it("stays out of the dashboard's splits and agrees with Analysis about it", () => {
    const model = buildDashboardModel({
      transactions, expected: [], ledger: [], actualBalanceMinor: 0, today: TODAY,
      monthStart: "2026-07-01", monthEnd: "2026-07-31", currentMonth: "2026-07", year: 2026,
      expectedTryMinor: (_currency, amount) => amount,
    });
    expect(model.distribution).toEqual(distributionForRange(transactions, "2026-07-01", "2026-07-31", TODAY));
    expect(model.variableMinor).toBe(400_00);
  });

  it("is still in the balance and in its column's cell, so the table equals the file", () => {
    const [july] = buildLedger({
      openingBalanceMinor: 0, startMonth: "2026-07", endMonth: "2026-07", transactions, adjustments: [], today: TODAY,
    });
    expect(july?.byCategory.get("kk")).toBe(150_00);
    expect(july?.closingMinor).toBe(-150_00);
  });
});
