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
  return cards.flatMap((card) => {
    const candidates = statements
      .filter((statement) => statement.paymentSourceId === card.id && statement.dueDate >= today)
      .map((statement) => ({
        statement,
        amountMinor: transactions
          .filter(
            (tx) =>
              tx.personIsSelf &&
              tx.paymentSourceId === card.id &&
              tx.cardStatementId === statement.id &&
              financialFlow(tx).type === "expense" &&
              tx.status === "pending",
          )
          .reduce((sum, tx) => sum + financialFlow(tx).amountTryMinor, 0),
      }))
      .filter(({ statement, amountMinor }) => {
        const distance = daysBetween(today, statement.dueDate);
        return amountMinor > 0 && distance >= 0 && distance <= horizonDays;
      })
      .sort((a, b) => a.statement.dueDate.localeCompare(b.statement.dueDate));
    const next = candidates[0];
    if (!next) return [];

    return [
      {
        cardId: card.id,
        cardName: card.name,
        amountMinor: next.amountMinor,
        dueDate: next.statement.dueDate,
      },
    ];
  });
}
