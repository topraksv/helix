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
import { FxRateUnavailableError } from "./errors";
import { assertLiveTransactionPerson, assertSignedTransactionAmounts, assertTransactionCategory, cardStatementWrite, livePaymentSource, type LivePaymentSource } from "./transactions";

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

const RULE_TABLES = new Map([["subscription", "subscriptions"], ["recurring_income", "recurring_incomes"]]);

/** The live subscription or income rule an expectation was generated from. */
async function liveRule(userId: string, row: ExpectedRow): Promise<Record<string, unknown> | null> {
  const table = RULE_TABLES.get(row.kind);
  if (!table) return null;
  return (await getSqliteAsync()).getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [row.ref_id, userId],
  );
}

const isOpen = (row: ExpectedRow | null): row is ExpectedRow => row?.status === "pending" || row?.status === "late";

interface ConfirmOptions { actualAmountMinor?: Minor; categoryId?: string | null; personId: string; auto?: boolean; paidOn?: ISODate | null }

/** The person a confirmation is recorded against, refusing what the expectation's rule contradicts. */
function confirmingPerson(row: ExpectedRow, rule: Record<string, unknown> | null, opts: ConfirmOptions): string {
  if (RULE_TABLES.has(row.kind) && !rule) throw new Error("Expected payment source rule does not exist");
  if (row.kind === "subscription" && String(rule?.amount_mode) === "variable" && Boolean(row.amount_is_estimated) && opts.actualAmountMinor == null) {
    throw new Error("Variable subscription amount must be entered before confirmation");
  }
  const rulePersonId = rule?.person_id == null ? "" : String(rule.person_id);
  if (rulePersonId && rulePersonId !== opts.personId) throw new Error("Expected payment person does not match source rule");
  return rulePersonId || opts.personId;
}

/**
 * When a confirmed payment happens. A card with a cycle bills it on the
 * statement its day joins, so it reaches the balance on that statement's due
 * date; anything else lands on the due date once passed, or today, unless the
 * owner recorded an early payment.
 */
async function confirmationDates(userId: string, row: ExpectedRow, source: LivePaymentSource | null, paidOn: ISODate | null | undefined, today: ISODate) {
  const cycle = { statementDay: source?.statement_day, dueDay: source?.due_day };
  if (row.direction !== "out" || source?.type !== "credit_card" || !isValidCardCycle(cycle)) {
    return { purchaseDate: null, effectiveDate: confirmEffectiveDate(row.due_date, today, paidOn), cardStatementId: null, statementWrites: [] };
  }
  const purchaseDate = paidOn ?? row.due_date;
  const period = statementForPurchase(purchaseDate, cycle);
  const statementWrite = await cardStatementWrite(userId, source.id, period);
  return { purchaseDate, effectiveDate: period.dueDate, cardStatementId: String(statementWrite.row.id), statementWrites: [statementWrite] };
}

/**
 * Only a payment made today may take the live market quote; a backdated one
 * takes the last official rate on or before its day. Storing a foreign amount
 * as lira would corrupt the balance, so no rate refuses the confirmation.
 */
function confirmationRate(userId: string, currency: string, rateDate: ISODate, today: ISODate): number | null {
  if (currency === "TRY") return null;
  const rate = (rateDate === today ? marketSellRateTry(currency) : null) ?? lookupRate(userId, currency, rateDate)?.rate.rateTry;
  if (rate == null) throw new FxRateUnavailableError(currency);
  return rate;
}

/**
 * Confirm an expected item: creates the realized transaction, marks paid and
 * advances the subscription's next due date. `actualAmountMinor` lets the
 * user correct the real amount (salary varies month to month).
 */
export async function confirmExpected(userId: string, expectedId: string, opts: ConfirmOptions): Promise<void> {
  const row = await getExpectedRow(userId, expectedId);
  if (!isOpen(row)) return;
  const amount = opts.actualAmountMinor ?? row.amount_minor;
  if (!isSupportedMinorAmount(amount, false)) throw new Error("Invalid expected payment amount");
  if (!isISODate(row.due_date) || (opts.paidOn != null && !isISODate(opts.paidOn))) throw new Error("Invalid expected payment date");
  const rule = await liveRule(userId, row);
  const personId = confirmingPerson(row, rule, opts);
  await assertLiveTransactionPerson(userId, personId);
  const categoryId = opts.categoryId ?? (rule?.category_id == null ? null : String(rule.category_id));
  const type = row.direction === "in" ? "income" : "expense";
  await assertTransactionCategory(userId, type, categoryId, true);
  const subscription = row.kind === "subscription" ? rule : null;
  const paymentSourceId = subscription?.payment_source_id == null ? null : String(subscription.payment_source_id);
  const source = await livePaymentSource(userId, paymentSourceId);
  if (paymentSourceId && !source) throw new Error("Expected payment source does not exist");
  const today = todayISO();
  const { statementWrites, purchaseDate, effectiveDate, cardStatementId } = await confirmationDates(userId, row, source, opts.paidOn, today);
  const appliedRate = confirmationRate(userId, row.currency, purchaseDate ?? effectiveDate, today);
  const amountTryMinor = appliedRate == null ? amount : convertToTryMinor(amount, appliedRate);
  assertSignedTransactionAmounts(amount, amountTryMinor);
  // Deterministic: a double tap, or two devices auto-confirming one item, upserts one transaction.
  const txId = await deterministicId(naturalKeys.confirmTx(row.id));

  await writeRows(userId, [
    ...statementWrites,
    {
      table: "transactions",
      row: {
        id: txId,
        type,
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
        personId,
        installmentPlanId: null,
        installmentNo: null,
        cardStatementId,
        subscriptionId: subscription ? row.ref_id : null,
        isAggregate: false,
        note: null,
        // Confirming an expectation is not hand entry: the matching flow and
        // duplicate review both need to tell the two apart.
        origin: "expected",
        importKey: null,
        deletedAt: null,
      },
    },
    ...settledExpectedWrites(row, subscription, { transactionId: txId, amountMinor: amount, auto: opts.auto ?? false }),
  ], !opts.auto);
}

