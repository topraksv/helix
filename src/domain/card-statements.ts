/**
 * Credit-card statement cycle rules (spec §3.7). A purchase belongs to the
 * statement that closes on/after the purchase date. The balance-affecting date
 * is that statement's real due date, never the purchase date or a date derived
 * from "today". Nominal days 29–31 are clamped for short months.
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
  daysBetweenISO,
} from "./dates";
import { financialFlow } from "./transactions";
import type { SettlementFlow, StatementPaymentKind, StatementPaymentLike, TxLike } from "./types";

export interface CardCycle {
  statementDay: number;
  dueDay: number;
}

export interface CardStatementPeriod {
  periodMonth: MonthKey;
  statementDate: ISODate;
  dueDate: ISODate;
}

/** Two sources name the same card, or one of them names none. */
export const sameCard = (a: string | null, b: string | null): boolean => a == null || b == null || a === b;

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
 * The month a card purchase made on `purchaseDate` bills its first instalment.
 *
 * A plan's instalments fall on the card's due day of consecutive months, so the
 * first one belongs to the statement the purchase joins — due next month when
 * the card is paid after it closes, or later still once this period has already
 * closed. Starting a plan in the current month would date an instalment on a
 * day already past, count it as paid and take it off today's balance, unlike
 * the same purchase entered as a transaction.
 */
export function firstInstallmentMonth(purchaseDate: ISODate, cycle: CardCycle): MonthKey {
  return monthKeyOf(statementForPurchase(purchaseDate, cycle).dueDate);
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
 * The nominal days between closing a statement and paying it. A pair is never
 * "backwards" (the due date resolves into the next month), only implausible:
 * `31 / 31` is no gap and `31 / 30` a whole cycle. Counted against a nominal
 * 30-day month because the stored days are nominal ("ayın sonu" is 31).
 */
export function cardCycleGraceDays(statementDay: number, dueDay: number): number {
  const NOMINAL_MONTH = 30;
  return dueDay > statementDay ? dueDay - statementDay : dueDay + NOMINAL_MONTH - statementDay;
}

/**
 * How far apart a real card's two days can sit. Deliberately loose: it refuses
 * only pairs that are plainly a mistake, the same value for both or a due date
 * just before the NEXT statement closes.
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

/**
 * Days until this card's open statement closes: whether a purchase lands on the
 * statement about to close or the next one. Zero means it closes today, the
 * last day a purchase still joins this period.
 */
export function daysUntilStatementClose(today: ISODate, cycle: CardCycle): number {
  return Math.max(0, daysBetweenISO(today, statementForPurchase(today, cycle).statementDate));
}

export interface StatementSettlement {
  statementId: string;
  /** The owner's charges on the statement, refunds netted. */
  chargesMinor: number;
  /** Payments recorded for it on or before today. */
  paidMinor: number;
  remainingMinor: number;
  state: StatementPaymentKind;
  /** The day its charges reach the balance once it is paid in full; null while any of it is owed. */
  paidInFullOn: ISODate | null;
}

export interface CardSettlement {
  /** The same rows, with a fully paid statement's charges on the day it was paid. */
  transactions: TxLike[];
  flows: SettlementFlow[];
  byStatement: Map<string, StatementSettlement>;
}

/**
 * What recorded statement payments do to the ledger.
 *
 * A statement with no payment recorded is paid in full on its due date, which
 * is how every card charge already reaches the balance. Recording one replaces
 * that for its statement:
 *
 * - Paid in full: its charges are counted on the day the last payment covered
 *   them, in that month's cells, rather than on a due date still to come. A
 *   payment made on an earlier day than that leaves the balance on its own day
 *   and is given back on the day the charges land.
 * - Paid in part: the charges keep their due date; the balance loses only what
 *   was paid, on the day it was paid, and the rest is owed. No interest and no
 *   carrying into the next statement.
 *
 * Only the owner's own charges count, as everywhere else in the balance, and a
 * payment dated after today is not a payment yet.
 */
export function settleCardStatements(
  transactions: TxLike[],
  payments: readonly StatementPaymentLike[],
  today: ISODate,
): CardSettlement {
  const paymentsByStatement = groupBy(payments, (payment) => (payment.paidOn > today ? null : payment.statementId));
  const byStatement = new Map<string, StatementSettlement>();
  if (paymentsByStatement.size === 0) return { transactions, flows: [], byStatement };

  const chargesByStatement = groupBy(transactions, (tx) =>
    tx.cardStatementId && paymentsByStatement.has(tx.cardStatementId) && tx.personIsSelf && financialFlow(tx).type === "expense"
      ? tx.cardStatementId
      : null);
  const moved = new Map<string, TxLike>();
  const flows: SettlementFlow[] = [];
  for (const [statementId, list] of paymentsByStatement) {
    const settled = settleStatement(statementId, list, chargesByStatement.get(statementId) ?? [], today);
    byStatement.set(statementId, settled.settlement);
    flows.push(...settled.flows);
    for (const tx of settled.moved) moved.set(tx.id, tx);
  }
  return {
    transactions: moved.size === 0 ? transactions : transactions.map((tx) => moved.get(tx.id) ?? tx),
    flows,
    byStatement,
  };
}

/** One statement's settlement, the balance lines it makes, and the charges it moves. */
function settleStatement(
  statementId: string,
  payments: StatementPaymentLike[],
  charges: TxLike[],
  today: ISODate,
): { settlement: StatementSettlement; flows: SettlementFlow[]; moved: TxLike[] } {
  const paid = [...payments].sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.id.localeCompare(b.id));
  const { chargesMinor, paidMinor } = statementTotals(charges, paid);
  let covered = 0;
  const completion = paid.find((payment) => (covered += payment.amountMinor) >= chargesMinor);
  const flows: SettlementFlow[] = [];
  if (completion) {
    for (const payment of paid.slice(0, paid.indexOf(completion))) {
      flows.push({ statementId, date: payment.paidOn, amountMinor: -payment.amountMinor, kind: "payment", planned: false });
      flows.push({ statementId, date: completion.paidOn, amountMinor: payment.amountMinor, kind: "paidElsewhere", planned: false });
    }
    return {
      settlement: { statementId, chargesMinor, paidMinor, remainingMinor: 0, state: "full", paidInFullOn: completion.paidOn },
      flows,
      moved: charges.map((tx) => ({ ...tx, effectiveDate: completion.paidOn, status: "realized" as const })),
    };
  }
  // Paid in part. Every charge on a statement shares its due date. A statement
  // with no charge is covered by any payment, so a partial one has at least one.
  const dueDate = charges.reduce((latest, tx) => (tx.effectiveDate > latest ? tx.effectiveDate : latest), charges[0]!.effectiveDate);
  const planned = charges.some((tx) => tx.status !== "realized" || tx.effectiveDate > today);
  flows.push({ statementId, date: dueDate, amountMinor: chargesMinor - paidMinor, kind: "owed", planned });
  for (const payment of paid) {
    flows.push({ statementId, date: payment.paidOn, amountMinor: -payment.amountMinor, kind: "payment", planned: false });
    flows.push({ statementId, date: dueDate, amountMinor: payment.amountMinor, kind: "paidElsewhere", planned });
  }
  return {
    settlement: {
      statementId,
      chargesMinor,
      paidMinor,
      remainingMinor: chargesMinor - paidMinor,
      state: paid.at(-1)!.kind === "minimum" ? "minimum" : "partial",
      paidInFullOn: null,
    },
    flows,
    moved: [],
  };
}

