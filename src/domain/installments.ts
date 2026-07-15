/**
 * Installment engine — the heart of the app (spec §3.2).
 * A plan (card installment or loan) expands into one scheduled transaction
 * per calendar month (user decision: calendar-month placement, not statement
 * cycles). Plans may start in the past ("4 of 6 already paid"): generated
 * items with effective dates on/before today are realized immediately.
 */

import {
  addMonthsToKey,
  clampDayToMonth,
  monthOf,
  yearOf,
  type ISODate,
  type MonthKey,
} from "./dates";
import { splitIntoInstallments, type Minor } from "./money";
import type { InstallmentPlanLike, TransactionStatus } from "./types";

export interface GeneratedInstallment {
  installmentNo: number; // 1-based
  month: MonthKey;
  amountMinor: Minor;
  effectiveDate: ISODate;
  status: TransactionStatus;
}

/**
 * Upper bound on a plan's installment count. Even a 30-year mortgage is 360
 * months; anything past this is a typo or corrupt input, and materializing it
 * would write thousands of rows in one transaction and freeze the UI. Callers
 * (forms) also validate, but the engine refuses out-of-range counts outright.
 */
export const MAX_INSTALLMENT_COUNT = 600;

/**
 * Pick a readable installment title consistently across the plan and ledger
 * screens. A legacy row may have lost its plan title, so its first meaningful
 * note line is the safe fallback; the full note can still be shown below.
 */
export function installmentDisplayTitle(
  planTitle: string | null | undefined,
  note: string | null | undefined,
  fallback: string,
): string {
  for (const candidate of [planTitle, note]) {
    const firstMeaningfulPart = candidate
      ?.split(/\r?\n|[;|]/)
      .map((part) => part.trim().replace(/\s+/g, " "))
      .find(Boolean);
    if (firstMeaningfulPart) return firstMeaningfulPart;
  }
  return fallback;
}

/** True when a count is a sane, materializable installment count. */
export function isValidInstallmentCount(count: number): boolean {
  return Number.isInteger(count) && count >= 1 && count <= MAX_INSTALLMENT_COUNT;
}

/** Monthly amounts for a plan: split total (card) or fixed monthly (loan). */
export function planAmounts(plan: Pick<InstallmentPlanLike, "totalAmountMinor" | "monthlyAmountMinor" | "installmentCount">): Minor[] {
  const { totalAmountMinor, monthlyAmountMinor, installmentCount } = plan;
  if (!isValidInstallmentCount(installmentCount)) {
    throw new Error(`Installment count out of range (1–${MAX_INSTALLMENT_COUNT}): ${installmentCount}`);
  }
  if (totalAmountMinor != null) return splitIntoInstallments(totalAmountMinor, installmentCount);
  if (monthlyAmountMinor != null) return Array.from({ length: installmentCount }, () => monthlyAmountMinor);
  throw new Error("Plan needs either totalAmountMinor or monthlyAmountMinor");
}

/**
 * Expand a plan into its monthly schedule. `today` decides which past items
 * are auto-realized (spec §2.7: only effective_date <= today hits balance).
 */
export function generateSchedule(plan: InstallmentPlanLike, today: ISODate): GeneratedInstallment[] {
  const amounts = planAmounts(plan);
  const dueDay = plan.dueDay ?? 1;
  return amounts.map((amountMinor, index) => {
    const month = addMonthsToKey(plan.startMonth, index);
    const effectiveDate = clampDayToMonth(yearOf(month), monthOf(month), dueDay);
    return {
      installmentNo: index + 1,
      month,
      amountMinor,
      effectiveDate,
      status: effectiveDate <= today ? "realized" : "pending",
    };
  });
}

/**
 * Derive the start month for "n of m already paid" entry so that EXACTLY
 * `paidCount` installments auto-realize (spec §2.7: realized ⇔ effectiveDate ≤
 * today). The next unpaid installment (number paidCount+1) is placed in the
 * first month whose due date is still in the future: the current month when its
 * due day hasn't passed, otherwise next month. Without this, a plan with a due
 * day already elapsed this month silently realized one extra installment (a
 * "2 of 6" entry showed as 3 of 6 and under-counted the remaining balance).
 */
export function deriveStartMonth(
  paidCount: number,
  referenceMonth: MonthKey,
  dueDay: number | null = 1,
  today?: ISODate,
): MonthKey {
  if (paidCount < 0) throw new Error("paidCount cannot be negative");
  const day = dueDay ?? 1;
  const refDue = clampDayToMonth(yearOf(referenceMonth), monthOf(referenceMonth), day);
  // If this month's installment would already be past due (auto-realized), the
  // next unpaid one belongs to next month; otherwise it is this month's.
  const nextUnpaidMonth = today != null && refDue <= today ? addMonthsToKey(referenceMonth, 1) : referenceMonth;
  return addMonthsToKey(nextUnpaidMonth, -paidCount);
}

export interface PlanProgress {
  paid: number;
  total: number;
  remaining: number;
  remainingMinor: Minor;
  monthlyMinor: Minor; // amount of the next unpaid installment (0 when done)
  endMonth: MonthKey;
}

/** Progress summary "(paid/total), kalan X ay × ₺Y" from a plan's generated items. */
export function planProgress(items: GeneratedInstallment[]): PlanProgress {
  if (items.length === 0) throw new Error("Plan has no installments");
  const paid = items.filter((i) => i.status === "realized").length;
  const unpaid = items.filter((i) => i.status === "pending");
  return {
    paid,
    total: items.length,
    remaining: unpaid.length,
    remainingMinor: unpaid.reduce((sum, i) => sum + i.amountMinor, 0),
    monthlyMinor: unpaid.length > 0 ? unpaid[0].amountMinor : 0,
    endMonth: items[items.length - 1].month,
  };
}
