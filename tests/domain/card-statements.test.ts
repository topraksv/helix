import { describe, expect, it } from "vitest";
import { MONTH_END_DAY, addDaysISO } from "../../src/domain/dates";
import { tx } from "../helpers";
import {
  CARD_CYCLE_GRACE,
  cardCycleGraceDays,
  cardCycleProgress,
  daysUntilStatementClose,
  firstInstallmentMonth,
  isCardCycleDayConflict,
  isValidCardCycle,
  isValidCardCycleGrace,
  refusedCardCycleDays,
  settleCardStatements,
  statementForDueDate,
  statementForPurchase,
  statementAmounts,
  statementPeriod,
  statementTotals,
} from "../../src/domain/card-statements";

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

/** The gap between the two days is the rule: equality was not the only invalid cycle. */
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

/**
 * The number the card row actually prints, so it is measured rather than
 * derived at a glance from the ring beside it.
 */
describe("days until a card's statement closes", () => {
  const cycle = { statementDay: 15, dueDay: 5 };

  it("counts down to this month's cut-off from inside the period", () => {
    expect(daysUntilStatementClose("2026-08-09", cycle)).toBe(6);
    expect(daysUntilStatementClose("2026-08-14", cycle)).toBe(1);
  });

  it("is zero on the cut-off day itself, which is still inside the period", () => {
    // `statementForPurchase` puts a purchase made ON the statement date into
    // that date's own statement, so the last day is nought days away and not
    // a whole cycle away.
    expect(daysUntilStatementClose("2026-08-15", cycle)).toBe(0);
  });

  it("jumps to the next cut-off the day after one closes", () => {
    expect(daysUntilStatementClose("2026-08-16", cycle)).toBe(30);
  });

  it("crosses a year boundary without going negative", () => {
    expect(daysUntilStatementClose("2026-12-20", cycle)).toBe(26);
    expect(daysUntilStatementClose("2027-01-15", cycle)).toBe(0);
  });

  it("never reports a negative countdown on any day of a year", () => {
    for (let day = 0; day < 365; day += 1) {
      const today = addDaysISO("2026-01-01", day);
      expect(daysUntilStatementClose(today, cycle), today).toBeGreaterThanOrEqual(0);
    }
  });
});

/** Close-to-close position in the current cycle; the due date falls after the close and is not on the ring. */
describe("where today sits in a card's cycle", () => {
  const cycle = { statementDay: 15, dueDay: 5 };

  it("is at the start on the day after a statement closed", () => {
    expect(cardCycleProgress("2026-07-16", cycle)).toBeCloseTo(1 / 31, 5);
  });

  it("is near the end on the day the next one closes", () => {
    expect(cardCycleProgress("2026-08-15", cycle)).toBe(1);
  });

  it("reads the middle of the window as the middle", () => {
    // 16 Temmuz → 15 Ağustos is 30 days; the 31st of July is 15 of them in.
    expect(cardCycleProgress("2026-07-31", cycle)).toBeCloseTo(16 / 31, 5);
  });

  it("stays inside 0 and 1 for every day of a year", () => {
    for (let day = 0; day < 365; day += 1) {
      const progress = cardCycleProgress(addDaysISO("2026-01-01", day), cycle);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }
  });

  it("refuses a cycle it cannot read rather than inventing a position", () => {
    expect(() => cardCycleProgress("2026-07-16", { statementDay: 0, dueDay: 5 })).toThrow();
  });
});


describe("firstInstallmentMonth", () => {
  it("bills the first instalment on the statement the purchase joins", () => {
    // Closes on the 25th, paid on the 5th of the next month.
    const nextMonthDue = { statementDay: 25, dueDay: 5 };
    expect(firstInstallmentMonth("2026-09-13", nextMonthDue)).toBe("2026-10");
    // After this period has closed the purchase waits a statement longer.
    expect(firstInstallmentMonth("2026-09-26", nextMonthDue)).toBe("2026-11");
    // Closing day itself still joins the closing statement.
    expect(firstInstallmentMonth("2026-09-25", nextMonthDue)).toBe("2026-10");
    // Closes on the 10th, paid on the 20th of the same month.
    const sameMonthDue = { statementDay: 10, dueDay: 20 };
    expect(firstInstallmentMonth("2026-09-08", sameMonthDue)).toBe("2026-09");
    expect(firstInstallmentMonth("2026-09-13", sameMonthDue)).toBe("2026-10");
  });
});

/**
 * Recorded statement payments.
 * Paid in full, the charges land on the day they were paid; paid in part, the
 * balance loses only what was paid and the rest is owed.
 */
