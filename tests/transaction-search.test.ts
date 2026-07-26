import { describe, expect, it } from "vitest";
import { filterTransactions, sortTransactions, type SearchableTransaction } from "../src/domain/transaction-search";

const rows: SearchableTransaction[] = [
  { id: "a", type: "expense", categoryId: "market", paymentSourceId: "card", effectiveDate: "2026-07-18", searchText: "Market Temmuz 1250,00" },
  { id: "b", type: "income", categoryId: "salary", paymentSourceId: "bank", effectiveDate: "2026-07-15", searchText: "Maaş Temmuz 50000" },
  { id: "c", type: "expense", categoryId: "market", paymentSourceId: "cash", effectiveDate: "2026-06-02", searchText: "Market Haziran 240" },
];

describe("transaction search", () => {
  it("combines text, date, type, category and source filters", () => {
    expect(filterTransactions(rows, {
      query: "market",
      type: "expense",
      categoryId: "market",
      paymentSourceId: "card",
      from: "2026-07-01",
      to: "2026-07-31",
    }).map((row) => row.id)).toEqual(["a"]);
  });

  it("supports filter-only searches and returns newest first", () => {
    expect(filterTransactions(rows, {
      query: "",
      type: "expense",
      categoryId: null,
      paymentSourceId: null,
      from: null,
      to: null,
    }).map((row) => row.id)).toEqual(["a", "c"]);
  });

  it("bounds rendered results", () => {
    expect(filterTransactions(rows, {
      query: "",
      type: null,
      categoryId: null,
      paymentSourceId: null,
      from: null,
      to: null,
    }, 1)).toHaveLength(1);
  });
});

describe("search result ordering", () => {
  const rows = [
    { id: "b", effectiveDate: "2026-03-01" as const, amountTryMinor: 5_000 },
    { id: "a", effectiveDate: "2026-03-01" as const, amountTryMinor: 5_000 },
    { id: "c", effectiveDate: "2026-01-10" as const, amountTryMinor: 90_000 },
    { id: "d", effectiveDate: "2026-05-20" as const, amountTryMinor: -120_000 },
  ];

  it("orders by date in both directions", () => {
    expect(sortTransactions(rows, "recent").map((r) => r.id)).toEqual(["d", "a", "b", "c"]);
    expect(sortTransactions(rows, "oldest").map((r) => r.id)).toEqual(["c", "a", "b", "d"]);
  });

  /**
   * The largest row here is a refund (-120.000). Ranking it first is the point:
   * "biggest amounts" means biggest sums, and sorting by the signed value would
   * put the largest movement of money last.
   */
  it("orders by magnitude, so a large refund is not buried", () => {
    expect(sortTransactions(rows, "highest").map((r) => r.id)).toEqual(["d", "c", "a", "b"]);
    expect(sortTransactions(rows, "lowest").map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("leaves the caller's array untouched", () => {
    const before = rows.map((r) => r.id);
    sortTransactions(rows, "highest");
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});
