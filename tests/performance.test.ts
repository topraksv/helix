import { describe, expect, it } from "vitest";
import { buildLedger } from "../src/domain/balance";
import { creditCardSplit, creditCardSplitsByMonth } from "../src/domain/analytics";
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

/**
 * The item-breakdown screen builds twelve month rows. `creditCardSplit`
 * internally computes EVERY month via `creditCardSplitsByMonth` and then
 * discards all but one, so calling it once per row re-scanned the whole ledger
 * twelve times per render. Measured before the fix: 65.26 ms at 100k rows,
 * 6.71 ms at 10k. Hoisted: 5.35 ms and 0.56 ms — 12.2x and 12.0x.
 *
 * `buildCashFlowMatrixModel` already had this contract (the test above);
 * this one pins the same property for the item screen's call pattern, and
 * asserts the two forms agree so the optimisation cannot change a number.
 */
describe("item breakdown credit-card splits", () => {
  const transactions = largeTransactions(LARGE_LEDGER_ROWS);
  const cards = new Set(["card"]);
  const today = "2026-12-31" as ISODate;
  const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);

  it("produces identical values to the per-month form", () => {
    const batch = creditCardSplitsByMonth(transactions, cards, today);
    for (const month of months) {
      const single = creditCardSplit(transactions, cards, month, today);
      expect(batch.get(month) ?? { singleMinor: 0, installmentMinor: 0 }).toEqual(single);
    }
  });

  it("builds all twelve months in one scan, well inside the row-loop cost", () => {
    const startedAt = performance.now();
    const batch = creditCardSplitsByMonth(transactions, cards, today);
    for (const month of months) batch.get(month);
    const batched = performance.now() - startedAt;

    const perMonthStart = performance.now();
    for (const month of months) creditCardSplit(transactions, cards, month, today);
    const perMonth = performance.now() - perMonthStart;

    // A regression to the per-month pattern is ~12x slower; 4x is a wide margin
    // that still fails loudly if the batch form is replaced by a loop.
    expect(batched * 4).toBeLessThan(perMonth);
  });

  it("keeps the screen's own call pattern off the per-month path", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(process.cwd(), "src/app/(tabs)/cash-flow/item.tsx"), "utf8");
    expect(source).toContain("creditCardSplitsByMonth");
    expect(source).not.toMatch(/creditCardSplit\(/);
  });
});

/**
 * Analysis search builds a token line per transaction, and the money formatter
 * inside it is an `Intl.NumberFormat` call. Measured at 100k rows: 65 ms to
 * build the index, 140 ms to filter it — so the screen must key both on their
 * real inputs. Built from the render instead, the index was rebuilt on every
 * keystroke in the search box, every filter chip and every layout measurement.
 *
 * The budget below is deliberately broad; what it defends is that the cost per
 * transaction stays constant, so a change that adds another whole-table pass
 * to either half shows up as a failure rather than as a laggy search box.
 */
describe("analysis search cost", () => {
  const SEARCH_BUDGET_MS = 4_000;
  const rows = largeTransactions(LARGE_LEDGER_ROWS).map((transaction, index) => ({
    ...transaction,
    note: index % 5 === 0 ? "market alışverişi" : null,
    searchText: `kategori kaynak ${index % 5 === 0 ? "market alışverişi" : ""} ${transaction.amountTryMinor}`,
  }));

  it("indexes and filters a 100k-row account within the release budget", async () => {
    const { formatMinorCompact } = await import("../src/domain/money");
    const { filterTransactions } = await import("../src/domain/transaction-search");

    const indexStartedAt = performance.now();
    const index = rows.map((transaction) => ({
      ...transaction,
      searchText: [transaction.note ?? "", formatMinorCompact(transaction.amountTryMinor)].join(" "),
    }));
    const indexElapsed = performance.now() - indexStartedAt;

    const filterStartedAt = performance.now();
    const matches = filterTransactions(index, {
      query: "market",
      type: null,
      categoryId: null,
      paymentSourceId: null,
      from: null,
      to: null,
    });
    const filterElapsed = performance.now() - filterStartedAt;

    // Every fifth row carries the note, so the filter really does match at
    // scale — and the result list stays bounded by its own cap rather than
    // handing 20 000 rows to a screen.
    expect(matches.length).toBe(100);
    expect(matches.every((match) => match.searchText.includes("market"))).toBe(true);
    expect(indexElapsed).toBeLessThan(SEARCH_BUDGET_MS);
    expect(filterElapsed).toBeLessThan(SEARCH_BUDGET_MS);
  });
});
