import { getSqliteAsync } from "../../db/client";
import { deterministicId, naturalKeys } from "../../db/ids";
import { fromDbShape, nowIso, writeRows, type RowWrite } from "../../db/mutations";
import { isISODate, isMonthDay, todayISO, type ISODate } from "../../domain/dates";
import { convertToTryMinor } from "../../domain/fx";
import { advanceDueDate } from "../../domain/recurrence";
import { confirmEffectiveDate } from "../../domain/expected";
import { isSupportedMinorAmount, type Minor } from "../../domain/money";
import { isValidCardCycle, statementForPurchase } from "../../domain/card-statements";
import { lookupRate } from "../../services/fx-fetch";
import { marketSellRateTry } from "../../services/markets";
import { ExpectedAlreadyMatchedError, FxRateUnavailableError } from "./errors";
import { assertLiveTransactionPerson, assertSignedTransactionAmounts, assertTransactionCategory, cardStatementWrite, livePaymentSource } from "./transactions";

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
  amount_is_estimated: number | boolean;
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
  if (!isSupportedMinorAmount(amount, false)) throw new Error("Invalid expected payment amount");
  if (!isISODate(row.due_date) || (opts.paidOn != null && !isISODate(opts.paidOn))) {
    throw new Error("Invalid expected payment date");
  }
  const sqlite = await getSqliteAsync();
  const rule = row.kind === "subscription"
    ? await sqlite.getFirstAsync<Record<string, unknown>>(
        `SELECT * FROM subscriptions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        [row.ref_id, userId],
      )
    : row.kind === "recurring_income"
      ? await sqlite.getFirstAsync<Record<string, unknown>>(
          `SELECT * FROM recurring_incomes WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
          [row.ref_id, userId],
        )
      : null;
  if ((row.kind === "subscription" || row.kind === "recurring_income") && !rule) {
    throw new Error("Expected payment source rule does not exist");
  }
  if (row.kind === "subscription" && String(rule?.amount_mode ?? "fixed") === "variable" && Boolean(row.amount_is_estimated) && opts.actualAmountMinor == null) {
    throw new Error("Variable subscription amount must be entered before confirmation");
  }
  const rulePersonId = row.kind === "subscription" || row.kind === "recurring_income"
    ? String(rule?.person_id ?? "")
    : null;
  if (rulePersonId && rulePersonId !== opts.personId) {
    throw new Error("Expected payment person does not match source rule");
  }
  const transactionPersonId = rulePersonId || opts.personId;
  await assertLiveTransactionPerson(userId, transactionPersonId);
  const categoryId = opts.categoryId ?? (rule?.category_id == null ? null : String(rule.category_id));
  await assertTransactionCategory(
    userId,
    row.direction === "in" ? "income" : "expense",
    categoryId,
    true,
  );
  // Deterministic id: a double-tap (or two devices auto-confirming the same
  // item) upserts the same transaction row instead of creating a duplicate.
  const txId = await deterministicId(naturalKeys.confirmTx(row.id));
  const today = todayISO();
  // Ledger-affecting date: due date (once passed) / today, unless the user
  // recorded a manual/early payment via `paidOn`. See confirmEffectiveDate.
  let effectiveDate = confirmEffectiveDate(row.due_date, today, opts.paidOn);
  const sub = row.kind === "subscription" ? rule : null;
  const paymentSourceId = sub?.payment_source_id == null ? null : String(sub.payment_source_id);
  const source = paymentSourceId ? await livePaymentSource(userId, paymentSourceId) : null;
  if (paymentSourceId && !source) throw new Error("Expected payment source does not exist");
  let purchaseDate: ISODate | null = null;
  let cardStatementId: string | null = null;
  let statementWrite: RowWrite | null = null;
  if (row.direction === "out" && paymentSourceId && source) {
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
        categoryId,
        paymentSourceId,
        personId: transactionPersonId,
        installmentPlanId: null,
        installmentNo: null,
        cardStatementId,
        subscriptionId: row.kind === "subscription" ? row.ref_id : null,
        isAggregate: false,
        note: null,
        // Confirming an expectation is not hand entry: the matching flow and
        // duplicate review both need to tell the two apart.
        origin: "expected",
        importKey: null,
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
        amountMinor: amount,
        amountIsEstimated: false,
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

/** Save the invoice amount for a variable subscription without confirming it. */
export async function setExpectedAmount(userId: string, expectedId: string, amountMinor: Minor): Promise<void> {
  const row = await getExpectedRow(userId, expectedId);
  if (!row || (row.status !== "pending" && row.status !== "late")) return;
  if (!isSupportedMinorAmount(amountMinor, false)) throw new Error("Invalid expected payment amount");
  if (row.kind !== "subscription") throw new Error("Only subscription amounts can be edited");
  const sqlite = await getSqliteAsync();
  const subscription = await sqlite.getFirstAsync<{ amount_mode?: string }>(
    `SELECT amount_mode FROM subscriptions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [row.ref_id, userId],
  );
  if (!subscription) throw new Error("Expected payment source rule does not exist");
  if (String(subscription.amount_mode ?? "fixed") !== "variable") throw new Error("Only variable subscription amounts can be edited");
  await writeRows(userId, [{
    table: "expected_payments",
    row: {
      ...fromDbShape("expected_payments", row),
      amountMinor,
      amountIsEstimated: false,
    },
  }]);
}

export async function skipExpected(userId: string, expectedId: string): Promise<void> {
  const row = await getExpectedRow(userId, expectedId);
  if (!row || (row.status !== "pending" && row.status !== "late")) return;
  await writeRows(userId, [
    {
      table: "expected_payments",
      row: { ...fromDbShape("expected_payments", row), status: "skipped" },
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
      row: { ...fromDbShape("expected_payments", row), status: "pending" },
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
      row: { ...fromDbShape("expected_payments", row), status: "pending", paidAt: null, transactionId: null, autoConfirmed: false },
    },
  ];
  if (row.kind === "subscription" && isISODate(row.due_date)) {
    const subscription = await sqlite.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM subscriptions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [row.ref_id, userId],
    );
    const intervalMonths = Number(subscription?.interval_months);
    const billingDay = Number(subscription?.billing_day);
    const currentNextDueDate = subscription?.next_due_date;
    if (
      subscription &&
      isISODate(currentNextDueDate) &&
      Number.isInteger(intervalMonths) && intervalMonths >= 1 &&
      isMonthDay(billingDay) &&
      currentNextDueDate === advanceDueDate(row.due_date, intervalMonths, billingDay)
    ) {
      writes.push({
        table: "subscriptions",
        row: { ...fromDbShape("subscriptions", subscription), nextDueDate: row.due_date },
      });
    }
  }
  if (row.transaction_id) {
    const transaction = await sqlite.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [row.transaction_id, userId],
    );
    // Only a row THIS confirmation created is removed with it. A transaction
    // the owner had already recorded and then MATCHED to the expectation is
    // their own record of real money: unlinking it is the whole of the undo,
    // and deleting it would destroy data the expectation never owned.
    //
    // A row with no origin is a confirmation from before provenance existed —
    // matching did not exist then either, so the only way it could be linked
    // was a confirmation, and it keeps the original behaviour.
    const createdByConfirmation = transaction != null
      && (transaction.origin == null || transaction.origin === "expected");
    if (transaction && createdByConfirmation) {
      writes.unshift({
        table: "transactions",
        row: { ...fromDbShape("transactions", transaction), deletedAt: nowIso() },
      });
    }
  }
  await writeRows(userId, writes);
}

/**
 * Record that an expectation was settled by a transaction that already exists.
 *
 * The counterpart to `confirmExpected`, which CREATES the payment. Here the
 * payment was already recorded — imported from a statement, typed by hand —
 * and the expectation simply needs to point at it, so the dashboard stops
 * forecasting money that has already moved and the ledger does not gain a
 * second copy of it.
 *
 * Nothing about the transaction is rewritten. Its amount may legitimately
 * differ from the estimate (a variable bill), its date may differ from the due
 * date, and neither is this function's business to correct.
 */
export async function matchExpectedToTransaction(
  userId: string,
  expectedId: string,
  transactionId: string,
): Promise<void> {
  const row = await getExpectedRow(userId, expectedId);
  if (!row || (row.status !== "pending" && row.status !== "late")) return;
  const sqlite = await getSqliteAsync();
  const transaction = await sqlite.getFirstAsync<{ id: string; person_id: string }>(
    `SELECT id, person_id FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [transactionId, userId],
  );
  if (!transaction) throw new Error("Matched transaction does not exist");
  // One transaction settles one expectation. Without this, two months of the
  // same bill could both point at a single payment and the forecast would drop
  // twice for money that moved once.
  const alreadyLinked = await sqlite.getFirstAsync<{ id: string }>(
    `SELECT id FROM expected_payments
     WHERE user_id = ? AND transaction_id = ? AND id != ? AND deleted_at IS NULL AND status = 'paid'`,
    [userId, transactionId, expectedId],
  );
  if (alreadyLinked) throw new ExpectedAlreadyMatchedError();

  const writes: RowWrite[] = [{
    table: "expected_payments",
    row: {
      ...fromDbShape("expected_payments", row),
      status: "paid",
      paidAt: nowIso(),
      autoConfirmed: false,
      transactionId,
    },
  }];
  if (row.kind === "subscription" && isISODate(row.due_date)) {
    const subscription = await sqlite.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM subscriptions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [row.ref_id, userId],
    );
    const intervalMonths = Number(subscription?.interval_months);
    const billingDay = Number(subscription?.billing_day);
    if (
      subscription
      && Number.isInteger(intervalMonths) && intervalMonths >= 1
      && isMonthDay(billingDay)
      && String(subscription.next_due_date) <= row.due_date
    ) {
      writes.push({
        table: "subscriptions",
        row: {
          ...fromDbShape("subscriptions", subscription),
          nextDueDate: advanceDueDate(row.due_date, intervalMonths, billingDay),
        },
      });
    }
  }
  await writeRows(userId, writes);
}
