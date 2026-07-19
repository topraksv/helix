/**
 * Date primitives. All dates are local-date ISO strings (`YYYY-MM-DD`),
 * month keys are `YYYY-MM`. No Date-with-timezone leaks into domain logic.
 */

export type ISODate = string; // YYYY-MM-DD
export type MonthKey = string; // YYYY-MM

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MONTH_END_DAY = 31;

/**
 * Whether a value is a well-formed `YYYY-MM` key with a real month number.
 *
 * Route params are the reason this is exported: a dynamic segment carries
 * whatever the URL says, and `lastDayOf` THROWS on a bad month. A screen that
 * derives its query range from an unchecked param therefore crashes during
 * render on a deep link like `/cash-flow/garbage`, before any handler runs.
 */
export function isMonthKey(value: unknown): value is MonthKey {
  return typeof value === "string" && MONTH_KEY_RE.test(value);
}

export function isMonthDay(value: string | number): boolean {
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= MONTH_END_DAY;
}

export function assertISODate(value: string): ISODate {
  if (!ISO_DATE_RE.test(value)) throw new Error(`Invalid ISO date: ${value}`);
  return value;
}

export function monthKeyOf(date: ISODate): MonthKey {
  return date.slice(0, 7);
}

export function yearOf(key: MonthKey | ISODate): number {
  return Number(key.slice(0, 4));
}

export function monthOf(key: MonthKey | ISODate): number {
  return Number(key.slice(5, 7));
}

export function dayOf(date: ISODate): number {
  return Number(date.slice(8, 10));
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const days = lengths[month - 1];
  if (days == null) throw new Error(`Invalid month: ${month}`);
  return days;
}

export function makeMonthKey(year: number, month: number): MonthKey {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function makeISODate(year: number, month: number, day: number): ISODate {
  return `${makeMonthKey(year, month)}-${String(day).padStart(2, "0")}`;
}

/** Clamp a nominal day-of-month (e.g. billing day 31) into the given month. */
export function clampDayToMonth(year: number, month: number, day: number): ISODate {
  return makeISODate(year, month, Math.min(day, daysInMonth(year, month)));
}

export function addMonthsToKey(key: MonthKey, delta: number): MonthKey {
  const total = yearOf(key) * 12 + (monthOf(key) - 1) + delta;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return makeMonthKey(year, month);
}

/** Whole months from `a` to `b` (b - a). */
function monthDiff(a: MonthKey, b: MonthKey): number {
  return yearOf(b) * 12 + monthOf(b) - (yearOf(a) * 12 + monthOf(a));
}

/** Inclusive range of month keys. */
export function monthRange(start: MonthKey, end: MonthKey): MonthKey[] {
  const diff = monthDiff(start, end);
  if (diff < 0) return [];
  return Array.from({ length: diff + 1 }, (_, i) => addMonthsToKey(start, i));
}

export function firstDayOf(key: MonthKey): ISODate {
  return `${key}-01`;
}

export function lastDayOf(key: MonthKey): ISODate {
  return clampDayToMonth(yearOf(key), monthOf(key), MONTH_END_DAY);
}

export function todayISO(now: Date = new Date()): ISODate {
  return makeISODate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * Pick the day used by a transaction created from a monthly table cell.
 * The current month is anchored to today so it affects the current balance;
 * selecting another month is itself explicit historical/future intent.
 */
export function dateForMonthEntry(month: MonthKey, today: ISODate = todayISO()): ISODate {
  return monthKeyOf(today) === month ? today : `${month}-15`;
}

/**
 * A start/entry month may never sit in the future: the current calendar month
 * is the latest allowed value. Shared by the onboarding + opening-balance
 * start-month pickers and the bulk-entry month stepper so the "no future
 * month" upper bound stays consistent with the "past entry" rule. MonthKeys are
 * `YYYY-MM` strings, which compare correctly with `>=`.
 */
export function isCurrentOrFutureMonth(month: MonthKey, today: ISODate = todayISO()): boolean {
  return month >= monthKeyOf(today);
}

/**
 * Add days to a local-date ISO string, timezone-safely. Anchoring at UTC noon
 * keeps the arithmetic away from midnight, so no local↔UTC conversion can
 * shift the calendar day (the classic `toISOString().slice(0,10)` off-by-one).
 */
export function addDaysISO(date: ISODate, delta: number): ISODate {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
