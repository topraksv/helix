import { describe, expect, it } from "vitest";
import { buildLedger, currentBalance, projectedBalance, reconciliationDelta } from "../src/domain/balance";
import type { TxLike } from "../src/domain/types";
import { required, tl, tx } from "./helpers";

/**
 * Golden test: the user's real Excel (Gelir-Gider 2026, Ocak–Temmuz) verified
 * from screenshots. Columns: KK Taksit, KK Tek Çekim, Ev Kredisi,
 * Fatura&Abonelik = expenses · Yatırım = transfer · Ek Gider = expense ·
 * Ek Gelir + Maaş = income. Opening (Ocak) = 2.004,00.
 */
const MONTHS: {
  month: string;
  expenses: string[];
  transfer: string;
  incomes: string[];
  closing: string;
}[] = [
  { month: "2026-01", expenses: ["18.822,92", "14.316,15", "23.672,13", "4.424,03", "35.590,49"], transfer: "0,00", incomes: ["20.480,00", "136.167,00"], closing: "61.825,28" },
  { month: "2026-02", expenses: ["14.050,48", "14.197,51", "23.672,13", "5.907,27", "40.309,89"], transfer: "170.000,00", incomes: ["31.091,00", "178.721,00"], closing: "3.500,00" },
  { month: "2026-03", expenses: ["19.310,87", "9.364,34", "23.672,13", "5.703,47", "9.500,00"], transfer: "120.000,00", incomes: ["16.900,00", "168.670,11"], closing: "1.519,30" },
  { month: "2026-04", expenses: ["16.304,15", "31.282,27", "23.672,13", "4.589,90", "34.085,52"], transfer: "0,00", incomes: ["12.340,00", "170.600,30"], closing: "74.525,63" },
  { month: "2026-05", expenses: ["24.143,06", "12.712,32", "23.672,13", "5.371,65", "37.700,00"], transfer: "260.000,00", incomes: ["125.000,00", "172.862,38"], closing: "8.788,85" },
  { month: "2026-06", expenses: ["27.709,70", "25.198,15", "23.672,13", "4.240,40", "9.300,00"], transfer: "210.000,00", incomes: ["85.975,12", "206.700,30"], closing: "1.343,89" },
  { month: "2026-07", expenses: ["7.789,16", "11.652,13", "23.672,13", "2.216,76"], transfer: "165.000,00", incomes: ["19.612,96", "170.600,30"], closing: "-18.773,03" },
];

function excelTransactions(): TxLike[] {
  const txs: TxLike[] = [];
  for (const m of MONTHS) {
    const date = `${m.month}-15`;
    for (const e of m.expenses) txs.push(tx({ type: "expense", amountTryMinor: tl(e), effectiveDate: date }));
    if (tl(m.transfer) !== 0) txs.push(tx({ type: "transfer", amountTryMinor: tl(m.transfer), effectiveDate: date }));
    for (const i of m.incomes) txs.push(tx({ type: "income", amountTryMinor: tl(i), effectiveDate: date }));
  }
  return txs;
}

describe("balance chain (Excel golden)", () => {
  const input = {
    openingBalanceMinor: tl("2.004,00"),
    startMonth: "2026-01",
    endMonth: "2026-07",
    transactions: excelTransactions(),
    adjustments: [],
    today: "2026-07-31",
  };

  it("reproduces every monthly closing balance from the Excel sheet", () => {
    const ledger = buildLedger(input);
    for (const [i, m] of MONTHS.entries()) {
      expect(required(ledger[i], m.month).closingMinor, `closing of ${m.month}`).toBe(tl(m.closing));
    }
  });

  it("chains openings: next month's opening equals this month's closing", () => {
    const ledger = buildLedger(input);
    for (let i = 1; i < ledger.length; i++) {
      expect(required(ledger[i], `ledger ${i}`).openingMinor).toBe(required(ledger[i - 1], `ledger ${i - 1}`).closingMinor);
    }
    expect(required(ledger[0]).openingMinor).toBe(tl("2.004,00"));
  });

  it("supports a negative closing balance (Temmuz 2026)", () => {
    const ledger = buildLedger(input);
    expect(required(ledger[6]).closingMinor).toBe(tl("-18.773,03"));
    expect(required(ledger[6]).closingMinor).toBeLessThan(0);
  });

  it("recomputes the whole chain when a past month gains a transaction", () => {
    const withExtra = {
      ...input,
      transactions: [...input.transactions, tx({ type: "expense", amountTryMinor: 100_00, effectiveDate: "2026-01-20" })],
    };
    const ledger = buildLedger(withExtra);
    for (const [i, m] of MONTHS.entries()) {
      expect(required(ledger[i], m.month).closingMinor).toBe(tl(m.closing) - 100_00);
    }
  });
});

