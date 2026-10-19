import { monthKeyOf } from "../domain/dates";
import { dateLabel, monthLabel, tr } from "../i18n/tr";

interface TransactionDateDisplay {
  purchaseDate?: string | null;
  effectiveDate: string;
  isAggregate: boolean;
  installmentPlanId: string | null;
}

/** One date hierarchy for every transaction list. */
export function transactionDateText(transaction: TransactionDateDisplay): string {
  // A month-only card charge carries the statement's closing date as its
  // purchase day, and printing that day would claim a date nobody entered.
  if (transaction.isAggregate && transaction.purchaseDate) {
    return tr.tx.cardMonthAndDue(
      monthLabel(monthKeyOf(transaction.purchaseDate)),
      dateLabel(transaction.effectiveDate),
    );
  }
  if (transaction.purchaseDate) {
    return tr.tx.cardPurchaseAndDue(
      dateLabel(transaction.purchaseDate),
      dateLabel(transaction.effectiveDate),
    );
  }
  if (transaction.isAggregate || transaction.installmentPlanId) {
    return monthLabel(monthKeyOf(transaction.effectiveDate));
  }
  return dateLabel(transaction.effectiveDate);
}

/** The line under a ledger row: its date, then instalment, month total, statement payment and, for someone else's row, whose. */
export function transactionRowDetail(
  transaction: TransactionDateDisplay & { installmentNo: number | null; settledOn?: string | null },
  otherPersonName?: string | null,
): string {
  return [
    transactionDateText(transaction),
    transaction.installmentNo ? tr.installments.nthInstallment(transaction.installmentNo) : null,
    transaction.isAggregate ? tr.bulk.aggregateBadge : null,
    transaction.settledOn ? tr.cashflow.statementPaidOn(dateLabel(transaction.settledOn)) : null,
    otherPersonName,
  ].filter((part) => part != null).join("  ·  ");
}
