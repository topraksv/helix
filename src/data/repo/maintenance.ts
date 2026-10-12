import { getSqliteAsync } from "../../db/client";
import { RELATIONS } from "../../db/relations";
import { createSerialQueue } from "../../domain/serial-queue";
import { deterministicId, naturalKeys } from "../../db/ids";
import { fromDbShape, nowIso, softDelete, writeRows, writeRowsValidated, writeSetting, type RowWrite } from "../../db/mutations";
import { localDayOfTimestamp, todayISO, type ISODate } from "../../domain/dates";
import { findAutoConfirmable, findLate, generateExpected } from "../../domain/expected";
import type { ExpectedPaymentLike } from "../../domain/types";
import { isValidCardCycle, statementForDueDate, statementForPurchase, type CardStatementPeriod } from "../../domain/card-statements";
import { FxRateUnavailableError } from "./errors";
import { expectedPaymentLike, expectedPaymentWrite } from "./rules";
import { InvestmentDomainError } from "../../domain/investments";
import { assertInvestmentWrites } from "./investment-validation";
import { confirmExpected, type ExpectedRow } from "./expected";
import { cardStatementWrite, type LivePaymentSource } from "./transactions";
import { billedInTry } from "./installments";

// Serialized per user: a skipped pass must not resolve like a finished one — `reassignAndDeletePerson` awaits it.
const maintenanceQueue = createSerialQueue<void>();

export async function repairCardStatementLinks(userId: string, today: ISODate): Promise<void> {
  const sqlite = await getSqliteAsync();
  const cards = await sqlite.getAllAsync<LivePaymentSource>(
    `SELECT id, type, statement_day, due_day FROM payment_sources
     WHERE user_id = ? AND type = 'credit_card' AND deleted_at IS NULL`,
    [userId],
  );
  for (const card of cards) {
    const cycle = { statementDay: card.statement_day, dueDay: card.due_day };
    if (!isValidCardCycle(cycle)) continue;
    const candidates = await sqlite.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM transactions
       WHERE user_id = ? AND payment_source_id = ? AND type = 'expense'
         AND card_statement_id IS NULL AND is_aggregate = 0 AND deleted_at IS NULL
         AND (installment_plan_id IS NOT NULL OR purchase_date IS NOT NULL)`,
      [userId, card.id],
    );
    if (candidates.length === 0) continue;
    const periodByTx = new Map<string, CardStatementPeriod>();
    for (const transaction of candidates) {
      const purchaseDate = transaction.purchase_date as ISODate | null;
      const period = purchaseDate
        ? statementForPurchase(purchaseDate, cycle)
        : statementForDueDate(transaction.effective_date as ISODate, cycle);
      if (
        !purchaseDate &&
        transaction.status === "realized" &&
        period.dueDate !== transaction.effective_date
      ) continue;
      periodByTx.set(String(transaction.id), period);
    }
    const eligible = candidates.filter((transaction) => periodByTx.has(String(transaction.id)));
    if (eligible.length === 0) continue;
    const uniquePeriods = new Map(
      [...periodByTx.values()].map((period) => [period.periodMonth, period]),
    );
    const statementWrites = await Promise.all(
      [...uniquePeriods.values()].map((period) => cardStatementWrite(userId, card.id, period)),
    );
    const idByPeriod = new Map(
      statementWrites.map((write) => [String(write.row.periodMonth), String(write.row.id)]),
    );
    await writeRows(
      userId,
      [
        ...statementWrites,
        ...eligible.map((transaction) => {
          const period = periodByTx.get(String(transaction.id))!;
          const effectiveDate = transaction.purchase_date || transaction.status === "pending"
            ? period.dueDate
            : String(transaction.effective_date);
          return {
            table: "transactions" as const,
            row: {
              ...fromDbShape("transactions", transaction),
              effectiveDate,
              status: effectiveDate <= today ? "realized" : "pending",
              cardStatementId: idByPeriod.get(period.periodMonth)!,
            },
          };
        }),
      ],
      false,
    );
  }
  const orphaned = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT cs.* FROM credit_card_statements cs
     WHERE cs.user_id = ? AND cs.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM transactions t
         WHERE t.user_id = cs.user_id AND t.card_statement_id = cs.id AND t.deleted_at IS NULL
       )
       -- A statement with a recorded payment is not an orphan: the money left the account.
       AND NOT EXISTS (
         SELECT 1 FROM card_statement_payments p
         WHERE p.user_id = cs.user_id AND p.statement_id = cs.id AND p.deleted_at IS NULL
       )`,
    [userId],
  );
  if (orphaned.length > 0) {
    await writeRows(
      userId,
      orphaned.map((statement) => ({
        table: "credit_card_statements" as const,
        row: { ...fromDbShape("credit_card_statements", statement), deletedAt: nowIso() },
      })),
      false,
    );
  }
}