describe("§2.7 future-dated payments", () => {
  const base = {
    openingBalanceMinor: 1000_00,
    startMonth: "2026-07",
    adjustments: [],
  };
  const future = tx({
    type: "expense",
    amountTryMinor: 300_00,
    effectiveDate: "2026-07-06",
    status: "realized",
  });

  it("does not count a transaction before its effective date", () => {
    expect(currentBalance({ ...base, transactions: [future], today: "2026-07-05" })).toBe(1000_00);
  });

  it("counts it once today reaches the effective date", () => {
    expect(currentBalance({ ...base, transactions: [future], today: "2026-07-06" })).toBe(700_00);
  });

  it("never counts status=pending regardless of date", () => {
    const pending = { ...future, status: "pending" as const };
    expect(currentBalance({ ...base, transactions: [pending], today: "2026-07-10" })).toBe(1000_00);
  });

  it("projected balance includes future flows up to the horizon only", () => {
    const flows = [
      { direction: "out" as const, amountTryMinor: 300_00, date: "2026-07-06" },
      { direction: "in" as const, amountTryMinor: 500_00, date: "2026-07-15" },
      { direction: "out" as const, amountTryMinor: 999_00, date: "2026-08-02" },
    ];
    expect(projectedBalance(1000_00, flows, "2026-07-31")).toBe(1200_00);
  });
});

describe("§2.8 payer-other exclusion", () => {
  it("excludes non-self transactions from the balance", () => {
    const other = tx({
      type: "expense",
      amountTryMinor: 500_00,
      effectiveDate: "2026-07-01",
      personIsSelf: false,
    });
    const mine = tx({ type: "expense", amountTryMinor: 200_00, effectiveDate: "2026-07-01" });
    expect(
      currentBalance({
        openingBalanceMinor: 1000_00,
        startMonth: "2026-07",
        transactions: [other, mine],
        adjustments: [],
        today: "2026-07-05",
      }),
    ).toBe(800_00);
  });
});

describe("balance adjustments (reconciliation)", () => {
  it("replaces the same-day delta instead of stacking corrections", () => {
    expect(reconciliationDelta(1200_00, 1000_00)).toBe(200_00);
    // The displayed 1,200 already includes the prior +200 row. Re-entering the
    // same target keeps that row at +200 rather than adding another +200.
    expect(reconciliationDelta(1200_00, 1200_00, 200_00)).toBe(200_00);
    // Returning to the underlying balance produces zero, which the repo stores
    // as a tombstone instead of a meaningless live adjustment.
    expect(reconciliationDelta(1000_00, 1200_00, 200_00)).toBe(0);
  });

  it("applies signed adjustments in their month", () => {
    const ledger = buildLedger({
      openingBalanceMinor: 1000_00,
      startMonth: "2026-06",
      endMonth: "2026-07",
      transactions: [],
      adjustments: [
        { date: "2026-06-10", amountMinor: -50_00 },
        { date: "2026-07-10", amountMinor: 25_00 },
      ],
      today: "2026-07-31",
    });
    expect(required(ledger[0]).closingMinor).toBe(950_00);
    expect(required(ledger[1]).closingMinor).toBe(975_00);
  });

  it("leaves the opening and every prior month unchanged", () => {
    const base = {
      openingBalanceMinor: 1000_00,
      startMonth: "2026-01" as const,
      endMonth: "2026-07" as const,
      transactions: [],
      today: "2026-07-31" as const,
    };
    const without = buildLedger({ ...base, adjustments: [] });
    const corrected = buildLedger({ ...base, adjustments: [{ date: "2026-07-15", amountMinor: -125_00 }] });
    expect(required(corrected[0]).openingMinor).toBe(1000_00);
    expect(corrected.slice(0, 6)).toEqual(without.slice(0, 6));
    expect(required(corrected[6]).openingMinor).toBe(required(without[6]).openingMinor);
    expect(required(corrected[6]).closingMinor).toBe(required(without[6]).closingMinor - 125_00);
  });
});

