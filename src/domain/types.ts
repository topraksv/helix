/**
 * Domain-level types. Plain data shapes decoupled from the DB layer so the
 * engines stay pure and unit-testable. The DB layer maps rows into these.
 */

import type { ISODate, MonthKey } from "./dates";
import type { Minor } from "./money";

export type TransactionType = "expense" | "income" | "transfer";
export type CategoryKind = "expense" | "income";
export type TransactionStatus = "pending" | "realized";
/**
 * Where a transaction came from. Absent on every row written before
 * provenance existed, which reads as "unknown" and never as "typed by hand".
 */
export const TRANSACTION_ORIGINS = ["manual", "spreadsheet", "statement", "expected"] as const;
export type TransactionOrigin = (typeof TRANSACTION_ORIGINS)[number];
export type PaymentSourceType =
  | "credit_card"
  | "debit_card"
  | "virtual_card"
  | "e_wallet"
  | "cash"
  | "direct_debit"
  | "bank_transfer";

export const PAYMENT_SOURCE_TYPES: readonly PaymentSourceType[] = [
  "credit_card",
  "debit_card",
  "virtual_card",
  "e_wallet",
  "cash",
  "direct_debit",
  "bank_transfer",
];
type SubscriptionCycle = "monthly" | "yearly" | "custom";
type ExpectedStatus = "pending" | "paid" | "late" | "skipped";
type ExpectedDirection = "in" | "out";
/** Active expected-payment producers. Installment plans materialize transactions directly. */
export const EXPECTED_PAYMENT_KINDS = ["subscription", "recurring_income"] as const;
export type ExpectedKind = (typeof EXPECTED_PAYMENT_KINDS)[number];
/** Compatibility values accepted only on retired tombstones during restore. */
export const LEGACY_EXPECTED_PAYMENT_KINDS = ["installment", "loan"] as const;
type PlanKind = "card_installment" | "loan";

/** The slice of a transaction the engines need. */
export interface TxLike {
  id: string;
  type: TransactionType;
  amountTryMinor: Minor;
  purchaseDate?: ISODate | null;
  effectiveDate: ISODate;
  status: TransactionStatus;
  categoryId: string | null;
  /** Kind of the referenced live/legacy category. Used to normalize records
   *  created by older clients that allowed type/category mismatches. */
  categoryKind: CategoryKind | null;
  paymentSourceId: string | null;
  personIsSelf: boolean;
  installmentPlanId: string | null;
  cardStatementId?: string | null;
  subscriptionId: string | null;
  isAggregate: boolean;
  /**
   * The row a workbook import writes for what is left of a column once its
   * instalments are listed. It keeps the column's total equal to the file, and
   * it is not spending: a negative one reads as a refund. Absent reads as false.
   */
  isWorkbookRemainder?: boolean;
}

/** How the owner described a recorded statement payment. */
export type StatementPaymentKind = "full" | "minimum" | "partial";

export interface StatementPaymentLike {
  id: string;
  statementId: string;
  paidOn: ISODate;
  /** Positive TRY minor units. */
  amountMinor: Minor;
  kind: StatementPaymentKind;
}

/**
 * A movement the balance makes because a statement was paid by hand rather
 * than on its due date. Never spending: charges stay the categorised rows, and
 * these lines only move WHEN their money leaves the account.
 *
 * - `owed`: what is still unpaid, given back on the due date, where the charges
 *   would otherwise have taken all of it.
 * - `payment`: a payment, on the day it was made.
 * - `paidElsewhere`: a payment made on another day, given back on the day its
 *   charges are counted, so it is not taken twice.
 */
export interface SettlementFlow {
  statementId: string;
  date: ISODate;
  /** Signed balance effect. */
  amountMinor: Minor;
  kind: "owed" | "payment" | "paidElsewhere";
  /** Not yet in the balance: dated after today, or beside charges still pending. */
  planned: boolean;
}

export interface CardStatementLike {
  id: string;
  paymentSourceId: string;
  periodMonth: MonthKey;
  statementDate: ISODate;
  dueDate: ISODate;
}

export interface AdjustmentLike {
  /** Present on stored rows; the configured anchor, read as a declaration, has none. */
  id?: string;
  date: ISODate;
  amountMinor: Minor; // signed: positive raises the balance
  /**
   * A declared balance rather than a movement: at the END of `date` the balance
   * was this figure (spec §2.7). `amountMinor` then holds the difference it made
   * when it was written, for a client that predates declarations; the ledger
   * recomputes that difference from the rows as they stand now.
   */
  declaredMinor?: Minor | null;
}

export interface SubscriptionLike {
  id: string;
  name: string;
  amountMinor: Minor;
  /** Omitted legacy fixtures/rows are fixed by contract. */
  amountMode?: "fixed" | "variable";
  currency: string;
  cycle: SubscriptionCycle;
  intervalMonths: number; // 1 for monthly, 12 for yearly, n for custom
  billingDay: number; // nominal day (may exceed short months; clamped per month)
  nextDueDate: ISODate;
  isActive: boolean;
  autoPay: boolean;
  personIsSelf: boolean;
  trialEndDate: ISODate | null;
}

export interface RecurringIncomeLike {
  id: string;
  name: string;
  defaultAmountMinor: Minor;
  currency: string;
  payDay: number; // nominal day of month, clamped per month
  recurrence?: "monthly" | "weekly" | "biweekly";
  anchorDate?: ISODate | null;
  isActive: boolean;
  personIsSelf: boolean;
}

export interface InstallmentPlanLike {
  id: string;
  kind: PlanKind;
  startMonth: MonthKey;
  installmentCount: number;
  totalAmountMinor: Minor | null; // card installments: split total
  monthlyAmountMinor: Minor | null; // loans: fixed monthly amount
  currency: string;
  dueDay: number | null; // nominal payment day within each month
  personIsSelf: boolean;
}

export interface ExpectedPaymentLike {
  id: string;
  direction: ExpectedDirection;
  kind: ExpectedKind;
  refId: string;
  dueDate: ISODate;
  amountMinor: Minor;
  /** Omitted legacy fixtures/rows are known amounts. */
  amountIsEstimated?: boolean;
  currency: string;
  status: ExpectedStatus;
}
