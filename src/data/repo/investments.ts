import { getSqliteAsync } from "../../db/client";
import { deterministicId, naturalKeys, newId } from "../../db/ids";
import {
  assertLiveRow,
  assertRestorableRows,
  fromDbShape,
  nowIso,
  writeRowsValidated,
  type RowWrite,
} from "../../db/mutations";
import { isISODate, todayISO, type ISODate } from "../../domain/dates";
import {
  InvestmentDomainError,
  resolveInvestmentQuote,
  type InvestmentAssetType,
  type InvestmentOperationKind,
  type InvestmentQuoteInput,
} from "../../domain/investments";
import { assertSupportedMinorAmount, type Minor } from "../../domain/money";
import { assertInputWithinLimit, textLength } from "../../domain/input";
import type { SQLiteDatabase } from "expo-sqlite";
import { categoryRow } from "./categories";
import {
  assertInvestmentWrites,
  projectInvestmentWrites,
} from "./investment-validation";

export interface InvestmentSetupInput {
  startedOn: ISODate;
  openingCashMinor: Minor;
}

export interface InvestmentProductInput {
  id?: string;
  assetType: InvestmentAssetType;
  name: string;
  marketCode?: string | null;
  note?: string | null;
}

export interface InvestmentOperationInput extends InvestmentQuoteInput {
  id?: string;
  productId: string;
  kind: InvestmentOperationKind;
  operationDate: ISODate;
  note?: string | null;
}

function validateDate(date: string): asserts date is ISODate {
  // Its own code: the screen maps a code to a sentence, and a future date is not an amount error.
  if (!isISODate(date) || date > todayISO()) throw new InvestmentDomainError("invalid_date");
}

export async function setupInvestments(userId: string, input: InvestmentSetupInput): Promise<void> {
  validateDate(input.startedOn);
  assertSupportedMinorAmount(input.openingCashMinor);
  if (input.openingCashMinor < 0) throw new InvestmentDomainError("invalid_money");
  const id = await deterministicId(naturalKeys.investmentProfile(userId));
  const sqlite = await getSqliteAsync();
  const existing = await sqlite.getFirstAsync<Record<string, unknown>>(
    "SELECT started_on, opening_cash_minor FROM investment_profiles WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    [id, userId],
  );
  if (existing) {
    if (
      existing.started_on === input.startedOn
      && Number(existing.opening_cash_minor) === input.openingCashMinor
    ) return;
    // Opening cash is a starting fact; rewriting it after journal rows exist changes history.
    throw new InvestmentDomainError("invalid_operation");
  }
  const writes: RowWrite[] = [{
    table: "investment_profiles",
    row: {
      id,
      startedOn: input.startedOn,
      openingCashMinor: input.openingCashMinor,
      deletedAt: null,
    },
  }];
  await writeRowsValidated(
    userId,
    writes,
    (sqlite) => assertInvestmentWrites(sqlite, userId, writes).then(() => undefined),
  );
}

export async function saveInvestmentProduct(userId: string, input: InvestmentProductInput): Promise<string> {
  const name = input.name.trim();
  if (!name || textLength(name) > 120) throw new InvestmentDomainError("unknown_product");
  assertInputWithinLimit(input.note ?? null, "note");
  const id = input.id ?? newId();
  const sqlite = await getSqliteAsync();
  const previous = input.id
    ? await sqlite.getFirstAsync<Record<string, unknown>>(
        "SELECT * FROM investment_products WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
        [input.id, userId],
      )
    : null;
  if (input.id && !previous) throw new InvestmentDomainError("unknown_product");
  const writes: RowWrite[] = [{
    table: "investment_products",
    row: {
      ...(previous ? fromDbShape("investment_products", previous) : {}),
      id,
      assetType: input.assetType,
      name,
      marketCode: input.marketCode?.trim() || null,
      note: input.note?.trim() || null,
      // Carried, never set: old clients and backups still hold it.
      targetWeightBp: previous?.target_weight_bp ?? null,
      deletedAt: null,
    },
  }];
  await writeRowsValidated(
    userId,
    writes,
    async (db) => {
      if (input.id) await assertLiveRow(db, "investment_products", userId, input.id);
      await assertInvestmentWrites(db, userId, writes);
    },
  );
  return id;
}

