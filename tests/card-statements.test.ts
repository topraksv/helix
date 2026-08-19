import { describe, expect, it } from "vitest";
import { MONTH_END_DAY } from "../src/domain/dates";
import {
  CARD_CYCLE_GRACE,
  cardCycleGraceDays,
  isCardCycleDayConflict,
  isValidCardCycle,
  isValidCardCycleGrace,
  refusedCardCycleDays,
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

/**
 * A statement that closes on the day it is due has no period at all, and the
 * app writes day 31 as "ayın sonu" — so the two spellings of the same day have
 * to collide too.
 */
describe("a card cycle needs two different days", () => {
  it("rejects the same day, however it was written", () => {
    expect(isCardCycleDayConflict(15, 15)).toBe(true);
    expect(isCardCycleDayConflict(MONTH_END_DAY, 31)).toBe(true);
    expect(isCardCycleDayConflict(31, MONTH_END_DAY)).toBe(true);
  });

  it("accepts a real cycle and stays quiet while a field is empty", () => {
    expect(isCardCycleDayConflict(15, 25)).toBe(false);
    expect(isCardCycleDayConflict(null, 25)).toBe(false);
    expect(isCardCycleDayConflict(15, null)).toBe(false);
    expect(isCardCycleDayConflict(null, null)).toBe(false);
  });
});

/**
 * The gap between the two days is the whole rule.
 *
 * `statementPeriod` resolves the due date into the NEXT month whenever the due
 * day is not past the closing day, so no pair is ever "backwards" and equality
 * was the only thing the forms refused. That let a card be created whose due
 * date lands a day before its next statement closes — and, on two of the three
 * screens that create cards, let both days be "ayın sonu" with no complaint at
 * all.
 */
describe("how far apart a card's two days may sit", () => {
  it("counts the gap forward, wrapping into the next month", () => {
    expect(cardCycleGraceDays(25, 5)).toBe(10);
    expect(cardCycleGraceDays(5, 15)).toBe(10);
    expect(cardCycleGraceDays(MONTH_END_DAY, 10)).toBe(9);
    expect(cardCycleGraceDays(1, 11)).toBe(10);
    // Never negative, whichever way round the days are.
    for (let statement = 1; statement <= MONTH_END_DAY; statement += 1) {
      for (let due = 1; due <= MONTH_END_DAY; due += 1) {
        expect(cardCycleGraceDays(statement, due), `${statement}/${due}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("accepts the cycles Turkish cards actually issue", () => {
    for (const [statement, due] of [[25, 5], [1, 11], [10, 25], [15, 28], [MONTH_END_DAY, 10]] as const) {
      expect(isValidCardCycleGrace(statement, due), `${statement}/${due}`).toBe(true);
    }
  });

  it("refuses a pair that is not a cycle", () => {
    // No period at all — including the case the owner reported, both fields
    // set to the month end.
    expect(isValidCardCycleGrace(MONTH_END_DAY, MONTH_END_DAY)).toBe(false);
    expect(isValidCardCycleGrace(15, 15)).toBe(false);
    // A due date that lands just before the NEXT statement closes.
    expect(isValidCardCycleGrace(MONTH_END_DAY, 30)).toBe(false);
    expect(isValidCardCycleGrace(25, 20)).toBe(false);
    expect(isValidCardCycleGrace(5, 4)).toBe(false);
    // Exactly at the ceiling is allowed; one day past it is not.
    expect(isValidCardCycleGrace(5, 5 + CARD_CYCLE_GRACE.max)).toBe(true);
    expect(isValidCardCycleGrace(5, 5 + CARD_CYCLE_GRACE.max + 1)).toBe(false);
  });

  it("says nothing while only one of the two days is known", () => {
    expect(isValidCardCycleGrace(null, 10)).toBe(true);
    expect(isValidCardCycleGrace(10, null)).toBe(true);
    expect(isValidCardCycleGrace(null, null)).toBe(true);
  });

  /**
   * The picker needs the REFUSED set, not the allowed one: an option it can
   * show and disable with a reason, rather than one that quietly disappears
   * and shortens the row out from under the field beside it.
   */
  it("names the days each field must refuse, and refuses none until the other is set", () => {
    const days = Array.from({ length: MONTH_END_DAY }, (_, index) => index + 1);
    expect(refusedCardCycleDays(null, "due", days)).toEqual([]);
    expect(refusedCardCycleDays(null, "statement", days)).toEqual([]);

    // With the statement on the 25th, the payable days are the 26th to the
    // 31st and the 1st to the 15th — everything else is refused.
    const refusedDue = refusedCardCycleDays(25, "due", days);
    expect(refusedDue).toContain(25);
    expect(refusedDue).toContain(20);
    expect(refusedDue).not.toContain(5);
    expect(refusedDue).not.toContain(26);
    for (const day of refusedDue) expect(isValidCardCycleGrace(25, day), `due ${day}`).toBe(false);

    // Symmetric: the same question asked from the statement field.
    const refusedStatement = refusedCardCycleDays(5, "statement", days);
    for (const day of refusedStatement) expect(isValidCardCycleGrace(day, 5), `statement ${day}`).toBe(false);
    expect(refusedStatement).toContain(5);
    expect(refusedStatement).not.toContain(MONTH_END_DAY);
  });

  /** Every accepted pair must still resolve to a real period. */
  it("leaves every accepted pair producing a due date after its statement", () => {
    for (let statement = 1; statement <= MONTH_END_DAY; statement += 1) {
      for (let due = 1; due <= MONTH_END_DAY; due += 1) {
        if (!isValidCardCycleGrace(statement, due)) continue;
        const period = statementPeriod("2026-03", { statementDay: statement, dueDay: due });
        expect(period.dueDate > period.statementDate, `${statement}/${due}`).toBe(true);
      }
    }
  });
});