/** The writes that record `row` paid by a transaction, moving its subscription past it. */
export function settledExpectedWrites(
  row: ExpectedRow,
  subscription: Record<string, unknown> | null,
  payment: { transactionId: string; amountMinor: Minor; auto: boolean },
): RowWrite[] {
  const writes: RowWrite[] = [{
    table: "expected_payments",
    row: {
      ...fromDbShape("expected_payments", row),
      amountMinor: payment.amountMinor,
      amountIsEstimated: false,
      status: "paid",
      paidAt: nowIso(),
      autoConfirmed: payment.auto,
      transactionId: payment.transactionId,
    },
  }];
  if (subscription && String(subscription.next_due_date) <= row.due_date) {
    writes.push({
      table: "subscriptions",
      row: {
        ...fromDbShape("subscriptions", subscription),
        nextDueDate: advanceDueDate(row.due_date, Number(subscription.interval_months), Number(subscription.billing_day)),
      },
    });
  }
  return writes;
}

/** A subscription's expected payment in any state, with its rule when that still exists. */
export async function subscriptionPayment(
  userId: string,
  expectedId: string,
): Promise<{ row: ExpectedRow; subscription: Record<string, unknown> | null } | null> {
  const row = await getExpectedRow(userId, expectedId);
  return row?.kind === "subscription" ? { row, subscription: await liveRule(userId, row) } : null;
}

/** Save the invoice amount for a variable subscription without confirming it. */
export async function setExpectedAmount(userId: string, expectedId: string, amountMinor: Minor): Promise<void> {
  const row = await getExpectedRow(userId, expectedId);
  if (!isOpen(row)) return;
  if (!isSupportedMinorAmount(amountMinor, false)) throw new Error("Invalid expected payment amount");
  if (row.kind !== "subscription") throw new Error("Only subscription amounts can be edited");
  const subscription = await liveRule(userId, row);
  if (!subscription) throw new Error("Expected payment source rule does not exist");
  if (subscription.amount_mode !== "variable") throw new Error("Only variable subscription amounts can be edited");
  await writeRows(userId, [{
    table: "expected_payments",
    row: { ...fromDbShape("expected_payments", row), amountMinor, amountIsEstimated: false },
  }]);
}

export async function skipExpected(userId: string, expectedId: string): Promise<void> {
  const row = await getExpectedRow(userId, expectedId);
  if (!isOpen(row)) return;
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

/** The subscription moved back to `row`'s due date, when confirming `row` is what moved it past. */
function rewoundSubscriptionWrite(row: ExpectedRow, subscription: Record<string, unknown> | null): RowWrite[] {
  const intervalMonths = Number(subscription?.interval_months);
  const billingDay = Number(subscription?.billing_day);
  const advanced = subscription != null && isISODate(row.due_date) && isISODate(subscription.next_due_date)
    && Number.isInteger(intervalMonths) && intervalMonths >= 1 && isMonthDay(billingDay)
    && subscription.next_due_date === advanceDueDate(row.due_date, intervalMonths, billingDay);
  return advanced ? [{ table: "subscriptions", row: { ...fromDbShape("subscriptions", subscription), nextDueDate: row.due_date } }] : [];
}

/** Undo a confirmation: tombstone the created transaction, back to pending. */
export async function revertExpected(userId: string, expectedId: string): Promise<void> {
  const row = await getExpectedRow(userId, expectedId);
  if (row?.status !== "paid") return;
  const transaction = row.transaction_id == null ? null : await (await getSqliteAsync()).getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [row.transaction_id, userId],
  );
  // Only a row THIS confirmation created is removed with it. A transaction the
  // owner recorded and then MATCHED to the expectation is their own record of
  // real money: unlinking it is the whole undo. A row with no origin predates
  // provenance, when a confirmation was the only way to link one.
  const createdByConfirmation = transaction != null && (transaction.origin == null || transaction.origin === "expected");
  await writeRows(userId, [
    ...(createdByConfirmation ? [{ table: "transactions" as const, row: { ...fromDbShape("transactions", transaction), deletedAt: nowIso() } }] : []),
    {
      table: "expected_payments",
      row: { ...fromDbShape("expected_payments", row), status: "pending", paidAt: null, transactionId: null, autoConfirmed: false },
    },
    ...(row.kind === "subscription" ? rewoundSubscriptionWrite(row, await liveRule(userId, row)) : []),
  ]);
}
