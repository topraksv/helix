import { getSqliteAsync } from "../../db/client";
import { deterministicId, naturalKeys, newId } from "../../db/ids";
import { fromDbShape, nowIso, writeRows, type RowWrite } from "../../db/mutations";
import { todayISO, type ISODate, type MonthKey } from "../../domain/dates";
import { generateSchedule } from "../../domain/installments";
import { assertSupportedMinorAmount, type Minor } from "../../domain/money";
import { assertInputWithinLimit } from "../../domain/input";
import { isValidCardCycle, statementForDueDate, type CardCycle, type CardStatementPeriod } from "../../domain/card-statements";
import { CreditCardCycleRequiredError, InstallmentHistoryConflictError } from "./errors";
import { assertTransactionCategory, cardStatementWrite, livePaymentSource } from "./transactions";

// Installment plans
// ---------------------------------------------------------------------------

export interface NewPlan {
  title: string;
  kind: "card_installment" | "loan";
  totalAmountMinor: Minor | null;
  monthlyAmountMinor: Minor | null;
  installmentCount: number;
  currency: string;
  fxRate: string | null;
  startMonth: MonthKey;
  dueDay: number | null;
  paymentSourceId: string | null;
  personId: string;
  personIsSelf: boolean;
  categoryId: string | null;
  note: string | null;
  /** TRY conversion factor applied to each share (1 for TRY). */
  tryFactor: number;
}

/**
 * Write the plan row plus one deterministic transaction per scheduled month.
 * Installment transactions are a pure function of (plan params, start month):
 * their id is deterministic and their realized/pending status is derived from
 * the date, so regenerating on edit reproduces the same paid/unpaid split.
 */
/** Build (but don't write) the plan row + one deterministic transaction per
 *  scheduled month. Extracted so a bulk import can batch many plans into ONE
 *  write instead of a DB transaction per plan (that was minutes for ~100 plans).
 *  The per-installment ids are hashed in parallel. */
export async function buildPlanRows(planId: string, input: NewPlan, today: ISODate): Promise<{ rows: RowWrite[]; keepNos: Set<number> }> {
  assertInputWithinLimit(input.title, "text");
  assertInputWithinLimit(input.note, "note");
  if (input.totalAmountMinor != null) assertSupportedMinorAmount(input.totalAmountMinor, false);
  if (input.monthlyAmountMinor != null) assertSupportedMinorAmount(input.monthlyAmountMinor, false);
  const schedule = generateSchedule(
    {
      id: planId,
      kind: input.kind,
      startMonth: input.startMonth,
      installmentCount: input.installmentCount,
      totalAmountMinor: input.totalAmountMinor,
      monthlyAmountMinor: input.monthlyAmountMinor,
      currency: input.currency,
      dueDay: input.dueDay,
      personIsSelf: input.personIsSelf,
    },
    today,
  );
  const planRow: RowWrite = {
    table: "installment_plans",
    row: {
      id: planId,
      title: input.title,
      kind: input.kind,
      totalAmountMinor: input.totalAmountMinor,
      monthlyAmountMinor: input.monthlyAmountMinor,
      installmentCount: input.installmentCount,
      currency: input.currency,
      startMonth: input.startMonth,
      dueDay: input.dueDay,
      paymentSourceId: input.paymentSourceId,
      personId: input.personId,
      categoryId: input.categoryId,
      note: input.note,
      deletedAt: null,
    },
  };
  const txRows: RowWrite[] = await Promise.all(
    schedule.map(async (item) => ({
      table: "transactions" as const,
      row: {
        id: await deterministicId(naturalKeys.installmentTx(planId, item.installmentNo)),
        type: "expense",
        amountMinor: item.amountMinor,
        currency: input.currency,
        fxRate: input.fxRate,
        amountTryMinor: assertSupportedMinorAmount(Math.round(item.amountMinor * input.tryFactor), false),
        entryDate: today,
        purchaseDate: null,
        effectiveDate: item.effectiveDate,
        status: item.status,
        categoryId: input.categoryId,
        paymentSourceId: input.paymentSourceId,
        personId: input.personId,
        installmentPlanId: planId,
        installmentNo: item.installmentNo,
        cardStatementId: null,
        subscriptionId: null,
        isAggregate: false,
        note: null,
        deletedAt: null,
      },
    })),
  );
  return { rows: [planRow, ...txRows], keepNos: new Set(schedule.map((s) => s.installmentNo)) };
}

export async function linkDueRowsToCardStatements(
  userId: string,
  paymentSourceId: string,
  cycle: CardCycle,
  rows: RowWrite[],
): Promise<RowWrite[]> {
  const periods = new Map<string, CardStatementPeriod>();
  for (const write of rows) {
    if (write.table !== "transactions") continue;
    const period = statementForDueDate(String(write.row.effectiveDate), cycle);
    periods.set(period.periodMonth, period);
  }
  const statementWrites = await Promise.all(
    [...periods.values()].map((period) => cardStatementWrite(userId, paymentSourceId, period)),
  );
  const idByPeriod = new Map(
    statementWrites.map((write) => [String(write.row.periodMonth), String(write.row.id)]),
  );
  return [
    ...statementWrites,
    ...rows.map((write) => {
      if (write.table !== "transactions") return write;
      const period = statementForDueDate(String(write.row.effectiveDate), cycle);
      return { ...write, row: { ...write.row, cardStatementId: idByPeriod.get(period.periodMonth) ?? null } };
    }),
  ];
}