/**
 * Rows that exist only for another row (a budget for its category, a document for its transaction).
 * Swept here rather than in each delete, because the parent's tombstone also arrives by sync.
 * A child is tombstoned only when its parent PROVABLY exists as deleted: a missing parent may not
 * have synced yet, and cleaning it would destroy data mid-first-pull.
 */
const DEPENDENTS = RELATIONS.filter(([table]) => table === "category_budgets" || table === "attachments");

/**
 * A parent that can still come back is not deleted yet, and a document waits for it: its bytes are
 * pruned in the same pass. A transaction can be restored by undo, and a live plan regenerates its
 * instalments under the same id; a day outlasts every undo, and deleting the plan makes its rows final.
 */
const REVIVABLE_PARENT = `p.deleted_at > ? OR EXISTS (
  SELECT 1 FROM installment_plans plan
  WHERE plan.user_id = p.user_id AND plan.id = p.installment_plan_id AND plan.deleted_at IS NULL
)`;
const UNDO_OUTLASTED_MS = 24 * 60 * 60 * 1000;

async function tombstoneOrphans(userId: string): Promise<void> {
  const sqlite = await getSqliteAsync();
  const undoCutoff = new Date(Date.now() - UNDO_OUTLASTED_MS).toISOString();
  for (const [table, key, parent] of DEPENDENTS) {
    const revivable = parent === "transactions";
    const orphans = await sqlite.getAllAsync<Record<string, unknown>>(
      `SELECT child.* FROM ${table} child
       WHERE child.user_id = ? AND child.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM ${parent} p
           WHERE p.user_id = child.user_id AND p.id = child.${key} AND p.deleted_at IS NOT NULL
             ${revivable ? `AND NOT (${REVIVABLE_PARENT})` : ""}
         )`,
      revivable ? [userId, undoCutoff] : [userId],
    );
    if (orphans.length === 0) continue;
    await writeRows(
      userId,
      orphans.map((row) => ({ table, row: { ...fromDbShape(table, row), deletedAt: nowIso() } })),
      false,
    );
  }
}

export async function runMaintenance(userId: string): Promise<void> {
  await maintenanceQueue(userId, runMaintenanceInner);
}