describe("settleCardStatements", () => {
  const today = "2026-09-20";
  const charge = (id: string, amount: number, overrides: Partial<Parameters<typeof tx>[0]> = {}) =>
    tx({ id, type: "expense", amountTryMinor: amount, effectiveDate: "2026-10-05", status: "pending", categoryKind: "expense", cardStatementId: "sep", paymentSourceId: "card", ...overrides });
  const pay = (id: string, paidOn: string, amountMinor: number, kind: "full" | "minimum" | "partial" = "full") =>
    ({ id, statementId: "sep", paidOn, amountMinor, kind });

  it("changes nothing for a statement with no payment recorded", () => {
    const transactions = [charge("a", 500_00)];
    const settled = settleCardStatements(transactions, [], today);
    expect(settled.transactions).toBe(transactions);
    expect(settled.flows).toEqual([]);
    expect(settled.byStatement.size).toBe(0);
  });

  it("counts a fully paid statement's charges on the day it was paid", () => {
    const transactions = [charge("a", 700_00), charge("refund", -200_00), charge("other", 900_00, { cardStatementId: "oct" })];
    const settled = settleCardStatements(transactions, [pay("p", "2026-08-30", 500_00)], today);
    expect(settled.transactions.filter((row) => row.cardStatementId === "sep").map((row) => [row.effectiveDate, row.status]))
      .toEqual([["2026-08-30", "realized"], ["2026-08-30", "realized"]]);
    expect(settled.transactions.find((row) => row.id === "other")).toBe(transactions[2]);
    expect(settled.flows).toEqual([]);
    expect(settled.byStatement.get("sep")).toEqual({
      statementId: "sep", chargesMinor: 500_00, paidMinor: 500_00, remainingMinor: 0, state: "full", paidInFullOn: "2026-08-30",
    });
  });

  it("lets an earlier payment leave on its own day when a later one completes the statement", () => {
    const settled = settleCardStatements([charge("a", 1200_00)], [pay("late", "2026-09-08", 800_00), pay("early", "2026-08-20", 400_00, "partial")], today);
    expect(settled.transactions[0]?.effectiveDate).toBe("2026-09-08");
    expect(settled.flows).toEqual([
      { statementId: "sep", date: "2026-08-20", amountMinor: -400_00, kind: "payment", planned: false },
      { statementId: "sep", date: "2026-09-08", amountMinor: 400_00, kind: "paidElsewhere", planned: false },
    ]);
  });

  it("keeps a partly paid statement on its due date and takes only what was paid", () => {
    const transactions = [charge("a", 12_000_00)];
    const settled = settleCardStatements(transactions, [pay("min", "2026-09-10", 4_000_00, "minimum")], today);
    expect(settled.transactions).toBe(transactions);
    expect(settled.flows).toEqual([
      { statementId: "sep", date: "2026-10-05", amountMinor: 8_000_00, kind: "owed", planned: true },
      { statementId: "sep", date: "2026-09-10", amountMinor: -4_000_00, kind: "payment", planned: false },
      { statementId: "sep", date: "2026-10-05", amountMinor: 4_000_00, kind: "paidElsewhere", planned: true },
    ]);
    expect(settled.byStatement.get("sep")).toMatchObject({ remainingMinor: 8_000_00, state: "minimum", paidInFullOn: null });
    const partial = settleCardStatements(transactions, [pay("min", "2026-09-10", 4_000_00, "partial")], today);
    expect(partial.byStatement.get("sep")?.state).toBe("partial");
  });

  it("settles the owed part beside charges that are already in the balance", () => {
    const settled = settleCardStatements(
      [charge("a", 1000_00, { effectiveDate: "2026-09-05", status: "realized" })],
      [pay("p", "2026-09-01", 300_00, "partial")],
      today,
    );
    expect(settled.flows.every((flow) => !flow.planned)).toBe(true);
  });

  it("ignores payments dated after today and charges of people the owner only watches", () => {
    const watched = charge("watched", 900_00, { personIsSelf: false });
    const settled = settleCardStatements([charge("a", 100_00), watched], [pay("future", "2026-09-21", 100_00)], today);
    expect(settled.byStatement.size).toBe(0);
    const counted = settleCardStatements([charge("a", 100_00), watched], [pay("now", "2026-09-20", 100_00)], today);
    expect(counted.byStatement.get("sep")?.chargesMinor).toBe(100_00);
    expect(counted.transactions.find((row) => row.id === "watched")).toBe(watched);
  });

  it("covers a statement holding none of the owner's charges with any payment", () => {
    const settled = settleCardStatements([charge("watched", 900_00, { personIsSelf: false })], [pay("p", "2026-09-10", 100_00)], today);
    expect(settled.byStatement.get("sep")).toEqual({
      statementId: "sep", chargesMinor: 0, paidMinor: 100_00, remainingMinor: 0, state: "full", paidInFullOn: "2026-09-10",
    });
    expect(settled.flows).toEqual([]);
  });

  it("orders payments made on one day by id, whichever was recorded first", () => {
    const flows = (payments: ReturnType<typeof pay>[]) => settleCardStatements([charge("a", 1_000_00)], payments, today).flows;
    const larger = pay("b", "2026-09-10", 600_00, "partial");
    const smaller = pay("a", "2026-09-10", 400_00, "partial");
    const expected = [
      { statementId: "sep", date: "2026-09-10", amountMinor: -400_00, kind: "payment", planned: false },
      { statementId: "sep", date: "2026-09-10", amountMinor: 400_00, kind: "paidElsewhere", planned: false },
    ];
    expect(flows([larger, smaller])).toEqual(expected);
    expect(flows([smaller, larger])).toEqual(expected);
  });

  it("keeps what is owed planned while any charge beside it is not in the balance yet", () => {
    const owedIsPlanned = (...charges: ReturnType<typeof charge>[]) =>
      settleCardStatements(charges, [pay("p", "2026-09-10", 100_00, "partial")], today).flows.find((flow) => flow.kind === "owed")?.planned;
    // Past its day but never confirmed.
    expect(owedIsPlanned(charge("a", 500_00, { effectiveDate: "2026-09-15" }), charge("b", 500_00, { effectiveDate: "2026-09-15", status: "realized" }))).toBe(true);
    // Marked realized by a device whose day had already turned.
    expect(owedIsPlanned(charge("a", 500_00, { effectiveDate: "2026-09-21", status: "realized" }))).toBe(true);
    expect(owedIsPlanned(charge("a", 500_00, { effectiveDate: "2026-09-20", status: "realized" }))).toBe(false);
  });
});