async function selectedInvestmentRefunds(
  sqlite: SQLiteDatabase,
  userId: string,
  transactionIds: readonly string[],
  firstSaleDate: ISODate | null,
): Promise<Record<string, unknown>[]> {
  const uniqueIds = [...new Set(transactionIds)];
  if (uniqueIds.length !== transactionIds.length || uniqueIds.some((id) => !id)) {
    throw new InvestmentDomainError("invalid_operation");
  }
  if (uniqueIds.length === 0) return [];
  // A transfer before the product's first sale cannot be sale proceeds; the UI applies the same boundary.
  if (!firstSaleDate) throw new InvestmentDomainError("invalid_operation");
  const rows = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT t.*
       FROM transactions t
       JOIN investment_profiles p
         ON p.user_id = t.user_id AND p.deleted_at IS NULL
       JOIN categories c
         ON c.id = t.category_id AND c.user_id = t.user_id
        AND c.deleted_at IS NULL AND c.is_transfer = 1
       JOIN persons person
         ON person.id = t.person_id AND person.user_id = t.user_id
        AND person.deleted_at IS NULL AND person.is_self = 1
      WHERE t.user_id = ?
        AND t.id IN (${uniqueIds.map(() => "?").join(", ")})
        AND t.deleted_at IS NULL
        AND t.type = 'transfer'
        AND t.status = 'realized'
        AND t.amount_try_minor < 0
        AND t.effective_date >= p.started_on
        AND t.effective_date BETWEEN ? AND ?`,
    [userId, ...uniqueIds, firstSaleDate, todayISO()],
  );
  if (rows.length !== uniqueIds.length) throw new InvestmentDomainError("invalid_operation");
  return rows;
}

/**
 * Remove one erroneous product journal and only the transfers the user names as its proceeds.
 * A transfer has no persisted product link, so guessing could delete a legitimate record; the
 * proposed graph is replayed before any tombstone commits.
 */
export async function removeInvestmentProductHistory(
  userId: string,
  productId: string,
  transactionIds: readonly string[],
): Promise<boolean> {
  const sqlite = await getSqliteAsync();
  const product = await sqlite.getFirstAsync<Record<string, unknown>>(
    "SELECT * FROM investment_products WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    [productId, userId],
  );
  if (!product) return false;
  const operations = await sqlite.getAllAsync<Record<string, unknown>>(
    "SELECT * FROM investment_operations WHERE product_id = ? AND user_id = ? AND deleted_at IS NULL",
    [productId, userId],
  );
  const firstSaleDate = operations.reduce<ISODate | null>((earliest, operation) => {
    const date = operation.operation_date;
    if (operation.kind !== "sell" || typeof date !== "string" || !isISODate(date)) return earliest;
    return earliest == null || date < earliest ? date : earliest;
  }, null);
  const refunds = await selectedInvestmentRefunds(sqlite, userId, transactionIds, firstSaleDate);
  const deletedAt = nowIso();
  const writes: RowWrite[] = [
    { table: "investment_products", row: { ...fromDbShape("investment_products", product), deletedAt } },
    ...operations.map((row) => ({
      table: "investment_operations" as const,
      row: { ...fromDbShape("investment_operations", row), deletedAt },
    })),
    ...refunds.map((row) => ({
      table: "transactions" as const,
      row: { ...fromDbShape("transactions", row), deletedAt },
    })),
  ];
  await writeRowsValidated(userId, writes, (db) => validateInvestmentMutation(db, userId, writes));
  return true;
}

function operationRow(input: InvestmentOperationInput, id: string): Record<string, unknown> {
  validateDate(input.operationDate);
  assertInputWithinLimit(input.note ?? null, "note");
  const amountOnlyContribution =
    input.kind === "contribution"
    && !input.quantity
    && input.unitPriceMinor == null
    && input.totalMinor != null;
  if (amountOnlyContribution) {
    assertSupportedMinorAmount(input.totalMinor!, false);
    if (input.totalMinor! < 0) throw new InvestmentDomainError("invalid_money");
  }
  const quote = amountOnlyContribution
    ? { quantity: null, unitPriceMinor: null, totalMinor: input.totalMinor }
    : resolveInvestmentQuote(input);
  return {
    id,
    productId: input.productId,
    kind: input.kind,
    operationDate: input.operationDate,
    ...quote,
    costBasisMinor: 0,
    realizedProfitLossMinor: 0,
    note: input.note?.trim() || null,
    importKey: null,
    deletedAt: null,
  };
}

/**
 * Money moved between the ledger and free cash in the same write as the
 * operation it pays for or comes from. Positive funds a purchase; negative
 * takes sale proceeds straight to the ledger.
 */
export interface InvestmentLedgerTransfer {
  amountMinor: Minor;
  /** The ledger's investment item; null creates the suggested one. */
  categoryId: string | null;
  categoryName: string;
  personId: string;
}

async function ledgerTransferWrites(
  sqlite: SQLiteDatabase,
  userId: string,
  transfer: InvestmentLedgerTransfer,
  operationDate: ISODate,
): Promise<RowWrite[]> {
  // Zero is refused by the direction check before this; the range is what is asserted here.
  assertSupportedMinorAmount(transfer.amountMinor);
  const profile = await sqlite.getFirstAsync<{ started_on: string }>(
    "SELECT started_on FROM investment_profiles WHERE user_id = ? AND deleted_at IS NULL",
    [userId],
  );
  if (!profile) throw new InvestmentDomainError("invalid_operation");
  // Free cash counts transfers from the wallet's first day; one dated earlier would leave the ledger and never arrive.
  const date = operationDate < profile.started_on ? profile.started_on as ISODate : operationDate;
  const writes: RowWrite[] = [];
  let categoryId = transfer.categoryId;
  if (!categoryId) {
    const seedId = await deterministicId(naturalKeys.seedCategory(userId, transfer.categoryName));
    // The seed's id may hold the owner's own item, renamed or no longer an investment; rewriting it would turn its expenses into transfers.
    const seedTaken = await sqlite.getFirstAsync<{ id: string }>(
      "SELECT id FROM categories WHERE id = ? AND deleted_at IS NULL",
      [seedId],
    );
    categoryId = seedTaken ? newId() : seedId;
    const maxOrder = await sqlite.getFirstAsync<{ max_order: number | null }>(
      "SELECT MAX(sort_order) AS max_order FROM categories WHERE user_id = ? AND deleted_at IS NULL",
      [userId],
    );
    writes.push({
      table: "categories",
      row: categoryRow(categoryId, {
        name: transfer.categoryName,
        kind: "expense",
        icon: "📈",
        sortOrder: (maxOrder?.max_order ?? -1) + 1,
        isColumn: true,
        isTransfer: true,
      }),
    });
  }
  writes.push({
    table: "transactions",
    row: {
      id: newId(),
      type: "transfer",
      amountMinor: transfer.amountMinor,
      currency: "TRY",
      fxRate: null,
      amountTryMinor: transfer.amountMinor,
      purchaseDate: null,
      effectiveDate: date,
      cardStatementId: null,
      categoryId,
      paymentSourceId: null,
      personId: transfer.personId,
      note: null,
      isAggregate: false,
      subscriptionId: null,
      origin: "manual",
      importKey: null,
      refundOfTransactionId: null,
      installmentPlanId: null,
      installmentNo: null,
      entryDate: todayISO(),
      status: "realized",
      deletedAt: null,
    },
  });
  return writes;
}

async function writeOperation(userId: string, row: Record<string, unknown>, transfer?: InvestmentLedgerTransfer): Promise<void> {
  const sqlite = await getSqliteAsync();
  const writes: RowWrite[] = [
    ...(transfer ? await ledgerTransferWrites(sqlite, userId, transfer, row.operationDate as ISODate) : []),
    { table: "investment_operations", row },
  ];
  await writeRowsValidated(userId, writes, async (db) => {
    if (transfer) {
      const person = await db.getFirstAsync<{ is_self: number }>(
        "SELECT is_self FROM persons WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
        [transfer.personId, userId],
      );
      if (person?.is_self !== 1) throw new InvestmentDomainError("invalid_operation");
      if (transfer.categoryId) {
        const category = await db.getFirstAsync<{ is_transfer: number }>(
          "SELECT is_transfer FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
          [transfer.categoryId, userId],
        );
        if (category?.is_transfer !== 1) throw new InvestmentDomainError("invalid_operation");
      }
    }
    await validateInvestmentMutation(db, userId, writes);
  });
}

async function applySaleResults(
  sqlite: SQLiteDatabase,
  userId: string,
  writes: RowWrite[],
  results: Map<string, { costBasisMinor: Minor; realizedProfitLossMinor: number }>,
): Promise<void> {
  const byId = new Map(
    writes
      .filter((write) => write.table === "investment_operations")
      .map((write) => [String(write.row.id), write]),
  );
  const existing = await sqlite.getAllAsync<Record<string, unknown>>(
    "SELECT * FROM investment_operations WHERE user_id = ? AND kind = 'sell' AND deleted_at IS NULL",
    [userId],
  );
  const ids = new Set([...existing.map((row) => String(row.id)), ...results.keys()]);
  for (const id of ids) {
    const result = results.get(id);
    if (!result) continue;
    const pending = byId.get(id);
    if (pending) {
      pending.row.costBasisMinor = result.costBasisMinor;
      pending.row.realizedProfitLossMinor = result.realizedProfitLossMinor;
      continue;
    }
    const row = existing.find((candidate) => candidate.id === id);
    if (!row) continue;
    const currentCost = Number(row.cost_basis_minor);
    const currentResult = Number(row.realized_profit_loss_minor);
    if (currentCost === result.costBasisMinor && currentResult === result.realizedProfitLossMinor) continue;
    const correction: RowWrite = {
      table: "investment_operations",
      row: {
        ...fromDbShape("investment_operations", row),
        costBasisMinor: result.costBasisMinor,
        realizedProfitLossMinor: result.realizedProfitLossMinor,
      },
    };
    writes.push(correction);
    byId.set(id, correction);
  }
}

async function validateInvestmentMutation(
  sqlite: SQLiteDatabase,
  userId: string,
  writes: RowWrite[],
  restoring = false,
): Promise<void> {
  if (restoring) await assertRestorableRows(sqlite, userId, writes);
  const projected = await projectInvestmentWrites(sqlite, userId, writes);
  if (!projected) throw new InvestmentDomainError("unknown_product");
  await applySaleResults(sqlite, userId, writes, projected.operationResults);
  await assertInvestmentWrites(sqlite, userId, writes);
}

export async function addInvestmentOperation(
  userId: string,
  input: InvestmentOperationInput,
  transfer?: InvestmentLedgerTransfer,
): Promise<string> {
  // A purchase is funded into free cash and a sale is taken out of it; the other directions would be a typo.
  const direction = input.kind === "sell" ? -1 : input.kind === "buy" || input.kind === "contribution" ? 1 : 0;
  if (transfer && (direction === 0 || Math.sign(transfer.amountMinor) !== direction)) {
    throw new InvestmentDomainError("invalid_operation");
  }
  const id = input.id ?? newId();
  await writeOperation(userId, operationRow(input, id), transfer);
  return id;
}

export async function updateInvestmentOperation(
  userId: string,
  id: string,
  input: Omit<InvestmentOperationInput, "id" | "importKey">,
): Promise<void> {
  const sqlite = await getSqliteAsync();
  const previous = await sqlite.getFirstAsync<Record<string, unknown>>(
    "SELECT * FROM investment_operations WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    [id, userId],
  );
  if (!previous) throw new InvestmentDomainError("unknown_product");
  const next = {
    ...fromDbShape("investment_operations", previous),
    ...operationRow(input, id),
    importKey: previous.import_key ?? null,
  };
  await writeOperation(userId, next);
}

export async function deleteInvestmentOperation(
  userId: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const sqlite = await getSqliteAsync();
  const previous = await sqlite.getFirstAsync<Record<string, unknown>>(
    "SELECT * FROM investment_operations WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    [id, userId],
  );
  if (!previous) return null;
  const writes: RowWrite[] = [{
    table: "investment_operations",
    row: { ...fromDbShape("investment_operations", previous), deletedAt: nowIso() },
  }];
  await writeRowsValidated(userId, writes, (db) => validateInvestmentMutation(db, userId, writes));
  return previous;
}

export async function restoreInvestmentOperation(
  userId: string,
  snapshot: Record<string, unknown>,
): Promise<void> {
  const writes: RowWrite[] = [{
    table: "investment_operations",
    row: { ...fromDbShape("investment_operations", snapshot), deletedAt: null },
  }];
  await writeRowsValidated(
    userId,
    writes,
    (db) => validateInvestmentMutation(db, userId, writes, true),
  );
}
