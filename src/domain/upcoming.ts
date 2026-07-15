/** Pure rules for the dashboard's upcoming-payment list. */

import { clampDayToMonth, monthKeyOf, monthOf, yearOf, type ISODate } from "./dates";
import type { TxLike } from "./types";
import { financialFlow } from "./transactions";

export interface CardDueSource {
  id: string;
  name: string;
  dueDay: number | null;
}

export interface UpcomingCardStatement {
  cardId: string;
  cardName: string;
  amountMinor: number;
  dueDate: ISODate;
}

function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/**
 * A credit-card charge is never a standalone upcoming payment: the user pays
 * one statement per card. Month-only aggregates have no real due date. A
 * non-card loan/installment still is a standalone obligation and keeps its
 * explicitly scheduled effective date.
 */
export function standaloneUpcomingTransactions(
  transactions: TxLike[],
  creditCardIds: Set<string>,
  today: ISODate,
  horizonDays = 31,
): TxLike[] {
  return transactions.filter(
    (tx) =>
      tx.personIsSelf &&
      !tx.isAggregate &&
      (tx.paymentSourceId == null || !creditCardIds.has(tx.paymentSourceId)) &&
      tx.status === "pending" &&
      tx.effectiveDate > today &&
      daysBetween(today, tx.effectiveDate) <= horizonDays,
  );
}

/**
 * Collapse every card's earliest pending statement month into exactly one
 * payment. Cards without a real due day are omitted; no synthetic date is
 * invented from today's date.
 */
export function upcomingCardStatements(
  transactions: TxLike[],
  cards: CardDueSource[],
  today: ISODate,
  horizonDays = 45,
): UpcomingCardStatement[] {
  return cards.flatMap((card) => {
    if (card.dueDay == null) return [];
    const charges = transactions.filter(
      (tx) =>
        tx.personIsSelf &&
        tx.paymentSourceId === card.id &&
        financialFlow(tx).type === "expense" &&
        tx.status === "pending" &&
        tx.effectiveDate > today,
    );
    if (charges.length === 0) return [];

    const statementMonth = charges.reduce(
      (earliest, tx) => (monthKeyOf(tx.effectiveDate) < earliest ? monthKeyOf(tx.effectiveDate) : earliest),
      monthKeyOf(charges[0].effectiveDate),
    );
    const dueDate = clampDayToMonth(yearOf(statementMonth), monthOf(statementMonth), card.dueDay);
    const distance = daysBetween(today, dueDate);
    if (distance < 0 || distance > horizonDays) return [];
    const amountMinor = charges
      .filter((tx) => monthKeyOf(tx.effectiveDate) === statementMonth)
      .reduce((sum, tx) => sum + financialFlow(tx).amountTryMinor, 0);
    if (amountMinor <= 0) return [];

    return [
      {
        cardId: card.id,
        cardName: card.name,
        amountMinor,
        dueDate,
      },
    ];
  });
}
