import { getSqliteAsync } from "../../db/client";
import { newId } from "../../db/ids";
import { assertLiveRow, fromDbShape, nowIso, restoreRow, restoreRows, writeRows, writeRowsValidated, type RowWrite } from "../../db/mutations";
import { todayISO, type MonthKey } from "../../domain/dates";
import { PAYMENT_SOURCE_TYPES, type PaymentSourceType } from "../../domain/types";
import { isValidCardCycle, statementForDueDate, statementForPurchase, statementPeriod, type CardCycle, type CardStatementPeriod } from "../../domain/card-statements";
import { CreditCardCycleRequiredError, ReferencedRecordError } from "./errors";
import { cardStatementWrite, livePaymentSource } from "./transactions";
import { repairCardStatementLinks, runMaintenance } from "./maintenance";
import { assertInputWithinLimit } from "../../domain/input";
import { assertInvestmentWrites } from "./investment-validation";

export interface PersonReferenceUsage {
  paymentSources: number;
  installmentPlans: number;
  transactions: number;
  subscriptions: number;
  recurringIncomes: number;
  total: number;
}

export interface PaymentSourceReferenceUsage {
  installmentPlans: number;
  cardInstallmentPlans: number;
  transactions: number;
  subscriptions: number;
  total: number;
}

export interface PaymentSourceDeleteSnapshot {
  source: Record<string, unknown>;
  statements: Record<string, unknown>[];
  /** Absent on a snapshot taken before statement payments existed. */
  payments?: Record<string, unknown>[];
}

function isPaymentSourceDeleteSnapshot(
  snapshot: PaymentSourceDeleteSnapshot | Record<string, unknown>,
): snapshot is PaymentSourceDeleteSnapshot {
  return "source" in snapshot && "statements" in snapshot && Array.isArray(snapshot.statements);
}

export interface PaymentSourceInput {
  id?: string;
  name: string;
  type: PaymentSourceType;
  personId: string;
  dueDay: number | null;
  statementDay: number | null;
}

export async function createPerson(userId: string, name: string): Promise<string> {
  if (!name.trim()) throw new Error("Person name is required");
  assertInputWithinLimit(name, "text");
  const sqlite = await getSqliteAsync();
  const self = await sqlite.getFirstAsync<{ id: string }>(
    `SELECT id FROM persons WHERE user_id = ? AND is_self = 1 AND deleted_at IS NULL LIMIT 1`,
    [userId],
  );
  const id = newId();
  await writeRows(userId, [{
    table: "persons",
    row: { id, name: name.trim(), isSelf: !self, deletedAt: null },
  }]);
  return id;
}

export async function renamePerson(
  userId: string,
  person: Record<string, unknown>,
  name: string,
): Promise<void> {
  if (!name.trim()) throw new Error("Person name is required");
  assertInputWithinLimit(name, "text");
  const writes: RowWrite[] = [{ table: "persons", row: { ...person, name: name.trim() } }];
  await writeRowsValidated(userId, writes, (sqlite) => assertLiveRow(sqlite, "persons", userId, String(person.id)));
}

export function restorePerson(userId: string, snapshot: Record<string, unknown>): Promise<void> {
  return restoreRow(userId, "persons", snapshot);
}

export async function restorePaymentSource(
  userId: string,
  snapshot: PaymentSourceDeleteSnapshot | Record<string, unknown>,
): Promise<void> {
  const source = isPaymentSourceDeleteSnapshot(snapshot) ? snapshot.source : snapshot;
  const statements = isPaymentSourceDeleteSnapshot(snapshot) ? snapshot.statements : [];
  const payments = isPaymentSourceDeleteSnapshot(snapshot) ? snapshot.payments ?? [] : [];
  await restoreRows(userId, [
    { table: "payment_sources", row: { ...fromDbShape("payment_sources", source), deletedAt: null } },
    ...statements.map((statement) => ({
      table: "credit_card_statements" as const,
      row: { ...fromDbShape("credit_card_statements", statement), deletedAt: null },
    })),
    ...payments.map((payment) => ({
      table: "card_statement_payments" as const,
      row: { ...fromDbShape("card_statement_payments", payment), deletedAt: null },
    })),
  ]);
}

