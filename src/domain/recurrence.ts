/**
 * Recurrence engine: advancing next-due dates for subscriptions and
 * recurring incomes. The nominal billing day is preserved across months and
 * clamped into short months (Jan 31 → Feb 28 → Mar 31, not Mar 28).
 */

import {
  addMonthsToKey,
  clampDayToMonth,
  dayOf,
  makeMonthKey,
  monthKeyOf,
  monthOf,
  yearOf,
  type ISODate,
  type MonthKey,
} from "./dates";
import type { SubscriptionCycle } from "./types";

export function intervalMonthsFor(cycle: SubscriptionCycle, customMonths?: number | null): number {
  if (cycle === "monthly") return 1;
  if (cycle === "yearly") return 12;
  if (!customMonths || customMonths < 1) throw new Error("custom cycle requires intervalMonths >= 1");
  return customMonths;
}

/** Due date for a nominal billing day within a given month (clamped). */
export function dueDateInMonth(month: MonthKey, billingDay: number): ISODate {
  return clampDayToMonth(yearOf(month), monthOf(month), billingDay);
}

/**
 * Advance a due date by the cycle interval. `billingDay` is the user's
 * nominal day; pass it explicitly so clamping never becomes sticky.
 */
export function advanceDueDate(current: ISODate, intervalMonths: number, billingDay: number): ISODate {
  const nextMonth = addMonthsToKey(monthKeyOf(current), intervalMonths);
  return dueDateInMonth(nextMonth, billingDay);
}

/** First due date strictly after `after`, starting from `from`. */
export function nextDueAfter(
  from: ISODate,
  after: ISODate,
  intervalMonths: number,
  billingDay: number,
): ISODate {
  let due = dueDateInMonth(monthKeyOf(from), billingDay);
  if (due < from) due = advanceDueDate(due, intervalMonths, billingDay);
  while (due <= after) {
    due = advanceDueDate(due, intervalMonths, billingDay);
  }
  return due;
}

/** All due dates of a rule that fall inside [fromInclusive, toInclusive]. */
export function dueDatesInRange(
  anchorDue: ISODate,
  intervalMonths: number,
  billingDay: number,
  fromInclusive: ISODate,
  toInclusive: ISODate,
): ISODate[] {
  const dates: ISODate[] = [];
  let due = anchorDue;
  // Rewind is not needed: callers always pass anchorDue <= range start or inside it.
  while (due <= toInclusive) {
    if (due >= fromInclusive) dates.push(due);
    due = advanceDueDate(due, intervalMonths, billingDay);
  }
  return dates;
}

/** Nominal billing day of an existing due date (callers store it separately when known). */
export function billingDayOf(date: ISODate): number {
  return dayOf(date);
}

export function currentMonthKey(today: ISODate): MonthKey {
  return makeMonthKey(yearOf(today), monthOf(today));
}
