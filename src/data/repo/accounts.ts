import { getSqliteAsync } from "../../db/client";
import { newId } from "../../db/ids";
import { fromDbShape, nowIso, writeRows, type RowWrite } from "../../db/mutations";
import { todayISO, type MonthKey } from "../../domain/dates";
import type { PaymentSourceType } from "../../domain/types";
import { isValidCardCycle, statementForDueDate, statementForPurchase, statementPeriod } from "../../domain/card-statements";
import { CreditCardCycleRequiredError, ReferencedRecordError } from "./errors";
import { cardStatementWrite, type LivePaymentSource } from "./transactions";
import { repairCardStatementLinks, runMaintenance } from "./maintenance";
import { assertInputWithinLimit } from "../../domain/input";

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

export interface PaymentSourceInput {
  id?: string;
  name: string;
  type: PaymentSourceType;
  personId: string;
  dueDay: number | null;
  statementDay: number | null;
}

/** Repo-level validation protects imports/non-UI callers as well as the form. */
export async function upsertPaymentSource(userId: string, input: PaymentSourceInput): Promise<string> {
  if (!input.name.trim() || !input.personId) throw new Error("Payment source name and owner are required");
  assertInputWithinLimit(input.name, "text");
  const sqlite = await getSqliteAsync();
  const person = await sqlite.getFirstAsync<{ id: string }>(
    `SELECT id FROM persons WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [input.personId, userId] as never[],
  );
  if (!person) throw new Error("Payment source owner does not exist");
  if (input.type === "credit_card" && !isValidCardCycle(input)) throw new CreditCardCycleRequiredError();
  const existing = input.id
    ? await sqlite.getFirstAsync<Record<string, unknown>>(
        `SELECT * FROM payment_sources WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        [input.id, userId] as never[],
      )
    : null;
  const id = input.id ?? newId();
  await writeRows(userId, [
    {
      table: "payment_sources",
      row: {
        ...(existing ? fromDbShape("payment_sources", existing) : {}),
        id,
        name: input.name.trim(),
        type: input.type,
        personId: input.personId,
        dueDay: input.type === "credit_card" ? input.dueDay : null,
        statementDay: input.type === "credit_card" ? input.statementDay : null,
        color: existing?.color ?? null,
        logoSource: existing?.logo_source ?? "initials",
        logoRef: existing?.logo_ref ?? null,
        isActive: existing?.is_active == null ? true : Boolean(existing.is_active),
        deletedAt: null,
      },
    },
  ]);
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
    [userId, personId, userId, personId, userId, personId, userId, personId, userId, personId] as never[],
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
    [userId, sourceId, userId, sourceId, userId, sourceId, userId, sourceId] as never[],
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
    [userId, currentId] as never[],
  );
  return rows.map((row) => ({ table, row: { ...fromDbShape(table, row), [field]: replacementId } }));
}

export async function deleteUnreferencedPerson(userId: string, personId: string): Promise<Record<string, unknown> | null> {
  const usage = await personReferenceUsage(userId, personId);
  if (usage.total > 0) throw new ReferencedRecordError();
  const sqlite = await getSqliteAsync();
  const person = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM persons WHERE id = ? AND user_id = ? AND is_self = 0 AND deleted_at IS NULL`,
    [personId, userId] as never[],
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
      [personId, userId] as never[],
    ),
    sqlite.getFirstAsync<{ id: string }>(
      `SELECT id FROM persons WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [replacementId, userId] as never[],
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
  await writeRows(userId, writes);
  // Expected rows are derived from person ownership. Maintenance immediately
  // creates/cleans them under the replacement's self/watch-only classification.
  await runMaintenance(userId);
}

