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
