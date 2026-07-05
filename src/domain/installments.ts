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

/** Monthly amounts for a plan: split total (card) or fixed monthly (loan). */
export function planAmounts(plan: Pick<InstallmentPlanLike, "totalAmountMinor" | "monthlyAmountMinor" | "installmentCount">): Minor[] {
  const { totalAmountMinor, monthlyAmountMinor, installmentCount } = plan;
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
 * Derive the start month for "n of m already paid" entry. Assumes the next
 * unpaid installment belongs to `referenceMonth` (the month the user is in).
 */
export function deriveStartMonth(paidCount: number, referenceMonth: MonthKey): MonthKey {
  if (paidCount < 0) throw new Error("paidCount cannot be negative");
  return addMonthsToKey(referenceMonth, -paidCount);
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