async function writePlanWithSchedule(
  userId: string,
  planId: string,
  input: NewPlan,
  preserveRealized = false,
): Promise<Set<number>> {
  await assertTransactionCategory(userId, "expense", input.categoryId, false);
  const sqlite = await getSqliteAsync();
  const existingPlanTransactions = preserveRealized
    ? await sqlite.getAllAsync<Record<string, unknown>>(
        `SELECT * FROM transactions WHERE user_id = ? AND installment_plan_id = ?
         AND deleted_at IS NULL`,
        [userId, planId],
      )
    : [];
  const realized = existingPlanTransactions.filter((transaction) => transaction.status === "realized");
  if (realized.some((transaction) => Number(transaction.installment_no) > input.installmentCount)) {
    throw new InstallmentHistoryConflictError();
  }
  let resolvedInput = input;
  let cardCycle: CardCycle | null = null;
  if (input.kind === "card_installment") {
    const source = await livePaymentSource(userId, input.paymentSourceId);
    const candidate = { statementDay: source?.statement_day, dueDay: source?.due_day };
    if (!source || source.type !== "credit_card" || !isValidCardCycle(candidate)) {
      throw new CreditCardCycleRequiredError();
    }
    cardCycle = candidate;
    resolvedInput = { ...input, dueDay: candidate.dueDay };
  }
  const { rows, keepNos } = await buildPlanRows(planId, resolvedInput, todayISO());
  let writes = cardCycle && resolvedInput.paymentSourceId
    ? await linkDueRowsToCardStatements(userId, resolvedInput.paymentSourceId, cardCycle, rows)
    : rows;
  if (realized.length > 0) {
    const realizedById = new Map(realized.map((transaction) => [String(transaction.id), transaction]));
    writes = writes.map((write) => {
      if (write.table !== "transactions") return write;
      const historical = realizedById.get(String(write.row.id));
      return historical ? { table: "transactions" as const, row: fromDbShape("transactions", historical) } : write;
    });
    const referencedStatementIds = new Set(
      writes
        .filter((write) => write.table === "transactions")
        .map((write) => write.row.cardStatementId)
        .filter((id): id is string => typeof id === "string"),
    );
    writes = writes.filter(
      (write) => write.table !== "credit_card_statements" || referencedStatementIds.has(String(write.row.id)),
    );
  }
  if (preserveRealized) {
    writes.push(
      ...existingPlanTransactions
        .filter(
          (transaction) =>
            transaction.status === "pending" &&
            transaction.installment_no != null &&
            !keepNos.has(Number(transaction.installment_no)),
        )
        .map((transaction) => ({
          table: "transactions" as const,
          row: { ...fromDbShape("transactions", transaction), deletedAt: nowIso() },
        })),
    );
  }
  await writeRows(userId, writes);
  return keepNos;
}

/** Live installment transactions belonging to a plan — for a warn-before-delete
 *  count (deleting a plan tombstones all of them; the action has no undo). */
export async function countInstallmentsForPlan(userId: string, planId: string): Promise<number> {
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND installment_plan_id = ? AND deleted_at IS NULL`,
    [userId, planId],
  );
  return row?.n ?? 0;
}

/** Create the plan and materialize one transaction per month (deterministic ids). */
export async function createInstallmentPlan(userId: string, input: NewPlan): Promise<string> {
  const planId = newId();
  await writePlanWithSchedule(userId, planId, input);
  return planId;
}

/**
 * Edit an existing plan in place: rewrite the plan row, regenerate the
 * schedule (deterministic ids un-delete/update matching months), and tombstone
 * any previously-generated installments that fall outside the new schedule
 * (e.g. when the installment count is reduced).
 */
export async function updateInstallmentPlan(userId: string, planId: string, input: NewPlan): Promise<void> {
  await writePlanWithSchedule(userId, planId, input, true);
}

/** Tombstone a plan together with its generated transactions. */
export async function deletePlan(userId: string, planId: string): Promise<void> {
  const sqlite = await getSqliteAsync();
  const [plan, transactions] = await Promise.all([
    sqlite.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM installment_plans WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [planId, userId],
    ),
    sqlite.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM transactions WHERE installment_plan_id = ? AND user_id = ? AND deleted_at IS NULL`,
      [planId, userId],
    ),
  ]);
  if (!plan) return;
  const deletedAt = nowIso();
  await writeRows(userId, [
    { table: "installment_plans", row: { ...fromDbShape("installment_plans", plan), deletedAt } },
    ...transactions.map((transaction) => ({
      table: "transactions" as const,
      row: { ...fromDbShape("transactions", transaction), deletedAt },
    })),
  ]);
}
