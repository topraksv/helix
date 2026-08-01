import { todayISO } from "./dates";
import { buildInvestmentState, type InvestmentAssetType, type InvestmentOperationKind, type InvestmentState } from "./investments";

interface ProfileProjectionInput {
  startedOn: string;
  openingCashMinor: number;
}

interface ProductProjectionInput {
  id: string;
  assetType: InvestmentAssetType;
  name: string;
}

interface OperationProjectionInput {
  id: string;
  productId: string;
  kind: InvestmentOperationKind;
  operationDate: string;
  quantity: string | null;
  unitPriceMinor: number | null;
  totalMinor: number;
}

interface TransactionProjectionInput {
  id: string;
  type: string;
  status: string;
  deletedAt: string | null;
  effectiveDate: string;
  categoryId: string | null;
  amountTryMinor: number;
}

interface CategoryProjectionInput {
  id: string;
  isTransfer: boolean;
}

/** One adapter for every UI that displays or changes the investment wallet. */
export function projectInvestmentState(
  profile: ProfileProjectionInput,
  products: readonly ProductProjectionInput[],
  operations: readonly OperationProjectionInput[],
  transactions: readonly TransactionProjectionInput[],
  categories: readonly CategoryProjectionInput[],
): InvestmentState {
  const transferIds = new Set(categories.filter((category) => category.isTransfer).map((category) => category.id));
  const today = todayISO();
  return buildInvestmentState({
    startedOn: profile.startedOn,
    openingCashMinor: profile.openingCashMinor,
    products,
    operations,
    cashEvents: transactions
      .filter((transaction) =>
        transaction.type === "transfer"
        && transaction.status === "realized"
        && transaction.deletedAt == null
        && transaction.effectiveDate <= today
        && transaction.categoryId != null
        && transferIds.has(transaction.categoryId),
      )
      .map((transaction) => ({
        id: transaction.id,
        date: transaction.effectiveDate,
        amountMinor: transaction.amountTryMinor,
      })),
  });
}
