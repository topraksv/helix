import { describe, expect, it } from "vitest";
import { filterTransactions, type SearchableTransaction } from "../src/domain/transaction-search";

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