/** Repo-level validation protects imports/non-UI callers as well as the form. */
async function assertPaymentSourceInput(userId: string, input: PaymentSourceInput): Promise<void> {
  if (!input.name.trim() || !input.personId) throw new Error("Payment source name and owner are required");
  assertInputWithinLimit(input.name, "text");
  if (!PAYMENT_SOURCE_TYPES.includes(input.type)) throw new Error("Invalid payment source type");
  const person = await (await getSqliteAsync()).getFirstAsync<{ id: string }>(
    `SELECT id FROM persons WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [input.personId, userId],
  );
  if (!person) throw new Error("Payment source owner does not exist");
  if (input.type === "credit_card" && !isValidCardCycle(input)) throw new CreditCardCycleRequiredError();
}

function paymentSourceRow(existing: Record<string, unknown> | null, id: string, input: PaymentSourceInput): Record<string, unknown> {
  const onCard = input.type === "credit_card";
  return {
    ...(existing ? fromDbShape("payment_sources", existing) : {}),
    id,
    name: input.name.trim(),
    type: input.type,
    personId: input.personId,
    dueDay: onCard ? input.dueDay : null,
    statementDay: onCard ? input.statementDay : null,
    color: existing?.color ?? null,
    logoSource: existing?.logo_source ?? "initials",
    logoRef: existing?.logo_ref ?? null,
    isActive: existing?.is_active == null ? true : Boolean(existing.is_active),
    deletedAt: null,
  };
}

export async function upsertPaymentSource(userId: string, input: PaymentSourceInput): Promise<string> {
  await assertPaymentSourceInput(userId, input);
  const existing = input.id
    ? await (await getSqliteAsync()).getFirstAsync<Record<string, unknown>>(
        `SELECT * FROM payment_sources WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        [input.id, userId],
      )
    : null;
  const id = input.id ?? newId();
  const writes: RowWrite[] = [{ table: "payment_sources", row: paymentSourceRow(existing, id, input) }];
  const cycleChanged = existing?.type === "credit_card" && (existing.statement_day !== input.statementDay || existing.due_day !== input.dueDay);
  if (input.type === "credit_card" && isValidCardCycle(input) && cycleChanged) writes.push(...await cardOnNewCycle(userId, id, input));
  await writeRowsValidated(
    userId,
    writes,
    (db) => input.id ? assertLiveRow(db, "payment_sources", userId, input.id) : Promise.resolve(),
  );
  if (input.type === "credit_card") await repairCardStatementLinks(userId, todayISO());
  return id;
}