describe("pending rows in table cells (display-only)", async () => {
  const { buildLedger } = await import("../src/domain/balance");
  const base = {
    openingBalanceMinor: 100_00,
    startMonth: "2026-07",
    endMonth: "2026-08",
    adjustments: [],
    today: "2026-07-10" as const,
  };
  const pendingTx = {
    id: "t1", type: "expense" as const, amountTryMinor: 50_00, effectiveDate: "2026-08-05",
    status: "pending" as const, categoryId: "cat", paymentSourceId: null, personIsSelf: true,
    categoryKind: "expense" as const,
    installmentPlanId: null, subscriptionId: null, isAggregate: false,
  };

  it("keeps balances realized-only but surfaces pending in byCategory when asked", () => {
    const withFlag = buildLedger({ ...base, transactions: [pendingTx], includePendingInCells: true });
    expect(required(withFlag[1]).byCategory.get("cat")).toBe(50_00);
    expect(required(withFlag[1]).expenseMinor).toBe(0);
    expect(required(withFlag[1]).closingMinor).toBe(100_00);
    const without = buildLedger({ ...base, transactions: [pendingTx] });
    expect(required(without[1]).byCategory.get("cat")).toBeUndefined();
  });

  it("keeps categoryless legacy rows visible without inventing a category", () => {
    const realized = { ...pendingTx, id: "t2", status: "realized" as const, categoryId: null, effectiveDate: "2026-07-05" };
    const pending = { ...pendingTx, id: "t3", categoryId: null };
    const withFlag = buildLedger({ ...base, transactions: [realized, pending], includePendingInCells: true });
    expect(required(withFlag[0]).uncategorizedMinor).toBe(50_00);
    expect(required(withFlag[1]).uncategorizedMinor).toBe(50_00);
    expect(required(withFlag[0]).byCategory.size).toBe(0);
    expect(required(withFlag[0]).expenseMinor).toBe(50_00);
    const withoutFlag = buildLedger({ ...base, transactions: [realized, pending] });
    expect(required(withoutFlag[1]).uncategorizedMinor).toBe(0);
  });
});

describe("resolveLedgerAnchor (prior-year history)", async () => {
  const { resolveLedgerAnchor } = await import("../src/domain/balance");
  const tx = (id: string, date: string, amt: number, type: "income" | "expense" = "expense") => ({
    id, type, amountTryMinor: amt, effectiveDate: date, status: "realized" as const,
    categoryId: "c", categoryKind: type, paymentSourceId: null, personIsSelf: true,
    installmentPlanId: null, subscriptionId: null, isAggregate: false,
  });

  it("returns configured values when no earlier data exists", () => {
    const r = resolveLedgerAnchor("2026-01", 100_00, [tx("a", "2026-03-01", 10_00)], [], "2026-07-01");
    expect(r.startMonth).toBe("2026-01");
    expect(r.openingBalanceMinor).toBe(100_00);
  });

  it("extends the start back and back-computes the opening for prior-year data", () => {
    // Configured start 2026-01 with opening 100_00; a 2025-11 expense of 30_00.
    const r = resolveLedgerAnchor("2026-01", 100_00, [tx("a", "2025-11-15", 30_00)], [], "2026-07-01");
    expect(r.startMonth).toBe("2025-11");
    // opening(2026-01) must stay 100_00 → opening(2025-11) = 100_00 + 30_00 = 130_00
    expect(r.openingBalanceMinor).toBe(130_00);
  });

  it("income before the anchor lowers the back-computed opening", () => {
    const r = resolveLedgerAnchor("2026-01", 100_00, [tx("a", "2025-12-01", 40_00, "income")], [], "2026-07-01");
    expect(r.startMonth).toBe("2025-12");
    expect(r.openingBalanceMinor).toBe(60_00); // 100_00 - 40_00
  });
});
