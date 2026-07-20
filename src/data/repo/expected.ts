import { getSqliteAsync } from "../../db/client";
import { deterministicId, naturalKeys } from "../../db/ids";
import { fromDbShape, nowIso, writeRows, type RowWrite } from "../../db/mutations";
import { todayISO, type ISODate } from "../../domain/dates";
import { convertToTryMinor } from "../../domain/fx";
import { advanceDueDate } from "../../domain/recurrence";
import { confirmEffectiveDate } from "../../domain/expected";
import type { Minor } from "../../domain/money";
import { isValidCardCycle, statementForPurchase } from "../../domain/card-statements";
import { lookupRate } from "../../services/fx-fetch";
import { marketSellRateTry } from "../../services/markets";
import { FxRateUnavailableError } from "./errors";
import { assertSignedTransactionAmounts, assertTransactionCategory, cardStatementWrite, livePaymentSource } from "./transactions";

// Expected payments: confirm / skip / revert
// ---------------------------------------------------------------------------

/**
 * Thrown when a foreign-currency item is confirmed but no FX rate is available
 * yet (no fresh live price and nothing cached from the dated FX feed). Storing the raw
 * foreign amount as if it were TRY would silently corrupt the balance, so the
 * confirm is refused instead — the caller retries once a rate is known.
 */
export interface ExpectedRow {
  id: string;
  direction: "in" | "out";
  kind: string;
  ref_id: string;
  due_date: string;
  amount_minor: number;
  currency: string;
  status: string;
  transaction_id: string | null;
}

async function getExpectedRow(userId: string, id: string): Promise<ExpectedRow | null> {
  const sqlite = await getSqliteAsync();
  return sqlite.getFirstAsync<ExpectedRow>(
    `SELECT * FROM expected_payments WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [id, userId],
  );
}

/**
 * Confirm an expected item: creates the realized transaction, marks paid and
 * advances the subscription's next due date. `actualAmountMinor` lets the
 * user correct the real amount (salary varies month to month).
 */
export async function confirmExpected(
  userId: string,
  expectedId: string,
  opts: { actualAmountMinor?: Minor; categoryId?: string | null; personId: string; auto?: boolean; paidOn?: ISODate | null },
): Promise<void> {
  const row = await getExpectedRow(userId, expectedId);
  if (!row || (row.status !== "pending" && row.status !== "late")) return;
  const amount = opts.actualAmountMinor ?? row.amount_minor;
  await assertTransactionCategory(
    userId,
    row.direction === "in" ? "income" : "expense",
    opts.categoryId ?? null,
    false,
  );
  // Deterministic id: a double-tap (or two devices auto-confirming the same
  // item) upserts the same transaction row instead of creating a duplicate.
  const txId = await deterministicId(naturalKeys.confirmTx(row.id));
  const today = todayISO();
  // Ledger-affecting date: due date (once passed) / today, unless the user
  // recorded a manual/early payment via `paidOn`. See confirmEffectiveDate.
  let effectiveDate = confirmEffectiveDate(row.due_date, today, opts.paidOn);
  const sqlite = await getSqliteAsync();
  const sub = row.kind === "subscription"
    ? await sqlite.getFirstAsync<Record<string, unknown>>(
        `SELECT * FROM subscriptions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        [row.ref_id, userId],
      )
    : null;
  const paymentSourceId = sub?.payment_source_id == null ? null : String(sub.payment_source_id);
  let purchaseDate: ISODate | null = null;
  let cardStatementId: string | null = null;
  let statementWrite: RowWrite | null = null;
  if (row.direction === "out" && paymentSourceId) {
    const source = await livePaymentSource(userId, paymentSourceId);
    const cycle = { statementDay: source?.statement_day, dueDay: source?.due_day };
    if (source?.type === "credit_card" && isValidCardCycle(cycle)) {
      purchaseDate = opts.paidOn ?? row.due_date;
      const period = statementForPurchase(purchaseDate, cycle);
      effectiveDate = period.dueDate;
      statementWrite = await cardStatementWrite(userId, paymentSourceId, period);
      cardStatementId = String(statementWrite.row.id);
    }
  }

  // Snapshot against the actual occurrence/purchase day. Only a transaction
  // happening today may use the live market quote; backdated confirmations use
  // the last official cached rate on/before that date and never today's price.
  const rateDate = purchaseDate ?? effectiveDate;
  const appliedRate = row.currency === "TRY"
    ? null
    : (rateDate === today ? marketSellRateTry(row.currency) : null) ??
      lookupRate(userId, row.currency, rateDate)?.rate.rateTry ??
      null;
  if (row.currency !== "TRY" && appliedRate == null) throw new FxRateUnavailableError(row.currency);
  const amountTryMinor = appliedRate == null ? amount : convertToTryMinor(amount, appliedRate);
  assertSignedTransactionAmounts(amount, amountTryMinor);

  const writes: RowWrite[] = [
    ...(statementWrite ? [statementWrite] : []),
    {
      table: "transactions",
      row: {
        id: txId,
        type: row.direction === "in" ? "income" : "expense",
        amountMinor: amount,
        currency: row.currency,
        fxRate: appliedRate == null ? null : String(appliedRate),
        amountTryMinor,
        entryDate: today,
        purchaseDate,
        effectiveDate,
        status: effectiveDate <= today ? "realized" : "pending",
        categoryId: opts.categoryId ?? null,
        paymentSourceId,
        personId: opts.personId,
        installmentPlanId: null,
        installmentNo: null,
        cardStatementId,
        subscriptionId: row.kind === "subscription" ? row.ref_id : null,
        isAggregate: false,
        note: null,
        deletedAt: null,
      },
    },
    {
      table: "expected_payments",
      row: {
        id: row.id,
        direction: row.direction,
        kind: row.kind,
        refId: row.ref_id,
        dueDate: row.due_date,
        amountMinor: row.amount_minor,
        currency: row.currency,
        status: "paid",
        paidAt: nowIso(),
        autoConfirmed: opts.auto ?? false,
        transactionId: txId,
        deletedAt: null,
      },
    },
  ];

  if (row.kind === "subscription") {
    if (sub && (sub.next_due_date as string) <= row.due_date) {
      const next = advanceDueDate(row.due_date, sub.interval_months as number, sub.billing_day as number);
      writes.push({
        table: "subscriptions",
        row: {
          ...fromDbShape("subscriptions", sub),
          nextDueDate: next,
        },
      });
    }
  }
  await writeRows(userId, writes, !opts.auto);
}