export async function personReferenceUsage(userId: string, personId: string): Promise<PersonReferenceUsage> {
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<Omit<PersonReferenceUsage, "total">>(
    `SELECT
       (SELECT COUNT(*) FROM payment_sources WHERE user_id = ? AND person_id = ? AND deleted_at IS NULL) AS paymentSources,
       (SELECT COUNT(*) FROM installment_plans WHERE user_id = ? AND person_id = ? AND deleted_at IS NULL) AS installmentPlans,
       (SELECT COUNT(*) FROM transactions WHERE user_id = ? AND person_id = ? AND deleted_at IS NULL) AS transactions,
       (SELECT COUNT(*) FROM subscriptions WHERE user_id = ? AND person_id = ? AND deleted_at IS NULL) AS subscriptions,
       (SELECT COUNT(*) FROM recurring_incomes WHERE user_id = ? AND person_id = ? AND deleted_at IS NULL) AS recurringIncomes`,
    [userId, personId, userId, personId, userId, personId, userId, personId, userId, personId],
  );
  const counts = row ?? { paymentSources: 0, installmentPlans: 0, transactions: 0, subscriptions: 0, recurringIncomes: 0 };
  return { ...counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
}

export async function paymentSourceReferenceUsage(userId: string, sourceId: string): Promise<PaymentSourceReferenceUsage> {
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<Omit<PaymentSourceReferenceUsage, "total">>(
    `SELECT
       (SELECT COUNT(*) FROM installment_plans WHERE user_id = ? AND payment_source_id = ? AND deleted_at IS NULL) AS installmentPlans,
       (SELECT COUNT(*) FROM installment_plans WHERE user_id = ? AND payment_source_id = ? AND kind = 'card_installment' AND deleted_at IS NULL) AS cardInstallmentPlans,
       (SELECT COUNT(*) FROM transactions WHERE user_id = ? AND payment_source_id = ? AND deleted_at IS NULL) AS transactions,
       (SELECT COUNT(*) FROM subscriptions WHERE user_id = ? AND payment_source_id = ? AND deleted_at IS NULL) AS subscriptions`,
    [userId, sourceId, userId, sourceId, userId, sourceId, userId, sourceId],
  );
  const counts = row ?? { installmentPlans: 0, cardInstallmentPlans: 0, transactions: 0, subscriptions: 0 };
  return {
    ...counts,
    total: counts.installmentPlans + counts.transactions + counts.subscriptions,
  };
}

async function referenceUpdateRows(
  userId: string,
  table: "payment_sources" | "installment_plans" | "transactions" | "subscriptions" | "recurring_incomes",
  column: "person_id" | "payment_source_id",
  currentId: string,
  field: "personId" | "paymentSourceId",
  replacementId: string | null,
): Promise<RowWrite[]> {
  const sqlite = await getSqliteAsync();
  const rows = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE user_id = ? AND ${column} = ? AND deleted_at IS NULL`,
    [userId, currentId],
  );
  return rows.map((row) => ({ table, row: { ...fromDbShape(table, row), [field]: replacementId } }));
}

export async function deleteUnreferencedPerson(userId: string, personId: string): Promise<Record<string, unknown> | null> {
  const usage = await personReferenceUsage(userId, personId);
  if (usage.total > 0) throw new ReferencedRecordError();
  const sqlite = await getSqliteAsync();
  const person = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM persons WHERE id = ? AND user_id = ? AND is_self = 0 AND deleted_at IS NULL`,
    [personId, userId],
  );
  if (!person) return null;
  await writeRows(userId, [{ table: "persons", row: { ...fromDbShape("persons", person), deletedAt: nowIso() } }]);
  return person;
}

export async function reassignAndDeletePerson(userId: string, personId: string, replacementId: string): Promise<void> {
  if (personId === replacementId) throw new Error("Replacement person must differ");
  const sqlite = await getSqliteAsync();
  const [person, replacement] = await Promise.all([
    sqlite.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM persons WHERE id = ? AND user_id = ? AND is_self = 0 AND deleted_at IS NULL`,
      [personId, userId],
    ),
    sqlite.getFirstAsync<{ id: string }>(
      `SELECT id FROM persons WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [replacementId, userId],
    ),
  ]);
  if (!person || !replacement) throw new Error("Person not found");
  const writes = (
    await Promise.all([
      referenceUpdateRows(userId, "payment_sources", "person_id", personId, "personId", replacementId),
      referenceUpdateRows(userId, "installment_plans", "person_id", personId, "personId", replacementId),
      referenceUpdateRows(userId, "transactions", "person_id", personId, "personId", replacementId),
      referenceUpdateRows(userId, "subscriptions", "person_id", personId, "personId", replacementId),
      referenceUpdateRows(userId, "recurring_incomes", "person_id", personId, "personId", replacementId),
    ])
  ).flat();
  writes.push({ table: "persons", row: { ...fromDbShape("persons", person), deletedAt: nowIso() } });
  await writeRowsValidated(
    userId,
    writes,
    (db) => assertInvestmentWrites(db, userId, writes).then(() => undefined),
  );
  // Expected rows are derived from person ownership. Maintenance immediately
  // creates/cleans them under the replacement's self/watch-only classification.
  await runMaintenance(userId);
}