/**
 * A statement's charges (refunds netted), what was paid on it, and what is
 * still owed. The owed figure stops at zero: an overpayment is not credit the
 * statement carries.
 */
export function statementTotals(
  charges: readonly TxLike[],
  payments: readonly { amountMinor: number }[],
): { chargesMinor: number; paidMinor: number; remainingMinor: number } {
  const chargesMinor = charges.reduce((sum, tx) => sum + financialFlow(tx).amountTryMinor, 0);
  const paidMinor = payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
  return { chargesMinor, paidMinor, remainingMinor: Math.max(0, chargesMinor - paidMinor) };
}

/** Each of `statementIds` with the signed TRY total of every row billed on it; a statement with no row is absent. */
export function statementAmounts(
  transactions: readonly { cardStatementId?: string | null; amountTryMinor: number }[],
  statementIds: ReadonlySet<string>,
): Map<string, number> {
  const amountById = new Map<string, number>();
  for (const transaction of transactions) {
    const statementId = transaction.cardStatementId;
    if (statementId && statementIds.has(statementId)) amountById.set(statementId, (amountById.get(statementId) ?? 0) + transaction.amountTryMinor);
  }
  return amountById;
}

/** `items` grouped by `key`, leaving out the ones it gives no key. */
export function groupBy<T>(items: readonly T[], key: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = key(item);
    if (group == null) continue;
    const list = groups.get(group);
    if (list) list.push(item);
    else groups.set(group, [item]);
  }
  return groups;
}

/**
 * How far today is through the statement window that is currently filling:
 * `0` on the day one statement closes, `1` on the day the next one does. The
 * window is close-to-close because that is the span a purchase chooses between.
 * The due date is deliberately not on this scale: it falls after the close.
 *
 * Throws on a cycle it cannot read rather than returning a position: an
 * invented fraction would be drawn as confidently as a real one. The span is
 * not checked for zero: two consecutive closes are at least 28 days apart.
 */
export function cardCycleProgress(today: ISODate, cycle: CardCycle): number {
  const period = statementForPurchase(today, cycle);
  const previousClose = statementPeriod(addMonthsToKey(period.periodMonth, -1), cycle).statementDate;
  const span = daysBetweenISO(previousClose, period.statementDate);
  return Math.min(1, Math.max(0, daysBetweenISO(previousClose, today) / span));
}