export async function deleteUnreferencedPaymentSource(userId: string, sourceId: string): Promise<Record<string, unknown> | null> {
  const usage = await paymentSourceReferenceUsage(userId, sourceId);
  if (usage.total > 0) throw new ReferencedRecordError();
  const sqlite = await getSqliteAsync();
  const source = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM payment_sources WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [sourceId, userId] as never[],
  );
  if (!source) return null;
  await writeRows(userId, [{ table: "payment_sources", row: { ...fromDbShape("payment_sources", source), deletedAt: nowIso() } }]);
  return source;
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
    [sourceId, userId] as never[],
  );
  if (!source) return;
  let replacement: LivePaymentSource | null = null;
  if (replacementId) {
    replacement = await sqlite.getFirstAsync<LivePaymentSource>(
      `SELECT id, type, statement_day, due_day FROM payment_sources WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [replacementId, userId] as never[],
    );
    if (!replacement) throw new Error("Payment source not found");
  }
  const plans = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM installment_plans WHERE user_id = ? AND payment_source_id = ? AND deleted_at IS NULL`,
    [userId, sourceId] as never[],
  );
  const hasCardPlan = plans.some((plan) => plan.kind === "card_installment");
  const replacementCycle = { statementDay: replacement?.statement_day, dueDay: replacement?.due_day };
  if (hasCardPlan && (!replacement || replacement.type !== "credit_card" || !isValidCardCycle(replacementCycle))) {
    throw new CreditCardCycleRequiredError();
  }
  const transactions = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM transactions WHERE user_id = ? AND payment_source_id = ? AND deleted_at IS NULL`,
    [userId, sourceId] as never[],
  );
  const oldStatementIds = [...new Set(
    transactions.map((transaction) => transaction.card_statement_id).filter((id): id is string => typeof id === "string"),
  )];
  const oldStatements = oldStatementIds.length === 0
    ? []
    : await sqlite.getAllAsync<{ id: string; period_month: MonthKey }>(
        `SELECT id, period_month FROM credit_card_statements
         WHERE user_id = ? AND id IN (${oldStatementIds.map(() => "?").join(", ")})`,
        [userId, ...oldStatementIds] as never[],
      );
  const oldPeriodById = new Map(oldStatements.map((statement) => [statement.id, statement.period_month]));
  const statementWrites = new Map<string, RowWrite>();
  const transactionWrites: RowWrite[] = [];
  for (const transaction of transactions) {
    const next = { ...fromDbShape("transactions", transaction), paymentSourceId: replacementId };
    if (!replacement || replacement.type !== "credit_card") {
      transactionWrites.push({ table: "transactions", row: { ...next, purchaseDate: null, cardStatementId: null } });
      continue;
    }
    if (
      transaction.type !== "expense" ||
      Boolean(transaction.is_aggregate) ||
      transaction.status !== "pending" ||
      !isValidCardCycle(replacementCycle)
    ) {
      // Historical effective dates are accounting history. Reassignment changes
      // their label/source, never retroactively moves the balance.
      transactionWrites.push({ table: "transactions", row: { ...next, purchaseDate: null, cardStatementId: null } });
      continue;
    }
    const oldPeriod = typeof transaction.card_statement_id === "string"
      ? oldPeriodById.get(transaction.card_statement_id)
      : null;
    const period = transaction.purchase_date
      ? statementForPurchase(String(transaction.purchase_date), replacementCycle)
      : oldPeriod
        ? statementPeriod(oldPeriod, replacementCycle)
        : statementForDueDate(String(transaction.effective_date), replacementCycle);
    let statementWrite = statementWrites.get(period.periodMonth);
    if (!statementWrite) {
      statementWrite = await cardStatementWrite(userId, replacement.id, period);
      statementWrites.set(period.periodMonth, statementWrite);
    }
    transactionWrites.push({
      table: "transactions",
      row: {
        ...next,
        purchaseDate: transaction.purchase_date ?? null,
        effectiveDate: period.dueDate,
        status: period.dueDate <= todayISO() ? "realized" : "pending",
        cardStatementId: statementWrite.row.id,
      },
    });
  }
  const otherWrites = (
    await Promise.all([
      referenceUpdateRows(userId, "subscriptions", "payment_source_id", sourceId, "paymentSourceId", replacementId),
    ])
  ).flat();
  const writes: RowWrite[] = [
    ...statementWrites.values(),
    ...plans.map((plan) => ({
      table: "installment_plans" as const,
      row: {
        ...fromDbShape("installment_plans", plan),
        paymentSourceId: replacementId,
        dueDay: plan.kind === "card_installment" && isValidCardCycle(replacementCycle)
          ? replacementCycle.dueDay
          : plan.due_day,
      },
    })),
    ...transactionWrites,
    ...otherWrites,
  ];
  writes.push({ table: "payment_sources", row: { ...fromDbShape("payment_sources", source), deletedAt: nowIso() } });
  await writeRows(userId, writes);
}