export async function deleteUnreferencedPaymentSource(
  userId: string,
  sourceId: string,
): Promise<PaymentSourceDeleteSnapshot | null> {
  const usage = await paymentSourceReferenceUsage(userId, sourceId);
  if (usage.total > 0) throw new ReferencedRecordError();
  const sqlite = await getSqliteAsync();
  const source = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM payment_sources WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [sourceId, userId],
  );
  if (!source) return null;
  const statements = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM credit_card_statements
     WHERE user_id = ? AND payment_source_id = ? AND deleted_at IS NULL`,
    [userId, sourceId],
  );
  const payments = await statementPaymentsOf(userId, statements.map((statement) => String(statement.id)));
  const deletedAt = nowIso();
  await writeRows(userId, [
    { table: "payment_sources", row: { ...fromDbShape("payment_sources", source), deletedAt } },
    ...statements.map((statement) => ({
      table: "credit_card_statements" as const,
      row: { ...fromDbShape("credit_card_statements", statement), deletedAt },
    })),
    // A payment is a row of its statement's, so it goes with it and comes back
    // with it on undo rather than pointing at a statement nobody can see.
    ...payments.map((payment) => ({
      table: "card_statement_payments" as const,
      row: { ...fromDbShape("card_statement_payments", payment), deletedAt },
    })),
  ]);
  return { source, statements, payments };
}

/** The live payments recorded against any of `statementIds`. */
async function statementPaymentsOf(userId: string, statementIds: readonly string[]): Promise<Record<string, unknown>[]> {
  const sqlite = await getSqliteAsync();
  return sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM card_statement_payments
     WHERE user_id = ? AND deleted_at IS NULL AND statement_id IN (${statementIds.map(() => "?").join(", ")})`,
    [userId, ...statementIds],
  );
}

/** The statement `period` is on `cardId`, written once however many rows of the batch join it. */
async function statementOnce(userId: string, cardId: string, period: CardStatementPeriod, statementWrites: Map<string, RowWrite>): Promise<RowWrite> {
  const write = statementWrites.get(period.periodMonth) ?? await cardStatementWrite(userId, cardId, period);
  statementWrites.set(period.periodMonth, write);
  return write;
}

/**
 * A card's pending charge placed on `cycle`: by its purchase day, else by the
 * statement month it was entered for, else by its due date. Null for what is
 * not pending card spending — settled charges are accounting history.
 */
async function pendingChargeOnCycle(
  userId: string,
  cardId: string,
  cycle: CardCycle,
  transaction: Record<string, unknown>,
  periodByStatement: ReadonlyMap<string, MonthKey>,
  statementWrites: Map<string, RowWrite>,
): Promise<RowWrite | null> {
  const oldPeriod = periodByStatement.get(String(transaction.card_statement_id));
  // A month-only charge moves with its statement month; a legacy month total has none.
  const monthOnly = Boolean(transaction.is_aggregate);
  if (transaction.type !== "expense" || transaction.status !== "pending" || (monthOnly && oldPeriod == null)) return null;
  const period = monthOnly || (!transaction.purchase_date && oldPeriod)
    ? statementPeriod(oldPeriod!, cycle)
    : transaction.purchase_date
      ? statementForPurchase(String(transaction.purchase_date), cycle)
      : statementForDueDate(String(transaction.effective_date), cycle);
  const statementWrite = await statementOnce(userId, cardId, period, statementWrites);
  return {
    table: "transactions",
    row: {
      ...fromDbShape("transactions", transaction),
      paymentSourceId: cardId,
      purchaseDate: monthOnly ? period.statementDate : transaction.purchase_date ?? null,
      effectiveDate: period.dueDate,
      status: period.dueDate <= todayISO() ? "realized" : "pending",
      cardStatementId: statementWrite.row.id,
    },
  };
}

/** A card whose statement and due days changed: its pending charges and card plans follow the new cycle. */
async function cardOnNewCycle(userId: string, cardId: string, cycle: CardCycle): Promise<RowWrite[]> {
  const sqlite = await getSqliteAsync();
  const [transactions, statements, plans] = await Promise.all([
    sqlite.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM transactions WHERE user_id = ? AND payment_source_id = ? AND status = 'pending' AND deleted_at IS NULL`,
      [userId, cardId],
    ),
    sqlite.getAllAsync<{ id: string; period_month: MonthKey }>(
      `SELECT id, period_month FROM credit_card_statements WHERE user_id = ? AND payment_source_id = ? AND deleted_at IS NULL`,
      [userId, cardId],
    ),
    sqlite.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM installment_plans WHERE user_id = ? AND payment_source_id = ? AND kind = 'card_installment' AND deleted_at IS NULL`,
      [userId, cardId],
    ),
  ]);
  const periodByStatement = new Map(statements.map((statement) => [statement.id, statement.period_month]));
  const statementWrites = new Map<string, RowWrite>();
  const moved: RowWrite[] = [];
  for (const transaction of transactions) {
    const write = await pendingChargeOnCycle(userId, cardId, cycle, transaction, periodByStatement, statementWrites);
    if (write) moved.push(write);
  }
  return [
    ...statementWrites.values(),
    ...moved,
    ...plans.map((plan) => ({ table: "installment_plans" as const, row: { ...fromDbShape("installment_plans", plan), dueDay: cycle.dueDay } })),
  ];
}

