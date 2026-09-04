import { getSqliteAsync } from "../../db/client";
import { deterministicId, naturalKeys, newId } from "../../db/ids";
import {
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
  /**
   * Intended share of the portfolio in basis points, or null to remove it.
   * `undefined` keeps whatever is stored — see the write below.
   */
}

export interface InvestmentOperationInput extends InvestmentQuoteInput {
  id?: string;
  productId: string;
  kind: InvestmentOperationKind;
  operationDate: ISODate;
  note?: string | null;
}

function validateDate(date: string): asserts date is ISODate {
  // Its own code: the screen turns a code into a sentence, and a date the
  // owner cannot have reached yet was being reported as an amount over the
  // ceiling — a sentence about a figure the form never held.
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
    // Opening cash is a starting fact, not a current-balance control. Rewriting
    // it after journal rows exist changes prior history instead of correcting it.
    throw new InvestmentDomainError("invalid_operation");
  }
  const writes: RowWrite[] = [{
    table: "investment_profiles",
    row: {
      id,
      startedOn: input.startedOn,
      openingCashMinor: input.openingCashMinor,
      setupCompleted: true,
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
        "SELECT * FROM investment_products WHERE id = ? AND user_id = ?",
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
      // The target-allocation feature was removed. The column stays so a
      // client that still has one, and every backup already written, round-trip
      // unchanged — but nothing sets it any more, so an existing value is
      // carried and never invented.
      targetWeightBp: previous?.target_weight_bp ?? null,
      deletedAt: null,
    },
  }];
  await writeRowsValidated(
    userId,
    writes,
    (db) => assertInvestmentWrites(db, userId, writes).then(() => undefined),
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
  // A ledger transfer before the product's first sale cannot be sale proceeds.
  // The UI applies the same boundary; keeping it here prevents a stale client
  // or a direct repository caller from selecting an unrelated transfer.
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
 * Remove one erroneous product journal and only the ledger transfers the user
 * explicitly identifies as created to empty that journal's proceeds.
 *
 * A generic transfer has no persisted causal product link, so guessing would
 * risk deleting a legitimate ledger record. The proposed owner graph is replayed
 * before any tombstone commits; a wrong or insufficient selection leaves every
 * row unchanged.
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
    return {
      id,
      productId: input.productId,
      kind: input.kind,
      operationDate: input.operationDate,
      quantity: null,
      unitPriceMinor: null,
      totalMinor: input.totalMinor,
      costBasisMinor: 0,
      realizedProfitLossMinor: 0,
      note: input.note?.trim() || null,
      importKey: null,
      deletedAt: null,
    };
  }
  const quote = resolveInvestmentQuote(input);
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

async function writeOperation(userId: string, row: Record<string, unknown>): Promise<void> {
  const writes: RowWrite[] = [{ table: "investment_operations", row }];
  await writeRowsValidated(userId, writes, (sqlite) => validateInvestmentMutation(sqlite, userId, writes));
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

export async function addInvestmentOperation(userId: string, input: InvestmentOperationInput): Promise<string> {
  const id = input.id ?? newId();
  await writeOperation(userId, operationRow(input, id));
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
