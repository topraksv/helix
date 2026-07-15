/**
 * Domain-level types. Plain data shapes decoupled from the DB layer so the
 * engines stay pure and unit-testable. The DB layer maps rows into these.
 */

import type { ISODate, MonthKey } from "./dates";
import type { Minor } from "./money";

export type TransactionType = "expense" | "income" | "transfer";
export type CategoryKind = "expense" | "income";
export type TransactionStatus = "pending" | "realized";
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
export type SubscriptionCycle = "monthly" | "yearly" | "custom";
export type ExpectedStatus = "pending" | "paid" | "late" | "skipped";
export type ExpectedDirection = "in" | "out";
export type ExpectedKind = "subscription" | "installment" | "loan" | "recurring_income";
export type PlanKind = "card_installment" | "loan";

/** The slice of a transaction the engines need. */
export interface TxLike {
  id: string;
  type: TransactionType;
  amountTryMinor: Minor;
  effectiveDate: ISODate;
  status: TransactionStatus;
  categoryId: string | null;
  /** Kind of the referenced live/legacy category. Used to normalize records
   *  created by older clients that allowed type/category mismatches. */
  categoryKind: CategoryKind | null;
  paymentSourceId: string | null;
  personIsSelf: boolean;
  installmentPlanId: string | null;
  subscriptionId: string | null;
  isAggregate: boolean;
}

export interface AdjustmentLike {
  date: ISODate;
  amountMinor: Minor; // signed: positive raises the balance
}

export interface SubscriptionLike {
  id: string;
  name: string;
  amountMinor: Minor;
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
  currency: string;
  status: ExpectedStatus;
}
