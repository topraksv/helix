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
