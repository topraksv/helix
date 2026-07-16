/** Pure rules for the dashboard's upcoming-payment list. */

import type { ISODate } from "./dates";
import type { CardStatementLike, TxLike } from "./types";
import { financialFlow } from "./transactions";

export interface CardDueSource {
  id: string;
  name: string;
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
 * Collapse every card's earliest persisted, pending statement into exactly one
 * payment. Unlinked legacy charges are omitted: no synthetic date is invented
 * from today's date or a nominal card day.
 */
export function upcomingCardStatements(
  transactions: TxLike[],
  cards: CardDueSource[],
  statements: CardStatementLike[],
  today: ISODate,
  horizonDays = 45,
): UpcomingCardStatement[] {
  const amountByStatementAndCard = new Map<string, number>();
  for (const transaction of transactions) {
    if (
      !transaction.personIsSelf ||
      transaction.status !== "pending" ||
      !transaction.cardStatementId ||
      !transaction.paymentSourceId
    ) continue;
    const flow = financialFlow(transaction);
    if (flow.type !== "expense") continue;
    const key = `${transaction.cardStatementId}\u0000${transaction.paymentSourceId}`;
    amountByStatementAndCard.set(key, (amountByStatementAndCard.get(key) ?? 0) + flow.amountTryMinor);
  }

  const cardNameById = new Map(cards.map((card) => [card.id, card.name]));
  const nextByCard = new Map<string, UpcomingCardStatement>();
  for (const statement of statements) {
    const cardName = cardNameById.get(statement.paymentSourceId);
    if (cardName == null) continue;
    const distance = daysBetween(today, statement.dueDate);
    if (distance < 0 || distance > horizonDays) continue;
    const amountMinor = amountByStatementAndCard.get(`${statement.id}\u0000${statement.paymentSourceId}`) ?? 0;
    if (amountMinor <= 0) continue;
    const current = nextByCard.get(statement.paymentSourceId);
    if (current && current.dueDate <= statement.dueDate) continue;
    nextByCard.set(statement.paymentSourceId, {
      cardId: statement.paymentSourceId,
      cardName,
      amountMinor,
      dueDate: statement.dueDate,
    });
  }

  return cards.flatMap((card) => {
    const next = nextByCard.get(card.id);
    return next ? [next] : [];
  });
}
