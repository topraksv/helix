/**
 * Installment engine — the heart of the app (spec §3.1).
 * A plan (card installment or loan) expands into one scheduled transaction
 * per calendar month (user decision: calendar-month placement, not statement
 * cycles). Plans may start in the past ("4 of 6 already paid"): generated
 * items with effective dates on/before today are realized immediately.
 */

import {
  addMonthsToKey,
  clampDayToMonth,
  dayOf,
  isMonthDay,
  monthDiff,
  monthKeyOf,
  monthOf,
  yearOf,
  type ISODate,
  type MonthKey,
} from "./dates";
import { firstInstallmentMonth, groupBy, isValidCardCycle, sameCard } from "./card-statements";
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
 * are auto-realized (spec §2.2: only effective_date <= today hits balance).
 */
export function generateSchedule(plan: InstallmentPlanLike, today: ISODate): GeneratedInstallment[] {
  const amounts = planAmounts(plan);
  // `?? 1` only covers a missing day. A corrupt one (0, NaN, 45) would make
  // `clampDayToMonth` throw mid-render, so fall back to the same default.
  const dueDay = isMonthDay(plan.dueDay ?? 1) ? (plan.dueDay ?? 1) : 1;
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
 * `paidCount` installments auto-realize (spec §2.2: realized ⇔ effectiveDate ≤
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

/**
 * What another source says about one plan: a month it bills, what it bills
 * then, the month it ends, the month it began when that source prints a
 * position, and the card.
 */
export interface PlanSighting {
  month: MonthKey;
  amountMinor: Minor;
  endMonth: MonthKey;
  /** Null when the source prints only how many payments remain. */
  startMonth: MonthKey | null;
  paymentSourceId: string | null;
}

type SightablePlan = Pick<InstallmentPlanLike, "id" | "startMonth" | "installmentCount" | "totalAmountMinor" | "monthlyAmountMinor" | "currency">
  & {
    paymentSourceId: string | null;
    /** A foreign-currency plan's instalment for the sighted month, in lira. */
    billedTryMinor?: Minor | null;
  };

/**
 * The live plan a sighting is, and what that plan bills in the sighted month.
 *
 * A plan is known by its schedule and never by its name: the owner names the
 * purchase, a statement prints the merchant, a workbook renames both. A lira
 * plan may miss by fewer kuruş than its count, the most a nearest-kuruş split
 * moves one instalment. A bank fixes a foreign purchase's lira at posting while
 * the plan restates it with the rate, so a foreign plan needs both sides to name
 * its card and may miss by a quarter. `claimed` holds plans an earlier line of
 * the same source took, so two identical purchases stay two plans.
 */
export function planForSighting<P extends SightablePlan>(
  sighting: PlanSighting,
  plans: readonly P[],
  claimed: ReadonlySet<string> = new Set(),
): { plan: P; shareMinor: Minor } | null {
  for (const plan of plans) {
    const shareMinor = claimed.has(plan.id) ? undefined : sightedShare(plan, sighting);
    const tolerance = plan.currency === "TRY" ? plan.installmentCount - 1 : Math.abs(shareMinor ?? 0) / 4;
    if (shareMinor != null && Math.abs(shareMinor - sighting.amountMinor) <= tolerance) return { plan, shareMinor };
  }
  return null;
}

/** What `plan` bills in the sighted month, when the sighting's schedule and card are the plan's. */
function sightedShare(plan: SightablePlan, sighting: PlanSighting): Minor | undefined {
  const foreign = plan.currency !== "TRY";
  if (foreign ? plan.paymentSourceId == null || plan.paymentSourceId !== sighting.paymentSourceId : !sameCard(plan.paymentSourceId, sighting.paymentSourceId)) return undefined;
  if (!isValidInstallmentCount(plan.installmentCount) || (plan.totalAmountMinor ?? plan.monthlyAmountMinor) == null) return undefined;
  if ((sighting.startMonth ?? plan.startMonth) !== plan.startMonth) return undefined;
  if (addMonthsToKey(plan.startMonth, plan.installmentCount - 1) !== sighting.endMonth) return undefined;
  const position = monthDiff(plan.startMonth, sighting.month);
  if (foreign) return position >= 0 && position < plan.installmentCount ? plan.billedTryMinor ?? undefined : undefined;
  return planAmounts(plan)[position];
}

interface PlanDraftInput {
  kind: "card_installment" | "loan";
  title: string;
  amountMinor: Minor | null;
  countText: string;
  /** What the owner typed for "already paid", or null while untouched. */
  paidText: string | null;
  /** How many the plan's own rows say were paid; 0 for a new plan. */
  storedPaid: number;
  startChoice: MonthKey | null;
  /** Null for a new plan. */
  existingStartMonth: MonthKey | null;
  card: { type: string; statementDay: number | null; dueDay: number | null } | null;
  dueDayText: string;
  today: ISODate;
}

/** A plan off a card (a loan, or instalments paid by hand) has its own payment day, falling back to its account's; a card plan takes the card's. */
export function ownsDueDay(kind: PlanDraftInput["kind"], card: PlanDraftInput["card"]): boolean {
  return kind === "loan" || (card != null && card.type !== "credit_card");
}

function draftDueDay(input: PlanDraftInput) {
  const typed = ownsDueDay(input.kind, input.card) && input.dueDayText.trim() !== "" ? Number(input.dueDayText) : null;
  // Paid by hand with no day anywhere: the purchase day, as the transaction form takes it; a loan keeps the first.
  const handDay = input.kind === "card_installment" && ownsDueDay(input.kind, input.card) ? dayOf(input.today) : null;
  return { dueDay: typed ?? input.card?.dueDay ?? handDay, dueDayValid: typed == null || isMonthDay(typed) };
}

/**
 * An instalment purchase names where it is paid from; on a card it needs both
 * of the card's days, and until the owner picks a month it starts on the
 * statement a purchase made today joins.
 */
/** Nothing paid by hand means no instalment is due yet: the first is the next due day after today. */
function handPaidStart(input: PlanDraftInput, due: { dueDay: number | null; dueDayValid: boolean }): MonthKey | null {
  const byHand = input.kind === "card_installment" && input.card?.type !== "credit_card";
  return byHand && due.dueDayValid ? deriveStartMonth(0, monthKeyOf(input.today), due.dueDay, input.today) : null;
}

function draftStart(input: PlanDraftInput, due: { dueDay: number | null; dueDayValid: boolean }) {
  const { card, kind, today } = input;
  const cycle = { statementDay: card?.statementDay ?? null, dueDay: card?.dueDay ?? null };
  const onCard = kind === "card_installment" && card?.type === "credit_card";
  const handStart = handPaidStart(input, due);
  return {
    sourceChosen: kind !== "card_installment" || card != null,
    cardSourceValid: !onCard || isValidCardCycle(cycle),
    startMonth: input.startChoice ?? handStart ?? (onCard && isValidCardCycle(cycle) ? firstInstallmentMonth(today, cycle) : monthKeyOf(today)),
  };
}

/** What was already paid, and whether the owner said so: on an edit only a corrected count moves the schedule. */
function draftPaid(input: PlanDraftInput, count: number) {
  const paid = Number(input.paidText ?? String(input.storedPaid));
  const isEdit = input.existingStartMonth != null;
  return {
    paid,
    paidChanged: isEdit ? paid !== input.storedPaid : paid > 0,
    paidValid: Number.isInteger(paid) && paid >= 0 && paid <= count,
  };
}

/**
 * What the plan form can save, and where the plan it saves starts. Starting a
 * card plan in the current month dated its first instalment on a due day already
 * past, which counted it as paid; "already paid N" places the start instead.
 */
export function planDraft(input: PlanDraftInput) {
  const count = Number(input.countText);
  const { dueDay, dueDayValid } = draftDueDay(input);
  const { sourceChosen, cardSourceValid, startMonth } = draftStart(input, { dueDay, dueDayValid });
  const { paid, paidChanged, paidValid } = draftPaid(input, count);
  // Derive only from input this function has already judged sound. `paid` and
  // `dueDay` are read for validity two lines above and again in `valid` below;
  // deriving between the two let exactly the values being refused reach
  // `deriveStartMonth`, which fails closed on them by design. The month the
  // form shows for a draft it will not save is the one it started from.
  const derivable = paidChanged && paidValid && dueDayValid;
  const resolvedStart = derivable ? deriveStartMonth(paid, monthKeyOf(input.today), dueDay, input.today) : startMonth;
  const described = input.title.trim() !== "" && (input.amountMinor ?? 0) > 0;
  return {
    count,
    paid,
    startMonth,
    resolvedStart,
    paidChanged,
    reschedule: input.existingStartMonth != null && resolvedStart !== input.existingStartMonth,
    dueDay,
    dueDayValid,
    sourceChosen,
    cardSourceValid,
    valid: described && isValidInstallmentCount(count) && paidValid && sourceChosen && cardSourceValid && dueDayValid,
  };
}

interface PlanProgress {
  paid: number;
  total: number;
  remaining: number;
  remainingMinor: Minor;
  monthlyMinor: Minor; // amount of the next unpaid installment (0 when done)
  endMonth: MonthKey;
}

/** Progress summary "(paid/total), kalan X ay × ₺Y" from a plan's generated items. */
export function planProgress(items: GeneratedInstallment[]): PlanProgress {
  const last = items.at(-1);
  if (!last) throw new Error("Plan has no installments");
  const paid = items.filter((i) => i.status === "realized").length;
  const unpaid = items.filter((i) => i.status === "pending");
  return {
    paid,
    total: items.length,
    remaining: unpaid.length,
    remainingMinor: unpaid.reduce((sum, i) => sum + i.amountMinor, 0),
    monthlyMinor: unpaid[0]?.amountMinor ?? 0,
    endMonth: last.month,
  };
}

/**
 * A plan's purchase (its numbered instalments), what refunds gave back and
 * what is left, read through `amountOf` so a caller chooses the plan's own
 * currency or the TRY snapshot.
 */
export function planRefundTotals<R extends { installmentNo?: number | null }>(
  rows: readonly R[],
  amountOf: (row: R) => Minor,
): { purchaseMinor: Minor; refundedMinor: Minor; leftMinor: Minor } {
  const purchaseMinor = rows.filter((row) => row.installmentNo != null).reduce((sum, row) => sum + amountOf(row), 0);
  // A closed loan's payoff is the one unnumbered row that is not a refund.
  const refundedMinor = -rows.filter((row) => row.installmentNo == null && amountOf(row) < 0).reduce((sum, row) => sum + amountOf(row), 0);
  return { purchaseMinor, refundedMinor, leftMinor: purchaseMinor - refundedMinor };
}

export interface InstallmentPlanSummary<P> {
  plan: P;
  title: string;
  purchaseMinor: Minor;
  refundedMinor: Minor;
  /** The purchase less the refunds already recorded — the most a refund may be.
   *  Every figure here is in the plan's own currency, which is what a refund of
   *  a foreign purchase is entered in. */
  leftMinor: Minor;
  paid: number;
  pending: number;
}

/**
 * Every plan with what it has billed, refunded and still owes. One pass over
 * the ledger rather than one per plan: an imported workbook brings hundreds of
 * plans and thousands of rows.
 */
export function summarizeInstallmentPlans<
  P extends { id: string; title: string | null },
  R extends { installmentPlanId?: string | null; installmentNo?: number | null; amountMinor: Minor; status: TransactionStatus; note?: string | null },
>(plans: readonly P[], transactions: readonly R[], fallbackTitle: string): InstallmentPlanSummary<P>[] {
  const rowsByPlan = groupBy(transactions, (row) => row.installmentPlanId || null);
  return plans.map((plan) => {
    const rows = rowsByPlan.get(plan.id) ?? [];
    const instalments = rows.filter((row) => row.installmentNo != null);
    const pending = instalments.filter((row) => row.status === "pending").length;
    return {
      plan,
      title: installmentDisplayTitle(plan.title, rows.find((row) => row.note)?.note, fallbackTitle),
      ...planRefundTotals(rows, (row) => row.amountMinor),
      paid: instalments.length - pending,
      pending,
    };
  });
}

/**
 * Every plan's rows as one month's installment view shows them, in one pass.
 * Refunds are the plan's rows without an instalment number: credits the
 * statement shows beside the instalments, netted out of what a month costs.
 * A closed loan's payoff is unnumbered too: it costs its month like an
 * instalment, and it refunds nothing.
 */
export function planRowsByMonth(
  rows: readonly {
    installmentPlanId?: string | null;
    installmentNo?: number | null;
    amountTryMinor: Minor;
    effectiveDate: ISODate;
    cardStatementId?: string | null;
    status: TransactionStatus;
  }[],
  viewMonth: MonthKey,
): {
  itemsByPlan: Map<string, GeneratedInstallment[]>;
  refundedByPlan: Map<string, Minor>;
  refundInMonth: Map<string, Minor>;
  /** The statement each card plan's instalment in the viewed month is billed on. */
  statementInMonth: Map<string, string>;
} {
  const itemsByPlan = new Map<string, GeneratedInstallment[]>();
  const refundedByPlan = new Map<string, Minor>();
  const refundInMonth = new Map<string, Minor>();
  const statementInMonth = new Map<string, string>();
  for (const t of rows) {
    if (!t.installmentPlanId) continue;
    if (t.installmentNo == null) {
      if (t.amountTryMinor < 0) refundedByPlan.set(t.installmentPlanId, (refundedByPlan.get(t.installmentPlanId) ?? 0) - t.amountTryMinor);
      if (monthKeyOf(t.effectiveDate) === viewMonth) {
        refundInMonth.set(t.installmentPlanId, (refundInMonth.get(t.installmentPlanId) ?? 0) + t.amountTryMinor);
      }
      continue;
    }
    if (t.cardStatementId && monthKeyOf(t.effectiveDate) === viewMonth) statementInMonth.set(t.installmentPlanId, t.cardStatementId);
    const list = itemsByPlan.get(t.installmentPlanId) ?? [];
    list.push({
      installmentNo: t.installmentNo,
      month: monthKeyOf(t.effectiveDate),
      amountMinor: t.amountTryMinor,
      effectiveDate: t.effectiveDate,
      status: t.status,
    });
    itemsByPlan.set(t.installmentPlanId, list);
  }
  for (const list of itemsByPlan.values()) list.sort((a, b) => a.installmentNo - b.installmentNo);
  return { itemsByPlan, refundedByPlan, refundInMonth, statementInMonth };
}
