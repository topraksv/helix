import { describe, expect, it } from "vitest";
import {
  isValidCardCycle,
  statementForDueDate,
  statementForPurchase,
  statementPeriod,
} from "../src/domain/card-statements";

describe("credit-card statement periods", () => {
  it("puts a purchase on the cut-off day into the current statement", () => {
    expect(statementForPurchase("2026-07-25", { statementDay: 25, dueDay: 5 })).toEqual({
      periodMonth: "2026-07",
      statementDate: "2026-07-25",
      dueDate: "2026-08-05",
    });
  });

  it("moves a purchase after cut-off into the next statement", () => {
    expect(statementForPurchase("2026-07-26", { statementDay: 25, dueDay: 5 })).toEqual({
      periodMonth: "2026-08",
      statementDate: "2026-08-25",
      dueDate: "2026-09-05",
    });
  });

  it("keeps a later due day in the same calendar month", () => {
    expect(statementForPurchase("2026-07-09", { statementDay: 10, dueDay: 20 })).toEqual({
      periodMonth: "2026-07",
      statementDate: "2026-07-10",
      dueDate: "2026-07-20",
    });
  });

  it("clamps nominal days for short and leap-year months", () => {
    expect(statementPeriod("2028-02", { statementDay: 31, dueDay: 5 })).toEqual({
      periodMonth: "2028-02",
      statementDate: "2028-02-29",
      dueDate: "2028-03-05",
    });
    expect(statementForPurchase("2027-02-28", { statementDay: 31, dueDay: 5 }).periodMonth).toBe("2027-02");
  });

  it("recovers the statement month from a stored due date", () => {
    expect(statementForDueDate("2026-08-05", { statementDay: 25, dueDay: 5 }).periodMonth).toBe("2026-07");
    expect(statementForDueDate("2026-07-20", { statementDay: 10, dueDay: 20 }).periodMonth).toBe("2026-07");
  });

  it("rejects incomplete or out-of-range cycles", () => {
    expect(isValidCardCycle({ statementDay: null, dueDay: 5 })).toBe(false);
    expect(isValidCardCycle({ statementDay: 25, dueDay: 0 })).toBe(false);
    expect(isValidCardCycle({ statementDay: 32, dueDay: 5 })).toBe(false);
    expect(isValidCardCycle({ statementDay: 25, dueDay: 5 })).toBe(true);
  });
});
