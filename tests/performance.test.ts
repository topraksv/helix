import { describe, expect, it } from "vitest";
import { buildLedger } from "../src/domain/balance";
import { buildCashFlowMatrixModel } from "../src/domain/cash-flow-matrix";
import { buildDashboardModel } from "../src/domain/dashboard";
import type { ISODate } from "../src/domain/dates";
import type { TxLike } from "../src/domain/types";

const LARGE_LEDGER_ROWS = 100_000;
// Broad CI ceilings, not micro-benchmarks: a regression to repeated full-table
// scans should fail while normal runner variance remains harmless.
const LEDGER_BUDGET_MS = 4_000;
const DASHBOARD_BUDGET_MS = 4_000;
const MATRIX_BUDGET_MS = 4_000;

function largeTransactions(count: number): TxLike[] {
  return Array.from({ length: count }, (_, index) => {
    const month = String((index % 12) + 1).padStart(2, "0");
    const day = String((index % 28) + 1).padStart(2, "0");
    return {
      id: `perf-${index}`,
      type: index % 5 === 0 ? "income" : "expense",
      amountTryMinor: (index % 10_000) + 1,
      purchaseDate: null,
      effectiveDate: `2026-${month}-${day}` as ISODate,
      status: "realized",
      categoryId: `category-${index % 40}`,
      categoryKind: index % 5 === 0 ? "income" : "expense",
      paymentSourceId: index % 4 === 0 ? "card" : null,
      personIsSelf: true,
      installmentPlanId: index % 7 === 0 ? "plan" : null,
      cardStatementId: null,
      subscriptionId: null,
      isAggregate: false,
    };
  });
}

describe("large-ledger performance contracts", () => {
  const transactions = largeTransactions(LARGE_LEDGER_ROWS);

  it("benchmarks 1k, 10k and 100k ledger rows within the release budget", () => {
    const samples = [1_000, 10_000, LARGE_LEDGER_ROWS].map((rowCount) => {
      const startedAt = performance.now();
      const ledger = buildLedger({
        openingBalanceMinor: 100_000_00,
        startMonth: "2026-01",
        endMonth: "2026-12",
        transactions: transactions.slice(0, rowCount),
        adjustments: [],
        today: "2026-12-31",
      });
      return { rowCount, elapsed: performance.now() - startedAt, months: ledger.length };
    });

    expect(samples.map((sample) => sample.rowCount)).toEqual([1_000, 10_000, 100_000]);
    expect(samples.every((sample) => sample.months === 12)).toBe(true);
    expect(samples.at(-1)?.elapsed).toBeLessThan(LEDGER_BUDGET_MS);
  });

  it("derives the dashboard in one bounded pass", () => {
    const ledger = buildLedger({
      openingBalanceMinor: 100_000_00,
      startMonth: "2026-01",
      endMonth: "2026-12",
      transactions,
      adjustments: [],
      today: "2026-12-31",
    });
    const startedAt = performance.now();
    const model = buildDashboardModel({
      transactions,
      expected: [],
      ledger,
      actualBalanceMinor: ledger.at(-1)?.closingMinor ?? null,
      today: "2026-12-31",
      monthStart: "2026-12-01",
      monthEnd: "2026-12-31",
      currentMonth: "2026-12",
      year: 2026,
      expectedTryMinor: (_currency, amountMinor) => amountMinor,
    });
    const elapsed = performance.now() - startedAt;

    expect(model.trendMonths).toHaveLength(12);
    expect(elapsed).toBeLessThan(DASHBOARD_BUDGET_MS);
  });

  it("builds all credit-card matrix splits without one scan per month", () => {
    const ledger = buildLedger({
      openingBalanceMinor: 100_000_00,
      startMonth: "2026-01",
      endMonth: "2026-12",
      transactions,
      adjustments: [],
      today: "2026-12-31",
    });
    const startedAt = performance.now();
    const model = buildCashFlowMatrixModel({
      year: 2026,
      yearMonths: ledger,
      categories: Array.from({ length: 40 }, (_, index) => ({ id: `category-${index}`, name: `Kategori ${index}` })),
      computedColumns: [{
        id: "cards",
        name: "Kartlar",
        definition: JSON.stringify({ op: "cc_split", part: "single" }),
      }],
      transactions,
      creditCardIds: new Set(["card"]),
      liveCategoryIds: new Set(Array.from({ length: 40 }, (_, index) => `category-${index}`)),
      today: "2026-12-31",
      openingLabel: "Ay Başı",
      closingLabel: "Güncel Bakiye",
    });
    const elapsed = performance.now() - startedAt;

    expect(model.months).toHaveLength(12);
    expect(elapsed).toBeLessThan(MATRIX_BUDGET_MS);
  });
});
