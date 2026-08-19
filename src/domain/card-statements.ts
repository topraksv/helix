/**
 * Credit-card statement cycle rules. A purchase belongs to the statement that
 * closes on/after the purchase date. The balance-affecting date is that
 * statement's real due date, never the purchase date or a date derived from
 * "today". Nominal days 29–31 are clamped for short months.
 */

import {
  addMonthsToKey,
  clampDayToMonth,
  dayOf,
  monthKeyOf,
  monthOf,
  yearOf,
  type ISODate,
  type MonthKey,
} from "./dates";

export interface CardCycle {
  statementDay: number;
  dueDay: number;
}

export interface CardStatementPeriod {
  periodMonth: MonthKey;
  statementDate: ISODate;
  dueDate: ISODate;
}

export function isValidCardCycle(cycle: {
  statementDay: number | null | undefined;
  dueDay: number | null | undefined;
}): cycle is CardCycle {
  return (
    Number.isInteger(cycle.statementDay) &&
    Number.isInteger(cycle.dueDay) &&
    cycle.statementDay! >= 1 &&
    cycle.statementDay! <= 31 &&
    cycle.dueDay! >= 1 &&
    cycle.dueDay! <= 31
  );
}

export function statementPeriod(periodMonth: MonthKey, cycle: CardCycle): CardStatementPeriod {
  if (!isValidCardCycle(cycle)) throw new Error("Invalid credit-card cycle");
  const statementDate = clampDayToMonth(yearOf(periodMonth), monthOf(periodMonth), cycle.statementDay);
  const dueMonth = cycle.dueDay > cycle.statementDay ? periodMonth : addMonthsToKey(periodMonth, 1);
  return {
    periodMonth,
    statementDate,
    dueDate: clampDayToMonth(yearOf(dueMonth), monthOf(dueMonth), cycle.dueDay),
  };
}

/** Resolve the immutable statement period selected by a purchase date. */
export function statementForPurchase(purchaseDate: ISODate, cycle: CardCycle): CardStatementPeriod {
  const purchaseMonth = monthKeyOf(purchaseDate);
  const closingDate = clampDayToMonth(yearOf(purchaseMonth), monthOf(purchaseMonth), cycle.statementDay);
  const periodMonth = dayOf(purchaseDate) <= dayOf(closingDate) ? purchaseMonth : addMonthsToKey(purchaseMonth, 1);
  return statementPeriod(periodMonth, cycle);
}

/**
 * Resolve a statement from its due date. Used only for legacy/installment rows
 * whose stored effective date already is the payment date; it does not invent
 * or move that date.
 */
export function statementForDueDate(dueDate: ISODate, cycle: CardCycle): CardStatementPeriod {
  const dueMonth = monthKeyOf(dueDate);
  const periodMonth = cycle.dueDay > cycle.statementDay ? dueMonth : addMonthsToKey(dueMonth, -1);
  return statementPeriod(periodMonth, cycle);
}

/**
 * The nominal days a card gives you between closing a statement and paying it.
 *
 * `statementPeriod` already resolves the due date into the NEXT month whenever
 * the due day is not past the closing day, so a cycle is never "backwards" —
 * every pair produces some gap. What a pair can be is implausible, and the two
 * ends of that are the same defect seen from either side: `31 / 31` is no gap
 * at all, and `31 / 30` is a whole cycle's worth.
 *
 * Counted against a nominal 30-day month rather than a real one, because the
 * days are nominal too: "ayın sonu" is stored as 31 and lands on the 28th in
 * February. The answer only has to be right to within a day for the question
 * being asked, which is whether a human would recognise this as a card cycle.
 */
export function cardCycleGraceDays(statementDay: number, dueDay: number): number {
  const NOMINAL_MONTH = 30;
  return dueDay > statementDay ? dueDay - statementDay : dueDay + NOMINAL_MONTH - statementDay;
}

/**
 * How far apart a real card's two days can sit.
 *
 * Turkish law sets a floor of ten days between the statement date and the due
 * date, and the banks that issue these cards give ten to fifteen. The ceiling
 * here is deliberately looser than that: it is not trying to model the market,
 * it is refusing the pairs that are plainly a mistake — the two days set to the
 * same value, or a "due date" that lands just before the NEXT statement closes.
 */
export const CARD_CYCLE_GRACE = { min: 1, max: 20 } as const;

export function isValidCardCycleGrace(statementDay: number | null, dueDay: number | null): boolean {
  if (statementDay == null || dueDay == null) return true;
  const grace = cardCycleGraceDays(statementDay, dueDay);
  return grace >= CARD_CYCLE_GRACE.min && grace <= CARD_CYCLE_GRACE.max;
}

/**
 * A statement that closes on the day it is due is not a cycle: the period would
 * have no length, and "31" and "ayın sonu" are the same day in a 31-day month,
 * so the two have to be compared after both are resolved to a day number.
 */
export function isCardCycleDayConflict(statementDay: number | null, dueDay: number | null): boolean {
  return statementDay != null && dueDay != null && statementDay === dueDay;
}

/**
 * The month days that would pair with `otherDay` to make a usable cycle.
 *
 * Returned as the REFUSED set rather than the allowed one, because that is what
 * a picker needs: an option it can show and disable, with a reason, instead of
 * one that quietly disappears and shortens the row.
 */
export function refusedCardCycleDays(
  otherDay: number | null,
  role: "statement" | "due",
  candidates: readonly number[],
): number[] {
  if (otherDay == null) return [];
  return candidates.filter((day) => !(role === "statement"
    ? isValidCardCycleGrace(day, otherDay)
    : isValidCardCycleGrace(otherDay, day)));
}
