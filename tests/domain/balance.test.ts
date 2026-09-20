import { describe, expect, it } from "vitest";
import { buildLedger, buildLedgerChain, ledgerChainEndYear, monthFlowTotals, projectedBalance, reconciliationDelta, sliceLedgerYear, type LedgerBundle } from "../../src/domain/balance";
import type { ISODate, MonthKey } from "../../src/domain/dates";
import type { TxLike } from "../../src/domain/types";
import { required, tl, tx } from "../helpers";

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

/** Today's balance the way every screen reads it: the chain's current month close. */
function balanceOn(transactions: TxLike[], today: ISODate): number {
  return buildLedgerChain({
    configuredStart: "2026-07",
    openingBalanceMinor: 1000_00,
    includePendingInCells: false,
    transactions,
    adjustments: [],
    endYear: 2026,
    today,
  }).actualBalanceMinor;
}

describe("§2.7 future-dated payments", () => {
  const future = tx({
    type: "expense",
    amountTryMinor: 300_00,
    effectiveDate: "2026-07-06",
    status: "realized",
  });

  it("does not count a transaction before its effective date", () => {
    expect(balanceOn([future], "2026-07-05")).toBe(1000_00);
  });

  it("counts it once today reaches the effective date", () => {
    expect(balanceOn([future], "2026-07-06")).toBe(700_00);
  });

  it("never counts status=pending regardless of date", () => {
    const pending = { ...future, status: "pending" as const };
    expect(balanceOn([pending], "2026-07-10")).toBe(1000_00);
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
    expect(balanceOn([other, mine], "2026-07-05")).toBe(800_00);
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
  const { buildLedger } = await import("../../src/domain/balance");
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

/**
 * A month-focused card shows one total and the three flows it is made of. The
 * realized-only chain is right for the balance but reads 0 for every future
 * month, so August showed a carried balance above "Gelir 0 / Gider 0 /
 * Yatırım 0" while the category cell beside it already showed the planned
 * 50,00. `monthFlowTotals` is the single answer both halves come from.
 */
describe("a month's total and its breakdown come from one set of rows", async () => {
  const { buildLedger, monthFlowTotals } = await import("../../src/domain/balance");
  const base = {
    openingBalanceMinor: 1_000_00,
    startMonth: "2026-07" as const,
    endMonth: "2026-09" as const,
    adjustments: [],
    today: "2026-07-25" as const,
    includePendingInCells: true,
  };
  const planned = (id: string, date: string, amountTryMinor: number, type: "income" | "expense" | "transfer", categoryId: string | null = "cat") => ({
    id, type, amountTryMinor, effectiveDate: date, status: "pending" as const,
    categoryId, paymentSourceId: null, personIsSelf: true,
    categoryKind: type === "income" ? ("income" as const) : ("expense" as const),
    installmentPlanId: null, subscriptionId: null, isAggregate: false,
  });

  it("reports a future month's planned expense instead of three zeros", () => {
    const ledger = buildLedger({ ...base, transactions: [planned("t1", "2026-08-05", 50_00, "expense")] });
    const august = required(ledger[1]);
    const flows = monthFlowTotals(august);
    expect(flows.expenseMinor).toBe(50_00);
    expect(flows.expenseMinor).toBe(august.byCategory.get("cat"));
    // The realized chain is deliberately untouched.
    expect(august.expenseMinor).toBe(0);
    expect(august.closingMinor).toBe(1_000_00);
  });

  it("keeps the shown total equal to the shown breakdown, every month", () => {
    const ledger = buildLedger({
      ...base,
      adjustments: [{ date: "2026-07-20", amountMinor: -25_00 }],
      transactions: [
        // realized (past), planned income, planned expense, planned investment
        { ...planned("r1", "2026-07-01", 200_00, "expense"), status: "realized" as const },
        planned("t1", "2026-08-05", 50_00, "expense"),
        planned("t2", "2026-08-15", 300_00, "income", "salary"),
        planned("t3", "2026-09-10", 120_00, "transfer", "invest"),
      ],
    });
    for (const month of ledger) {
      const flows = monthFlowTotals(month);
      expect(flows.closingMinor).toBe(
        flows.openingMinor + flows.incomeMinor - flows.expenseMinor - flows.transferMinor + flows.adjustmentMinor,
      );
    }
    // …and the projected chain carries forward, month to month.
    expect(monthFlowTotals(required(ledger[0])).closingMinor).toBe(1_000_00 - 200_00 - 25_00);
    expect(monthFlowTotals(required(ledger[1])).closingMinor).toBe(775_00 + 300_00 - 50_00);
    expect(monthFlowTotals(required(ledger[2])).closingMinor).toBe(1_025_00 - 120_00);
  });

  it("classifies a planned investment as a transfer, not an expense", () => {
    const ledger = buildLedger({ ...base, transactions: [planned("t3", "2026-09-10", 120_00, "transfer", "invest")] });
    const flows = monthFlowTotals(required(ledger[2]));
    expect(flows.transferMinor).toBe(120_00);
    expect(flows.expenseMinor).toBe(0);
  });

  it("is identical to the realized chain for a settled month", () => {
    const ledger = buildLedger({
      ...base,
      transactions: [{ ...planned("r1", "2026-07-01", 200_00, "expense"), status: "realized" as const }],
    });
    const july = required(ledger[0]);
    expect(monthFlowTotals(july)).toMatchObject({
      openingMinor: july.openingMinor,
      incomeMinor: july.incomeMinor,
      expenseMinor: july.expenseMinor,
      transferMinor: july.transferMinor,
      closingMinor: july.closingMinor,
    });
  });

  it("stays at the realized numbers when pending cells are turned off", () => {
    const transactions = [planned("t1", "2026-08-05", 50_00, "expense")];
    const ledger = buildLedger({ ...base, includePendingInCells: false, transactions });
    const august = required(ledger[1]);
    // Nothing is displayed for the month, so nothing is claimed for it either.
    expect(august.byCategory.get("cat")).toBeUndefined();
    expect(monthFlowTotals(august)).toMatchObject({ expenseMinor: 0, closingMinor: august.closingMinor });
  });

  it("does not leak a planned row into a neighbouring month or year", () => {
    const ledger = buildLedger({
      ...base,
      endMonth: "2027-01",
      transactions: [planned("t1", "2026-12-31", 90_00, "expense"), planned("t2", "2027-01-01", 10_00, "expense")],
    });
    const december = required(ledger.find((m) => m.month === "2026-12"));
    const january = required(ledger.find((m) => m.month === "2027-01"));
    expect(monthFlowTotals(december).expenseMinor).toBe(90_00);
    expect(monthFlowTotals(january).expenseMinor).toBe(10_00);
    expect(monthFlowTotals(january).openingMinor).toBe(monthFlowTotals(december).closingMinor);
  });

  it("ignores a planned row that belongs to a watched person", () => {
    const ledger = buildLedger({
      ...base,
      transactions: [{ ...planned("t1", "2026-08-05", 50_00, "expense"), personIsSelf: false }],
    });
    const august = required(ledger[1]);
    expect(monthFlowTotals(august).expenseMinor).toBe(0);
    expect(august.byCategory.get("cat")).toBeUndefined();
  });
});

describe("resolveLedgerAnchor (prior-year history)", async () => {
  const { resolveLedgerAnchor } = await import("../../src/domain/balance");
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

/**
 * The chain-then-slice pair `useLedgerState` builds, assembled here the same
 * way it assembles it.
 *
 * There used to be a `buildLedgerBundle` in the domain doing this, and its own
 * comment claimed the rules were "stated once". They were not: `data/hooks.ts`
 * re-inlined the composition when it gained the chain and slice caches, so the
 * product never called the wrapper and these tests were pinning a code path
 * nothing shipped. Composing it here instead keeps the assertions and makes
 * them mirror the live caller.
 */
function ledgerBundle(input: {
  configuredStart: MonthKey | null;
  openingBalanceMinor: number;
  includePendingInCells: boolean;
  transactions: TxLike[];
  adjustments: { date: ISODate; amountMinor: number }[];
  year: number;
  today: ISODate;
}): LedgerBundle {
  return sliceLedgerYear(
    buildLedgerChain({ ...input, endYear: ledgerChainEndYear(input.year, input.today) }),
    input.year,
  );
}

describe("the ledger bundle a screen reads", () => {
  const base = {
    configuredStart: "2026-01" as const,
    openingBalanceMinor: 1_000_00,
    includePendingInCells: true,
    adjustments: [],
    year: 2026,
    today: "2026-07-15" as const,
  };

  /**
   * The state a workspace is in the moment its ledger is cleared, and the one
   * this used to answer with `null` — which each screen then read as "still
   * loading", "no records this month" or "your data could not be read".
   */
  describe("with no opening month configured", () => {
    const unanchored = { ...base, configuredStart: null, openingBalanceMinor: 0 };

    it("opens this month at zero when there is nothing to show", () => {
      const bundle = ledgerBundle({ ...unanchored, transactions: [] });
      expect(bundle.startMonth).toBe("2026-07");
      expect(bundle.actualBalanceMinor).toBe(0);
    });

    it("starts where the data starts and counts all of it", () => {
      const bundle = ledgerBundle({
        ...unanchored,
        transactions: [
          tx({ type: "income", amountTryMinor: 900_00, effectiveDate: "2026-03-04" }),
          tx({ type: "expense", amountTryMinor: 250_00, effectiveDate: "2026-05-20" }),
        ],
      });
      expect(bundle.startMonth).toBe("2026-03");
      expect(required(bundle.ledger.find((month) => month.month === "2026-03")).openingMinor).toBe(0);
      expect(bundle.actualBalanceMinor).toBe(650_00);
    });

    /**
     * The reset's own failure mode, and the reason this is not merely about a
     * blank first render: the anchor goes with an unbounded ledger reset, so
     * every row entered AFTERWARDS was refused before the chain looked at it.
     */
    it("shows a row entered after the ledger was cleared", () => {
      const bundle = ledgerBundle({
        ...unanchored,
        transactions: [tx({ type: "income", amountTryMinor: 120_00, effectiveDate: "2026-07-02" })],
      });
      expect(bundle.actualBalanceMinor).toBe(120_00);
      expect(required(bundle.yearMonths.find((month) => month.month === "2026-07")).closingMinor).toBe(120_00);
    });

    it("keeps a balance adjustment as its own kind of record", () => {
      const bundle = ledgerBundle({
        ...unanchored,
        transactions: [],
        adjustments: [{ date: "2026-04-10", amountMinor: 500_00 }],
      });
      expect(bundle.startMonth).toBe("2026-04");
      expect(bundle.actualBalanceMinor).toBe(500_00);
    });
  });

  it("takes the current balance from the chain's current month, not a second scan", () => {
    const transactions = [
      tx({ type: "income", amountTryMinor: 500_00, effectiveDate: "2026-07-01" }),
      // Later this month but already realized: still part of today's balance.
      tx({ type: "expense", amountTryMinor: 200_00, effectiveDate: "2026-07-10" }),
      // Future: visible in the table, absent from the balance.
      tx({ type: "expense", amountTryMinor: 999_00, effectiveDate: "2026-08-01" }),
    ];
    const bundle = required(ledgerBundle({ ...base, transactions }));
    const july = required(bundle.ledger.find((month) => month.month === "2026-07"));
    expect(bundle.actualBalanceMinor).toBe(1_300_00);
    expect(bundle.actualBalanceMinor).toBe(july.closingMinor);
  });

  it("back-anchors to earlier data while keeping the balance at the configured start", () => {
    const bundle = required(ledgerBundle({
      ...base,
      transactions: [tx({ type: "expense", amountTryMinor: 300_00, effectiveDate: "2025-11-20" })],
    }));
    expect(bundle.startMonth).toBe("2025-11");
    const january = required(bundle.ledger.find((month) => month.month === "2026-01"));
    expect(january.openingMinor).toBe(1_000_00);
    // The prior-year month is in the chain but not in the requested year's slice.
    expect(bundle.yearMonths.every((month) => month.month.startsWith("2026-"))).toBe(true);
    expect(bundle.yearMonths).toHaveLength(12);
  });

  it("extends a past year's request to the end of the current year", () => {
    const bundle = required(ledgerBundle({ ...base, transactions: [], year: 2026, today: "2027-03-01" }));
    expect(bundle.ledger.at(-1)?.month).toBe("2027-12");
    // The slice still answers the year that was asked for.
    expect(bundle.yearMonths.at(0)?.month).toBe("2026-01");
    expect(bundle.yearMonths.at(-1)?.month).toBe("2026-12");
  });

  it("passes the pending-cell preference through to the category cells", () => {
    const transactions = [tx({ type: "expense", amountTryMinor: 75_00, effectiveDate: "2026-09-01", status: "pending", categoryId: "cat" })];
    const shown = required(ledgerBundle({ ...base, transactions }));
    const hidden = required(ledgerBundle({ ...base, transactions, includePendingInCells: false }));
    expect(required(shown.ledger.find((month) => month.month === "2026-09")).byCategory.get("cat")).toBe(75_00);
    expect(required(hidden.ledger.find((month) => month.month === "2026-09")).byCategory.get("cat")).toBeUndefined();
    // Either way a pending row never moves the balance.
    expect(shown.actualBalanceMinor).toBe(hidden.actualBalanceMinor);
  });
});

/**
 * The floor the Mali Tablo offers as a year, which is not the floor the chain
 * has to start from.
 */
describe("the earliest month that actually holds something", () => {
  const base = {
    includePendingInCells: false,
    adjustments: [] as { date: ISODate; amountMinor: number }[],
    year: 2026,
    today: "2026-07-15" as const,
  };

  it("is null for a workspace with an anchor and nothing in it", () => {
    const bundle = ledgerBundle({ ...base, configuredStart: "2020-01", openingBalanceMinor: 50_000_00, transactions: [] });
    expect(bundle.startMonth).toBe("2020-01");
    expect(bundle.firstRecordedMonth).toBeNull();
  });

  /**
   * An import writes an anchor. Bringing one year of a ten-year workbook used
   * to leave the other nine reachable, each a page of blank rows with the
   * balance columns carrying the opening figure across them — the table said
   * data was there and every cell said it was not.
   */
  it("is the first recorded month even when the anchor is years earlier", () => {
    const bundle = ledgerBundle({
      ...base,
      configuredStart: "2020-01",
      openingBalanceMinor: 50_000_00,
      transactions: [tx({ type: "expense", amountTryMinor: 300_00, effectiveDate: "2026-03-04" })],
    });
    expect(bundle.startMonth).toBe("2020-01");
    expect(bundle.firstRecordedMonth).toBe("2026-03");
    // The chain is untouched: the balance at the first recorded month is still
    // the opening figure carried across the empty years, so hiding those years
    // changes navigation and no arithmetic.
    expect(required(bundle.yearMonths.find((month) => month.month === "2026-03")).openingMinor).toBe(50_000_00);
  });

  it("counts a balance correction, not only a transaction", () => {
    const bundle = ledgerBundle({
      ...base,
      configuredStart: "2026-01",
      openingBalanceMinor: 0,
      transactions: [tx({ type: "expense", amountTryMinor: 10_00, effectiveDate: "2026-06-01" })],
      adjustments: [{ date: "2026-02-10", amountMinor: 500_00 }],
    });
    expect(bundle.firstRecordedMonth).toBe("2026-02");
  });

  it("reaches back past the anchor when the data does", () => {
    const bundle = ledgerBundle({
      ...base,
      configuredStart: "2026-01",
      openingBalanceMinor: 0,
      transactions: [tx({ type: "expense", amountTryMinor: 10_00, effectiveDate: "2025-11-02" })],
    });
    expect(bundle.startMonth).toBe("2025-11");
    expect(bundle.firstRecordedMonth).toBe("2025-11");
  });
});

/**
 * A declaration holds the balance at the end of its day to the figure the owner
 * wrote down (owner decision, 2026-09-13). What it adds is recomputed from the
 * rows as they stand, so a row entered later on or before that day is absorbed
 * and one after it still counts.
 */
describe("dated balance declarations", () => {
  const today = "2026-03-31" as ISODate;
  const chain = (transactions: TxLike[], adjustments: Parameters<typeof buildLedgerChain>[0]["adjustments"], configuredStart: MonthKey | null = "2026-01", opening = 1000_00) =>
    buildLedgerChain({ configuredStart, openingBalanceMinor: opening, includePendingInCells: true, transactions, adjustments, endYear: 2026, today });
  const month = (built: ReturnType<typeof chain>, key: MonthKey) => required(built.ledger.find((entry) => entry.month === key));
  const income = tx({ type: "income", amountTryMinor: 500_00, effectiveDate: "2026-02-10", categoryKind: "income" });
  const march = tx({ type: "expense", amountTryMinor: 200_00, effectiveDate: "2026-03-05", categoryKind: "expense" });
  const declaration = { id: "feb-close", date: "2026-02-28" as ISODate, amountMinor: 0, declaredMinor: 2000_00 };

  it("opens the next month on the declared figure and says what it corrected", () => {
    const built = chain([income, march], [declaration]);
    expect(month(built, "2026-03").openingMinor).toBe(2000_00);
    expect(month(built, "2026-02").adjustmentMinor).toBe(500_00);
    expect(built.declarationDeltaById.get("feb-close")).toBe(500_00);
    expect(built.actualBalanceMinor).toBe(1800_00);
  });

  it("absorbs a row entered later on or before its day, and not one after it", () => {
    const forgotten = tx({ type: "expense", amountTryMinor: 100_00, effectiveDate: "2026-02-28", categoryKind: "expense" });
    const nextDay = tx({ type: "expense", amountTryMinor: 50_00, effectiveDate: "2026-03-01", categoryKind: "expense" });
    const built = chain([income, forgotten, march, nextDay], [declaration]);
    expect(month(built, "2026-03").openingMinor).toBe(2000_00);
    expect(built.declarationDeltaById.get("feb-close")).toBe(600_00);
    expect(built.actualBalanceMinor).toBe(1750_00);
  });

  it("counts a movement adjustment on its day before holding the declared figure", () => {
    const built = chain([income], [{ date: "2026-02-28", amountMinor: 70_00 }, declaration]);
    expect(month(built, "2026-02").closingMinor).toBe(2000_00);
    expect(built.declarationDeltaById.get("feb-close")).toBe(430_00);
  });

  it("ignores a declaration dated after today", () => {
    const built = chain([income], [{ ...declaration, date: "2026-04-30" as ISODate }]);
    expect(built.actualBalanceMinor).toBe(1500_00);
    expect(built.declarationDeltaById.size).toBe(0);
  });

  it("opens from a declaration dated before the anchor and still holds the anchor's own month", () => {
    const early = { id: "jan-close", date: "2026-01-31" as ISODate, amountMinor: 0, declaredMinor: 1000_00 };
    const built = chain([income], [early], "2026-03", 5000_00);
    expect(built.startMonth).toBe("2026-01");
    expect(month(built, "2026-01").openingMinor).toBe(1000_00);
    expect(month(built, "2026-03").openingMinor).toBe(5000_00);
    // The anchor rides along without an id, so it says nothing about itself.
    expect([...built.declarationDeltaById.keys()]).toEqual(["jan-close"]);
  });

  it("lets a declaration on the anchor's own day win over the anchor", () => {
    const sameDay = { id: "same-day", date: "2026-02-28" as ISODate, amountMinor: 0, declaredMinor: 4000_00 };
    const built = chain([income], [sameDay], "2026-03", 5000_00);
    // The anchor is still the earliest statement, so February opens on its figure.
    expect(month(built, "2026-02").openingMinor).toBe(4500_00);
    expect(month(built, "2026-03").openingMinor).toBe(4000_00);
    expect(built.declarationDeltaById.get("same-day")).toBe(-1000_00);
  });

  it("opens an unanchored table so its earliest declaration holds", () => {
    const built = chain([income, march], [declaration], null);
    expect(month(built, "2026-02").openingMinor).toBe(1500_00);
    expect(month(built, "2026-03").openingMinor).toBe(2000_00);
    expect(built.declarationDeltaById.get("feb-close")).toBe(0);
  });

  it("holds several declarations in one month, each to the end of its own day", () => {
    const later = tx({ type: "expense", amountTryMinor: 100_00, effectiveDate: "2026-02-20", categoryKind: "expense" });
    const built = buildLedgerChain({
      configuredStart: "2026-01", openingBalanceMinor: 1000_00, includePendingInCells: true, transactions: [income, later],
      adjustments: [
        { id: "feb-close-b", date: "2026-02-28", amountMinor: 0, declaredMinor: 2100_00 },
        { date: "2026-02-25", amountMinor: 30_00 },
        { id: "feb-close", date: "2026-02-28", amountMinor: 0, declaredMinor: 2000_00 },
        { id: "feb-mid", date: "2026-02-15", amountMinor: 0, declaredMinor: 1800_00 },
      ],
      settlements: [{ statementId: "st", date: "2026-02-28", amountMinor: -50_00, kind: "payment", planned: false }],
      endYear: 2026, today,
    });
    // Mid-month: only the income is on or before its day.
    expect(built.declarationDeltaById.get("feb-mid")).toBe(300_00);
    // Month end: the later expense, the adjustment and the payment all count first.
    expect(built.declarationDeltaById.get("feb-close")).toBe(320_00);
    // Two on one day hold in id order, so the last one written down wins.
    expect(built.declarationDeltaById.get("feb-close-b")).toBe(100_00);
    expect(month(built, "2026-02").closingMinor).toBe(2100_00);
    expect(month(built, "2026-03").openingMinor).toBe(2100_00);
  });

  it("keeps an unconfirmed row before it planned rather than cancelling it", () => {
    const unconfirmed = tx({ type: "expense", amountTryMinor: 300_00, effectiveDate: "2026-02-15", status: "pending", categoryKind: "expense" });
    const built = chain([income, unconfirmed], [declaration]);
    expect(month(built, "2026-02").closingMinor).toBe(2000_00);
    expect(month(built, "2026-02").projectedClosingMinor).toBe(1700_00);
  });

  it("holds two declarations on one day in id order, whichever was read first", () => {
    const second = { ...declaration, id: "feb-close-b", declaredMinor: 2100_00 };
    for (const adjustments of [[declaration, second], [second, declaration]]) {
      const built = chain([income], adjustments);
      expect(built.declarationDeltaById.get("feb-close")).toBe(500_00);
      expect(built.declarationDeltaById.get("feb-close-b")).toBe(100_00);
    }
  });

  it("opens on the anchor's figure whatever is written after it", () => {
    // A later declaration keeps the difference it made for an older client.
    const later = { id: "mar-close", date: "2026-03-10" as ISODate, amountMinor: 25_00, declaredMinor: 1600_00 };
    const built = chain([income], [{ date: "2026-02-20", amountMinor: 70_00 }, later]);
    expect(month(built, "2026-01").openingMinor).toBe(1000_00);
  });

  it("opens an unanchored table from the earliest declaration on or before today, however they were read", () => {
    const movement = { date: "2026-02-01" as ISODate, amountMinor: 10_00 };
    const opens = (...declarations: (typeof declaration)[]) =>
      month(chain([income, march], [movement, ...declarations], null), "2026-02").openingMinor;
    // Ids that sort against their days, so only the day can pick February.
    const february = { ...declaration, id: "z-feb" };
    const midMarch = { id: "a-mar", date: "2026-03-15" as ISODate, amountMinor: 0, declaredMinor: 3000_00 };
    const april = { id: "b-apr", date: "2026-04-30" as ISODate, amountMinor: 0, declaredMinor: 9000_00 };
    expect(opens(midMarch, february, april)).toBe(1490_00);
    expect(opens(april, february, midMarch)).toBe(1490_00);
    // Nothing stated on or before today yet.
    expect(opens(april)).toBe(0);
    expect(opens({ id: "today", date: today, amountMinor: 0, declaredMinor: 1000_00 })).toBe(690_00);
    const sameDay = { ...declaration, id: "feb-close-b", declaredMinor: 2100_00 };
    expect(opens(sameDay, declaration)).toBe(1490_00);
    expect(opens(declaration, sameDay)).toBe(1490_00);
  });
});

/**
 * A recorded statement payment moves the balance on the day it was made, and
 * the month says why: its charges stay in their cells, the unpaid part is
 * owed, and a payment made in another month is given back where the charges
 * land (owner decision, 2026-09-13).
 */
describe("statement payments in the chain", () => {
  const today = "2026-09-20" as ISODate;
  const charge = tx({ type: "expense", amountTryMinor: 12_000_00, effectiveDate: "2026-09-10", status: "realized", categoryKind: "expense", categoryId: "kart", cardStatementId: "aug" });
  const build = (settlements: Parameters<typeof buildLedgerChain>[0]["settlements"]) =>
    buildLedgerChain({ configuredStart: "2026-08", openingBalanceMinor: 20_000_00, includePendingInCells: true, transactions: [charge], adjustments: [], settlements, endYear: 2026, today });
  const month = (built: ReturnType<typeof build>, key: MonthKey) => required(built.ledger.find((entry) => entry.month === key));

  it("takes only what was paid when the minimum is paid in the due month", () => {
    const built = build([
      { statementId: "aug", date: "2026-09-10", amountMinor: 8_000_00, kind: "owed", planned: false },
      { statementId: "aug", date: "2026-09-08", amountMinor: -4_000_00, kind: "payment", planned: false },
      { statementId: "aug", date: "2026-09-10", amountMinor: 4_000_00, kind: "paidElsewhere", planned: false },
    ]);
    const september = month(built, "2026-09");
    expect(september.byCategory.get("kart")).toBe(12_000_00);
    expect(september.cardOwedMinor).toBe(8_000_00);
    expect(september.cardPaymentsMinor).toBe(0);
    expect(built.actualBalanceMinor).toBe(16_000_00);
    const totals = monthFlowTotals(september);
    expect(totals.openingMinor - totals.expenseMinor + totals.cardOwedMinor + totals.cardPaymentsMinor).toBe(totals.closingMinor);
  });

  it("moves a payment made in an earlier month into that month", () => {
    const built = build([
      { statementId: "aug", date: "2026-09-10", amountMinor: 8_000_00, kind: "owed", planned: false },
      { statementId: "aug", date: "2026-08-30", amountMinor: -4_000_00, kind: "payment", planned: false },
      { statementId: "aug", date: "2026-09-10", amountMinor: 4_000_00, kind: "paidElsewhere", planned: false },
    ]);
    expect(month(built, "2026-08").closingMinor).toBe(16_000_00);
    expect(month(built, "2026-08").cardPaymentsMinor).toBe(-4_000_00);
    expect(month(built, "2026-09").cardPaymentsMinor).toBe(4_000_00);
    expect(built.actualBalanceMinor).toBe(16_000_00);
  });

  it("keeps planned settlement lines out of the balance and in the projection", () => {
    const pending = { ...charge, effectiveDate: "2026-10-05" as ISODate, status: "pending" as const };
    const built = buildLedgerChain({
      configuredStart: "2026-08", openingBalanceMinor: 20_000_00, includePendingInCells: true, transactions: [pending], adjustments: [],
      settlements: [
        { statementId: "aug", date: "2026-10-05", amountMinor: 8_000_00, kind: "owed", planned: true },
        { statementId: "aug", date: "2026-09-15", amountMinor: -4_000_00, kind: "payment", planned: false },
        { statementId: "aug", date: "2026-10-05", amountMinor: 4_000_00, kind: "paidElsewhere", planned: true },
      ],
      endYear: 2026, today,
    });
    expect(built.actualBalanceMinor).toBe(16_000_00);
    expect(month(built, "2026-10").closingMinor).toBe(16_000_00);
    expect(month(built, "2026-10").projectedClosingMinor).toBe(16_000_00);
    expect(month(built, "2026-10").plannedCardSettlementMinor).toBe(12_000_00);
    expect(month(built, "2026-10").cardPaymentsMinor).toBe(4_000_00);
  });

  it("reaches back to a payment made before anything else was recorded", () => {
    const built = buildLedgerChain({
      configuredStart: "2026-09", openingBalanceMinor: 20_000_00, includePendingInCells: true, transactions: [charge], adjustments: [],
      settlements: [
        { statementId: "aug", date: "2026-09-10", amountMinor: 8_000_00, kind: "owed", planned: false },
        { statementId: "aug", date: "2026-08-30", amountMinor: -4_000_00, kind: "payment", planned: false },
        { statementId: "aug", date: "2026-09-10", amountMinor: 4_000_00, kind: "paidElsewhere", planned: false },
      ],
      endYear: 2026, today,
    });
    expect(built.startMonth).toBe("2026-08");
    expect(month(built, "2026-09").openingMinor).toBe(20_000_00);
    expect(built.actualBalanceMinor).toBe(20_000_00);
  });

  it("opens on what was paid, not on settlement lines that are still planned", () => {
    const overdue = { ...charge, effectiveDate: "2026-08-10" as ISODate, status: "pending" as const };
    const built = buildLedgerChain({
      configuredStart: "2026-09", openingBalanceMinor: 20_000_00, includePendingInCells: true, transactions: [overdue], adjustments: [],
      settlements: [
        { statementId: "aug", date: "2026-08-10", amountMinor: 8_000_00, kind: "owed", planned: true },
        { statementId: "aug", date: "2026-08-05", amountMinor: -4_000_00, kind: "payment", planned: false },
        { statementId: "aug", date: "2026-08-10", amountMinor: 4_000_00, kind: "paidElsewhere", planned: true },
      ],
      endYear: 2026, today,
    });
    expect(month(built, "2026-08").openingMinor).toBe(24_000_00);
    expect(month(built, "2026-09").openingMinor).toBe(20_000_00);
  });
});
