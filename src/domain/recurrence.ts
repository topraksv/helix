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

/**
 * Hard upper bound on how many steps a recurrence walk may take before it is
 * treated as corrupt data. 6000 monthly steps = 500 years — far beyond any
 * legitimate schedule, so hitting it means a bad anchor/interval slipped past
 * validation. The loops break at this bound instead of spinning forever.
 */
const MAX_RECURRENCE_STEPS = 6000;

/** A safe, positive integer month interval, or null when the value is invalid. */
export function safeIntervalMonths(intervalMonths: number): number | null {
  return Number.isInteger(intervalMonths) && intervalMonths >= 1 ? intervalMonths : null;
}

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
  // Guard against a non-positive interval: advancing by 0 months never moves
  // the date, so the loops below would spin forever. Fall back to a single
  // month step so a corrupt interval still yields a finite, sane date.
  const step = safeIntervalMonths(intervalMonths) ?? 1;
  let due = dueDateInMonth(monthKeyOf(from), billingDay);
  if (due < from) due = advanceDueDate(due, step, billingDay);
  for (let i = 0; due <= after && i < MAX_RECURRENCE_STEPS; i++) {
    due = advanceDueDate(due, step, billingDay);
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
  // A non-positive/NaN interval can never advance the date — without this guard
  // the loop spins forever and freezes the app (a corrupt subscription row from
  // a hand-edited backup or a tampered sync could set interval_months = 0).
  // Treat it as "no schedule" rather than looping.
  if (safeIntervalMonths(intervalMonths) == null) return [];
  const dates: ISODate[] = [];
  let due = anchorDue;
  // Rewind is not needed: callers always pass anchorDue <= range start or inside it.
  for (let i = 0; due <= toInclusive && i < MAX_RECURRENCE_STEPS; i++) {
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