export async function reassignAndDeletePaymentSource(
  userId: string,
  sourceId: string,
  replacementId: string | null,
): Promise<void> {
  if (sourceId === replacementId) throw new Error("Replacement source must differ");
  const sqlite = await getSqliteAsync();
  const source = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM payment_sources WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [sourceId, userId],
  );
  if (!source) return;
  const replacement = await livePaymentSource(userId, replacementId);
  if (replacementId && !replacement) throw new Error("Payment source not found");
  const cycle = { statementDay: replacement?.statement_day, dueDay: replacement?.due_day };
  const card = replacement?.type === "credit_card" && isValidCardCycle(cycle) ? { id: replacement.id, cycle } : null;
  const [plans, transactions, oldStatements] = await Promise.all([
    sqlite.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM installment_plans WHERE user_id = ? AND payment_source_id = ? AND deleted_at IS NULL`,
      [userId, sourceId],
    ),
    sqlite.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM transactions WHERE user_id = ? AND payment_source_id = ? AND deleted_at IS NULL`,
      [userId, sourceId],
    ),
    sqlite.getAllAsync<Record<string, unknown> & { id: string; period_month: MonthKey }>(
      `SELECT * FROM credit_card_statements WHERE user_id = ? AND payment_source_id = ? AND deleted_at IS NULL`,
      [userId, sourceId],
    ),
  ]);
  if (!card && plans.some((plan) => plan.kind === "card_installment")) throw new CreditCardCycleRequiredError();
  const oldPeriodById = new Map(oldStatements.map((statement) => [statement.id, statement.period_month]));
  const statementWrites = new Map<string, RowWrite>();
  const transactionWrites: RowWrite[] = [];
  for (const transaction of transactions) {
    const moved = card && await pendingChargeOnCycle(userId, card.id, card.cycle, transaction, oldPeriodById, statementWrites);
    // What does not move is history: it changes source, never date.
    transactionWrites.push(moved || {
      table: "transactions",
      row: { ...fromDbShape("transactions", transaction), paymentSourceId: replacementId, purchaseDate: null, cardStatementId: null },
    });
  }
  // A payment against one of this card's statements follows that statement's
  // month onto the replacement card. A replacement that cannot hold a statement
  // cannot hold a payment against one either, so it goes with its card.
  const paymentWrites: RowWrite[] = [];
  for (const payment of await statementPaymentsOf(userId, oldStatements.map((statement) => statement.id))) {
    // Fetched by these statements' ids, so each payment's month is known.
    const oldPeriod = oldPeriodById.get(String(payment.statement_id))!;
    const statement = card ? await statementOnce(userId, card.id, statementPeriod(oldPeriod, card.cycle), statementWrites) : null;
    paymentWrites.push({
      table: "card_statement_payments",
      row: { ...fromDbShape("card_statement_payments", payment), ...(statement ? { statementId: statement.row.id } : { deletedAt: nowIso() }) },
    });
  }
  const deletedAt = nowIso();
  await writeRows(userId, [
    ...statementWrites.values(),
    ...plans.map((plan) => ({
      table: "installment_plans" as const,
      row: { ...fromDbShape("installment_plans", plan), paymentSourceId: replacementId, dueDay: card && plan.kind === "card_installment" ? card.cycle.dueDay : plan.due_day },
    })),
    ...transactionWrites,
    ...paymentWrites,
    ...await referenceUpdateRows(userId, "subscriptions", "payment_source_id", sourceId, "paymentSourceId", replacementId),
    ...oldStatements.map((statement) => ({
      table: "credit_card_statements" as const,
      row: { ...fromDbShape("credit_card_statements", statement), deletedAt },
    })),
    { table: "payment_sources", row: { ...fromDbShape("payment_sources", source), deletedAt } },
  ]);
}
