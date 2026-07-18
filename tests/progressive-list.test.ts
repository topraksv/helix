import { describe, expect, it } from "vitest";
import {
  INITIAL_TRANSACTION_ROWS,
  nextVisibleTransactionCount,
} from "../src/ui/progressive-list";

describe("large transaction list rendering budget", () => {
  it.each([500, 2_000])("keeps the first render bounded for %i transactions", (total) => {
    expect(INITIAL_TRANSACTION_ROWS).toBeLessThan(total);
    expect(nextVisibleTransactionCount(total, INITIAL_TRANSACTION_ROWS)).toBe(160);
  });

  it("never reveals beyond the real row count", () => {
    expect(nextVisibleTransactionCount(95, 80)).toBe(95);
  });
});