async function runMaintenanceInner(userId: string): Promise<void> {
  const today = todayISO();
  const sqlite = await getSqliteAsync();

  // 0) Collapse duplicate "self" persons: keep the oldest, remap references, tombstone the rest.
  const selves = await sqlite.getAllAsync<{ id: string }>(
    `SELECT id FROM persons WHERE user_id = ? AND is_self = 1 AND deleted_at IS NULL ORDER BY created_at ASC`,
    [userId],
  );
  if (selves.length > 1) {
    const keepId = selves[0]!.id;
    for (const dup of selves.slice(1)) {
      const repairWrites: RowWrite[] = [];
      for (const table of ["transactions", "payment_sources", "subscriptions", "recurring_incomes", "installment_plans"] as const) {
        const refs = await sqlite.getAllAsync<Record<string, unknown>>(
          `SELECT * FROM ${table} WHERE user_id = ? AND person_id = ?`,
          [userId, dup.id],
        );
        repairWrites.push(...refs.map((row) => ({ table, row: { ...fromDbShape(table, row), personId: keepId } })));
      }
      const duplicate = await sqlite.getFirstAsync<Record<string, unknown>>(
        `SELECT * FROM persons WHERE id = ? AND user_id = ?`,
        [dup.id, userId],
      );
      repairWrites.push({ table: "persons", row: { ...fromDbShape("persons", duplicate!), deletedAt: nowIso() } });
      await writeRows(userId, repairWrites, false);
    }
  }

  // 0b) A refund stored as income +100 in an expense category becomes expense -100: same balance
  // effect, but every category and chart nets it consistently.
  const mismatched = await sqlite.getAllAsync<Record<string, unknown> & { category_kind: "expense" | "income" }>(
    `SELECT t.*, c.kind AS category_kind
     FROM transactions t
     JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
     WHERE t.user_id = ? AND t.deleted_at IS NULL
       AND t.type != 'transfer' AND t.type != c.kind`,
    [userId],
  );
  if (mismatched.length > 0) {
    await writeRows(
      userId,
      mismatched.map((row) => ({
        table: "transactions" as const,
        row: {
          ...fromDbShape("transactions", row),
          type: row.category_kind,
          amountMinor: -(row.amount_minor as number),
          amountTryMinor: -(row.amount_try_minor as number),
        },
      })),
      false,
    );
  }

  // 0c) One-time removal of the auto-created "KK Taksit" column, guarded by a synced flag so it
  // never resurrects on another device. The user's own computed columns are untouched.
  const ccRemoved = await sqlite.getAllAsync<{ value: string }>(
    `SELECT value FROM settings WHERE user_id = ? AND key = 'cc_column_removed' AND deleted_at IS NULL`,
    [userId],
  );
  if (ccRemoved.length === 0) {
    const ccId = await deterministicId(naturalKeys.ccColumn(userId));
    const live = await sqlite.getAllAsync<{ id: string }>(
      `SELECT id FROM computed_columns WHERE user_id = ? AND id = ? AND deleted_at IS NULL`,
      [userId, ccId],
    );
    if (live.length > 0) await softDelete(userId, "computed_columns", ccId);
    await writeSetting(userId, "cc_column_removed", true);
  }

  // 0d) Link only rows with real date information; a legacy card row with neither a purchase nor a
  // payment date is left alone, since guessing would rewrite financial history.
  await repairCardStatementLinks(userId, today);

  // 0e) A dependent goes with the row it belongs to.
  await tombstoneOrphans(userId);

  // 1) §2.2 — pending transactions whose effective date arrived become realized.
  const due = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM transactions WHERE user_id = ? AND status = 'pending' AND effective_date <= ? AND deleted_at IS NULL`,
    [userId, today],
  );
  // A statement paid against fixes the TRY figure of its foreign instalments; restating it afterwards
  // would turn a statement paid in full into a partial one.
  const paidStatements = new Set((await sqlite.getAllAsync<{ statement_id: string }>(
    `SELECT DISTINCT statement_id FROM card_statement_payments WHERE user_id = ? AND paid_on <= ? AND deleted_at IS NULL`,
    [userId, today],
  )).map((payment) => payment.statement_id));
  const billsAtRate = (row: Record<string, unknown>) =>
    row.installment_plan_id != null && !paidStatements.has(String(row.card_statement_id));
  const priority = (row: Record<string, unknown>) =>
    row.type === "transfer" && Number(row.amount_try_minor) > 0
      ? 0
      : row.type === "transfer" && Number(row.amount_try_minor) < 0
        ? 2
        : 1;
  for (const row of [...due].sort((a, b) => priority(a) - priority(b) || String(a.id).localeCompare(String(b.id)))) {
    const billed = !billsAtRate(row)
      ? null
      : await billedInTry(userId, String(row.currency), Number(row.amount_minor), String(row.effective_date) as ISODate);
    const writes: RowWrite[] = [{ table: "transactions", row: { ...fromDbShape("transactions", row), status: "realized", ...billed } }];
    try {
      await writeRowsValidated(
        userId,
        writes,
        (db) => assertInvestmentWrites(db, userId, writes).then(() => undefined),
        false,
      );
    } catch (error) {
      // A scheduled refund can become unaffordable after later edits: keep it pending, land the rest.
      if (error instanceof InvestmentDomainError && error.code === "insufficient_cash") continue;
      throw error;
    }
  }

  // 1b) A coming foreign-currency instalment follows the last known rate until its own day fixes it
  // above, or its statement is paid against.
  const comingForeign = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM transactions
     WHERE user_id = ? AND status = 'pending' AND installment_plan_id IS NOT NULL
       AND currency != 'TRY' AND effective_date > ? AND deleted_at IS NULL`,
    [userId, today],
  );
  const repriced: RowWrite[] = [];
  for (const row of comingForeign.filter(billsAtRate)) {
    const billed = await billedInTry(userId, String(row.currency), Number(row.amount_minor), today);
    if (!billed || (billed.amountTryMinor === Number(row.amount_try_minor) && billed.fxRate === row.fx_rate)) continue;
    repriced.push({ table: "transactions", row: { ...fromDbShape("transactions", row), ...billed } });
  }
  if (repriced.length > 0) await writeRows(userId, repriced, false);

  // 2) Generate missing expected items (subscriptions + recurring incomes).
  const subs = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT s.*, p.is_self FROM subscriptions s
     JOIN persons p ON p.id = s.person_id AND p.user_id = s.user_id AND p.deleted_at IS NULL
     WHERE s.user_id = ? AND s.deleted_at IS NULL`,
    [userId],
  );
  const incomes = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT r.*, p.is_self FROM recurring_incomes r
     JOIN persons p ON p.id = r.person_id AND p.user_id = r.user_id AND p.deleted_at IS NULL
     WHERE r.user_id = ? AND r.deleted_at IS NULL`,
    [userId],
  );
  // Watch-only people's obligations never belong in the user's balance or forecast: drop pending/late
  // derivatives, keep paid/skipped history.
  const watchedSubscriptions = new Set(subs.filter((row) => !row.is_self).map((row) => row.id as string));
  const watchedIncomes = new Set(incomes.filter((row) => !row.is_self).map((row) => row.id as string));
  if (watchedSubscriptions.size > 0 || watchedIncomes.size > 0) {
    const mutableExpected = await sqlite.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM expected_payments
       WHERE user_id = ? AND status IN ('pending', 'late') AND deleted_at IS NULL`,
      [userId],
    );
    const stale = mutableExpected.filter((row) =>
      (row.kind === "subscription" && watchedSubscriptions.has(row.ref_id as string)) ||
      (row.kind === "recurring_income" && watchedIncomes.has(row.ref_id as string)),
    );
    if (stale.length > 0) {
      await writeRows(
        userId,
        stale.map((row) => ({
          table: "expected_payments" as const,
          row: { ...fromDbShape("expected_payments", row), deletedAt: nowIso() },
        })),
        false,
      );
    }
  }
  const existing = await sqlite.getAllAsync<{ kind: string; ref_id: string; due_date: string }>(
    `SELECT kind, ref_id, due_date FROM expected_payments WHERE user_id = ? AND deleted_at IS NULL`,
    [userId],
  );
  const drafts = generateExpected(
    subs.map((s) => ({
      id: s.id as string,
      name: s.name as string,
      amountMinor: s.amount_minor as number,
      amountMode: s.amount_mode as "fixed" | "variable",
      currency: s.currency as string,
      cycle: s.cycle as "monthly" | "yearly" | "custom",
      intervalMonths: s.interval_months as number,
      billingDay: s.billing_day as number,
      nextDueDate: s.next_due_date as string,
      isActive: Boolean(s.is_active),
      autoPay: Boolean(s.auto_pay),
      personIsSelf: Boolean(s.is_self),
      trialEndDate: (s.trial_end_date as string) ?? null,
    })),
    incomes.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      defaultAmountMinor: r.default_amount_minor as number,
      currency: r.currency as string,
      payDay: r.pay_day as number,
      recurrence: r.recurrence as "monthly" | "weekly" | "biweekly",
      anchorDate: r.anchor_date as string | null,
      isActive: Boolean(r.is_active),
      personIsSelf: Boolean(r.is_self),
    })),
    existing.map((e) => ({ kind: e.kind as ExpectedPaymentLike["kind"], refId: e.ref_id, dueDate: e.due_date })),
    today,
  );
  if (drafts.length > 0) {
    const writes: RowWrite[] = [];
    for (const draft of drafts) writes.push(await expectedPaymentWrite(userId, draft));
    await writeRows(userId, writes, false);
  }

  // 3) Late marking + auto-pay confirmations.
  const pendingRows = await sqlite.getAllAsync<ExpectedRow>(
    `SELECT * FROM expected_payments WHERE user_id = ? AND status = 'pending' AND deleted_at IS NULL`,
    [userId],
  );
  const pendingLike = pendingRows.map(expectedPaymentLike);
  // refId → the day the rule was written down; `findAutoConfirmable` tells a billing date the rule
  // lived through from one it was created on.
  const autoPayRules = new Map<string, ISODate | null>(
    subs
      .filter((s) => Boolean(s.auto_pay) && Boolean(s.is_self) && s.amount_mode !== "variable")
      .map((s) => [s.id as string, localDayOfTimestamp(s.created_at)]),
  );
  const subscriptionById = new Map(subs.map((subscription) => [subscription.id as string, subscription]));
  const selfPersonId = (
    await sqlite.getFirstAsync<{ id: string }>(
      `SELECT id FROM persons WHERE user_id = ? AND is_self = 1 AND deleted_at IS NULL`,
      [userId],
    )
  )?.id;
  for (const item of findAutoConfirmable(pendingLike, autoPayRules, today)) {
    if (selfPersonId) {
      const sub = subscriptionById.get(item.refId);
      try {
        await confirmExpected(userId, item.id, {
          personId: (sub?.person_id as string) ?? selfPersonId,
          categoryId: (sub?.category_id as string | null) ?? null,
          auto: true,
        });
      } catch (e) {
        // Only a missing rate is swallowed; continuing past other throws hides failures the tests observe.
        if (!(e instanceof FxRateUnavailableError)) throw e;
      }
    }
  }
  const stillPending = pendingLike.filter((p) => !autoPayRules.has(p.refId) || p.kind !== "subscription");
  const late = findLate(stillPending, today);
  if (late.length > 0) {
    const byId = new Map(pendingRows.map((r) => [r.id, r]));
    await writeRows(
      userId,
      // A derived id with no row is skipped: `fromDbShape(undefined)` would abort the rest of every boot's pass.
      late.flatMap((l) => {
        const row = byId.get(l.id);
        return row
          ? [{ table: "expected_payments" as const, row: { ...fromDbShape("expected_payments", row), status: "late" } }]
          : [];
      }),
      false,
    );
  }
}
