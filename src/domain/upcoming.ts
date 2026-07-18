/** Pure rules for the dashboard's upcoming-payment list. */

import type { ISODate } from "./dates";
import type { CardStatementLike, ExpectedPaymentLike, TxLike } from "./types";
import { financialFlow, projectedTransactionFlow } from "./transactions";

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

interface ExpectedTimelineSource {
  id: string;
  name: string;
  sourceType: "subscription" | "recurring_income";
  categoryName: string | null;
}

interface TimelineCategory {
  id: string;
  name: string;
}

export interface UpcomingTimelineItem {
  key: string;
  kind: "expected" | "transaction" | "card_statement";
  sourceType: "subscription" | "recurring_income" | "scheduled_transaction" | "card_statement";
  refId: string;
  expectedId?: string;
  direction: "in" | "out";
  name: string | null;
  categoryName: string | null;
  amountMinor: number;
  currency: string;
  date: ISODate;
  status: "late" | "upcoming";
}

/** One ordered calendar model for rules, scheduled entries and card statements. */
export function buildUpcomingTimeline(input: {
  expected: ExpectedPaymentLike[];
  transactions: TxLike[];
  expectedSources: ExpectedTimelineSource[];
  categories: TimelineCategory[];
  cards: CardDueSource[];
  statements: CardStatementLike[];
  today: ISODate;
  horizonDays?: number;
}): UpcomingTimelineItem[] {
  const horizonDays = input.horizonDays ?? 120;
  const sourceById = new Map(input.expectedSources.map((source) => [source.id, source]));
  const categoryById = new Map(input.categories.map((category) => [category.id, category.name]));
  const expectedItems: UpcomingTimelineItem[] = input.expected.flatMap((row) => {
    if (row.status !== "pending" && row.status !== "late") return [];
    const late = row.status === "late" || row.dueDate < input.today;
    if (!late && daysBetween(input.today, row.dueDate) > horizonDays) return [];
    const source = sourceById.get(row.refId);
    const sourceType = source?.sourceType ?? (row.kind === "recurring_income" ? "recurring_income" : "subscription");
    return [{
      key: `expected:${row.id}`,
      kind: "expected" as const,
      sourceType,
      refId: row.refId,
      expectedId: row.id,
      direction: row.direction,
      name: source?.name ?? null,
      categoryName: source?.categoryName ?? null,
      amountMinor: row.amountMinor,
      currency: row.currency,
      date: row.dueDate,
      status: late ? "late" as const : "upcoming" as const,
    }];
  });

  const transactionItems: UpcomingTimelineItem[] = standaloneUpcomingTransactions(
    input.transactions,
    new Set(input.cards.map((card) => card.id)),
    input.today,
    horizonDays,
  ).map((transaction) => {
    const flow = projectedTransactionFlow(transaction);
    return {
      key: `transaction:${transaction.id}`,
      kind: "transaction" as const,
      sourceType: "scheduled_transaction" as const,
      refId: transaction.id,
      direction: flow.direction,
      name: transaction.categoryId ? categoryById.get(transaction.categoryId) ?? null : null,
      categoryName: transaction.categoryId ? categoryById.get(transaction.categoryId) ?? null : null,
      amountMinor: flow.amountTryMinor,
      currency: "TRY",
      date: transaction.effectiveDate,
      status: "upcoming" as const,
    };
  });

  const cardItems: UpcomingTimelineItem[] = upcomingCardStatements(
    input.transactions,
    input.cards,
    input.statements,
    input.today,
    horizonDays,
  ).map((statement) => ({
    key: `card:${statement.cardId}`,
    kind: "card_statement" as const,
    sourceType: "card_statement" as const,
    refId: statement.cardId,
    direction: "out" as const,
    name: statement.cardName,
    categoryName: null,
    amountMinor: statement.amountMinor,
    currency: "TRY",
    date: statement.dueDate,
    status: "upcoming" as const,
  }));

  return [...expectedItems, ...transactionItems, ...cardItems]
    .sort((left, right) => left.date.localeCompare(right.date) || left.key.localeCompare(right.key));
}