export async function skipExpected(userId: string, expectedId: string): Promise<void> {
  const row = await getExpectedRow(userId, expectedId);
  if (!row || (row.status !== "pending" && row.status !== "late")) return;
  await writeRows(userId, [
    {
      table: "expected_payments",
      row: { ...fromDbShape("expected_payments", row as unknown as Record<string, unknown>), status: "skipped" },
    },
  ]);
}

/**
 * Undo a skip: back to pending so the item reappears in the catch-up list.
 * Only a skipped row moves, so a double-undo or a stale snackbar is a no-op.
 */
export async function unskipExpected(userId: string, expectedId: string): Promise<void> {
  const row = await getExpectedRow(userId, expectedId);
  if (!row || row.status !== "skipped") return;
  await writeRows(userId, [
    {
      table: "expected_payments",
      row: { ...fromDbShape("expected_payments", row as unknown as Record<string, unknown>), status: "pending" },
    },
  ]);
}

/** Undo a confirmation: tombstone the created transaction, back to pending. */
export async function revertExpected(userId: string, expectedId: string): Promise<void> {
  const row = await getExpectedRow(userId, expectedId);
  if (!row || row.status !== "paid") return;
  const sqlite = await getSqliteAsync();
  const writes: RowWrite[] = [
    {
      table: "expected_payments",
      row: { ...fromDbShape("expected_payments", row as unknown as Record<string, unknown>), status: "pending", paidAt: null, transactionId: null, autoConfirmed: false },
    },
  ];
  if (row.transaction_id) {
    const transaction = await sqlite.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [row.transaction_id, userId],
    );
    if (transaction) {
      writes.unshift({
        table: "transactions",
        row: { ...fromDbShape("transactions", transaction), deletedAt: nowIso() },
      });
    }
  }
  await writeRows(userId, writes);
}
