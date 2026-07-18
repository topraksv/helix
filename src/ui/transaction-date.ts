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