describe("card-cycle day bounds and statement boundaries", () => {
  it("accepts exact day bounds and rejects fractional or missing fields", () => {
    expect(isValidCardCycle({ statementDay: 1, dueDay: 31 })).toBe(true);
    expect(isValidCardCycle({ statementDay: 31, dueDay: 1 })).toBe(true);
    expect(isValidCardCycle({ statementDay: 1.5, dueDay: 2 })).toBe(false);
    expect(isValidCardCycle({ statementDay: 2, dueDay: undefined })).toBe(false);
    expect(isValidCardCycle({ statementDay: 2, dueDay: 32 })).toBe(false);
    expect(() => statementPeriod("2026-07", { statementDay: 0, dueDay: 1 })).toThrow("Invalid credit-card cycle");
  });

  it("pins equal-day, later-day, purchase, and due-date boundaries", () => {
    expect(statementPeriod("2026-07", { statementDay: 15, dueDay: 15 })).toEqual({
      periodMonth: "2026-07", statementDate: "2026-07-15", dueDate: "2026-08-15",
    });
    expect(statementPeriod("2026-07", { statementDay: 15, dueDay: 16 }).dueDate).toBe("2026-07-16");
    expect(statementForPurchase("2026-07-15", { statementDay: 15, dueDay: 16 }).periodMonth).toBe("2026-07");
    expect(statementForPurchase("2026-07-16", { statementDay: 15, dueDay: 16 }).periodMonth).toBe("2026-08");
    expect(statementForDueDate("2026-07-16", { statementDay: 15, dueDay: 16 }).periodMonth).toBe("2026-07");
    expect(statementForDueDate("2026-07-15", { statementDay: 15, dueDay: 15 }).periodMonth).toBe("2026-06");
    expect(isCardCycleDayConflict(null, null)).toBe(false);
    expect(isCardCycleDayConflict(null, 1)).toBe(false);
    expect(isCardCycleDayConflict(1, null)).toBe(false);
    expect(isCardCycleDayConflict(1, 1)).toBe(true);
  });
});

describe("one statement's charges, payments and what is owed", () => {
  const charges = [
    tx({ type: "expense", amountTryMinor: 1_000, effectiveDate: "2026-08-05" }),
    tx({ type: "expense", amountTryMinor: -300, effectiveDate: "2026-08-05" }),
  ];

  it("nets refunds out of the charges and owes the rest", () => {
    expect(statementTotals(charges, [])).toEqual({ chargesMinor: 700, paidMinor: 0, remainingMinor: 700 });
    expect(statementTotals(charges, [{ amountMinor: 200 }, { amountMinor: 1 }])).toEqual({ chargesMinor: 700, paidMinor: 201, remainingMinor: 499 });
  });

  it("owes nothing once paid exactly, and never less than nothing", () => {
    expect(statementTotals(charges, [{ amountMinor: 699 }]).remainingMinor).toBe(1);
    expect(statementTotals(charges, [{ amountMinor: 700 }]).remainingMinor).toBe(0);
    expect(statementTotals(charges, [{ amountMinor: 701 }])).toEqual({ chargesMinor: 700, paidMinor: 701, remainingMinor: 0 });
    expect(statementTotals([], [])).toEqual({ chargesMinor: 0, paidMinor: 0, remainingMinor: 0 });
  });
});

describe("every statement's signed total", () => {
  it("sums only rows billed on the statements asked for", () => {
    const amounts = statementAmounts([
      { cardStatementId: "s1", amountTryMinor: 500 },
      { cardStatementId: "s1", amountTryMinor: -200 },
      { cardStatementId: "s2", amountTryMinor: 0 },
      { cardStatementId: "s3", amountTryMinor: 900 },
      { cardStatementId: null, amountTryMinor: 900 },
      { cardStatementId: "", amountTryMinor: 900 },
      { amountTryMinor: 900 },
    ], new Set(["s1", "s2", "", "s4"]));
    expect(amounts).toEqual(new Map([["s1", 300], ["s2", 0]]));
  });
});
