import type { SQLiteDatabase } from "expo-sqlite";
import type { RowWrite } from "../../db/mutations";
import { isISODate, todayISO } from "../../domain/dates";
import {
  buildInvestmentState,
  InvestmentDomainError,
  resolveInvestmentQuote,
  type InvestmentAssetType,
  type InvestmentOperationKind,
  type InvestmentState,
} from "../../domain/investments";
import { isSupportedMinorAmount } from "../../domain/money";
import { textLength } from "../../domain/input";

type AnyRow = Record<string, unknown>;

function live(row: AnyRow): boolean {
  return ("deletedAt" in row ? row.deletedAt : row.deleted_at) == null;
}

function value<T>(row: AnyRow, camel: string, snake: string): T {
  return (camel in row ? row[camel] : row[snake]) as T;
}

function overlay(rows: AnyRow[], writes: readonly RowWrite[], table: RowWrite["table"]): AnyRow[] {
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  for (const write of writes) {
    if (write.table !== table) continue;
    const previous = byId.get(String(write.row.id)) ?? {};
    byId.set(String(write.row.id), { ...previous, ...write.row });
  }
  return [...byId.values()];
}

/** Replays the complete proposed owner graph inside the pending SQLite
 * transaction. It is intentionally the same projector used by the UI and
 * sale writer: a route cannot weaken this by constructing rows directly. */
export async function assertInvestmentWrites(
  sqlite: SQLiteDatabase,
  userId: string,
  writes: readonly RowWrite[],
  force = false,
  validateStoredSaleResults = true,
): Promise<InvestmentState | null> {
  const relevant = new Set([
    "investment_profiles",
    "investment_products",
    "investment_operations",
    "transactions",
    "categories",
    "persons",
  ]);
  if (!force && !writes.some((write) => relevant.has(write.table))) return null;

  const [profileRows, productRows, operationRows, transactionRows, categoryRows, personRows] = await Promise.all([
    sqlite.getAllAsync<AnyRow>("SELECT * FROM investment_profiles WHERE user_id = ?", [userId]),
    sqlite.getAllAsync<AnyRow>("SELECT * FROM investment_products WHERE user_id = ?", [userId]),
    sqlite.getAllAsync<AnyRow>("SELECT * FROM investment_operations WHERE user_id = ?", [userId]),
    sqlite.getAllAsync<AnyRow>("SELECT * FROM transactions WHERE user_id = ?", [userId]),
    sqlite.getAllAsync<AnyRow>("SELECT * FROM categories WHERE user_id = ?", [userId]),
    sqlite.getAllAsync<AnyRow>("SELECT * FROM persons WHERE user_id = ?", [userId]),
  ]);

  const profiles = overlay(profileRows, writes, "investment_profiles").filter(live);
  if (profiles.length === 0) {
    const hasLiveInvestmentRows = productRows.some(live) || operationRows.some(live);
    const touchesInvestmentRows = writes.some((write) =>
      write.table === "investment_products" || write.table === "investment_operations"
    );
    if (hasLiveInvestmentRows || touchesInvestmentRows) {
      throw new InvestmentDomainError("unknown_product");
    }
    return null;
  }
  if (profiles.length !== 1) throw new InvestmentDomainError("invalid_money");
  const profile = profiles[0]!;
  const startedOn = value<string>(profile, "startedOn", "started_on");
  const openingCashMinor = value<number>(profile, "openingCashMinor", "opening_cash_minor");
  if (
    !isISODate(startedOn)
    || startedOn > todayISO()
    || !isSupportedMinorAmount(openingCashMinor)
    || openingCashMinor < 0
  ) {
    throw new InvestmentDomainError("invalid_money");
  }

  const products = overlay(productRows, writes, "investment_products")
    .filter(live)
    .map((row) => {
      const assetType = value<InvestmentAssetType>(row, "assetType", "asset_type");
      const name = typeof row.name === "string" ? row.name.trim() : "";
      if (!["metal", "currency", "equity", "fund", "crypto", "pension"].includes(assetType) || !name || textLength(name) > 120) {
        throw new InvestmentDomainError("unknown_product");
      }
      return { id: String(row.id), assetType, name };
    });

  const operations = overlay(operationRows, writes, "investment_operations")
    .filter(live)
    .map((row) => {
      const kind = row.kind as InvestmentOperationKind;
      const operationDate = value<string>(row, "operationDate", "operation_date");
      const quantity = (row.quantity as string | null | undefined) ?? null;
      const unitPriceMinor = value<number | null>(row, "unitPriceMinor", "unit_price_minor") ?? null;
      const totalMinor = value<number>(row, "totalMinor", "total_minor");
      if (!["existing", "buy", "sell", "contribution"].includes(kind) || !isISODate(operationDate) || operationDate > todayISO()) {
        throw new InvestmentDomainError("invalid_money");
      }
      if (quantity == null) {
        if (unitPriceMinor != null) throw new InvestmentDomainError("invalid_quantity");
      } else {
        resolveInvestmentQuote({ quantity, unitPriceMinor, totalMinor });
      }
      return {
        id: String(row.id),
        productId: value<string>(row, "productId", "product_id"),
        kind,
        operationDate,
        quantity,
        unitPriceMinor,
        totalMinor,
        storedCostBasisMinor: value<number>(row, "costBasisMinor", "cost_basis_minor") ?? 0,
        storedRealizedProfitLossMinor:
          value<number>(row, "realizedProfitLossMinor", "realized_profit_loss_minor") ?? 0,
      };
    });

  const categories = overlay(categoryRows, writes, "categories").filter(live);
  const people = overlay(personRows, writes, "persons");
  const selfPersonIds = new Set(
    people
      .filter(live)
      .filter((row) => Boolean(value<boolean | number>(row, "isSelf", "is_self")))
      .map((row) => String(row.id)),
  );
  const transferIds = new Set(
    categories
      .filter((row) => Boolean(value<boolean | number>(row, "isTransfer", "is_transfer")))
      .map((row) => String(row.id)),
  );
  const today = todayISO();
  const cashEvents = overlay(transactionRows, writes, "transactions")
    .filter(live)
    .filter((row) =>
      row.type === "transfer"
      && row.status === "realized"
      && transferIds.has(value<string>(row, "categoryId", "category_id"))
      && selfPersonIds.has(String(value<string>(row, "personId", "person_id")))
      && value<string>(row, "effectiveDate", "effective_date") <= today,
    )
    .map((row) => ({
      id: String(row.id),
      date: value<string>(row, "effectiveDate", "effective_date"),
      amountMinor: value<number>(row, "amountTryMinor", "amount_try_minor"),
    }));

  const state = buildInvestmentState({
    startedOn,
    openingCashMinor,
    products,
    operations,
    cashEvents,
  });
  for (const operation of operations) {
    if (!validateStoredSaleResults) continue;
    if (operation.kind !== "sell") {
      if (operation.storedCostBasisMinor !== 0 || operation.storedRealizedProfitLossMinor !== 0) {
        throw new InvestmentDomainError("invalid_money");
      }
      continue;
    }
    const result = state.operationResults.get(operation.id);
    if (
      !result
      || result.costBasisMinor !== operation.storedCostBasisMinor
      || result.realizedProfitLossMinor !== operation.storedRealizedProfitLossMinor
    ) {
      throw new InvestmentDomainError("quote_inconsistent");
    }
  }
  return state;
}

export function projectInvestmentWrites(
  sqlite: SQLiteDatabase,
  userId: string,
  writes: readonly RowWrite[],
): Promise<InvestmentState | null> {
  return assertInvestmentWrites(sqlite, userId, writes, true, false);
}
