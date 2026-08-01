import { getSqliteAsync } from "../../db/client";
import { deterministicId, naturalKeys, newId } from "../../db/ids";
import {
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
import { assertInputWithinLimit } from "../../domain/input";
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
}

export interface InvestmentOperationInput extends InvestmentQuoteInput {
  id?: string;
  productId: string;
  kind: InvestmentOperationKind;
  operationDate: ISODate;
  note?: string | null;
}

function validateDate(date: string): asserts date is ISODate {
  if (!isISODate(date) || date > todayISO()) throw new InvestmentDomainError("invalid_money");
}

export async function setupInvestments(userId: string, input: InvestmentSetupInput): Promise<void> {
  validateDate(input.startedOn);
  assertSupportedMinorAmount(input.openingCashMinor);
  if (input.openingCashMinor < 0) throw new InvestmentDomainError("invalid_money");
  const id = await deterministicId(naturalKeys.investmentProfile(userId));
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
  if (!name || name.length > 120) throw new InvestmentDomainError("unknown_product");
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
  await writeRowsValidated(userId, writes, async (sqlite) => {
    const projected = await projectInvestmentWrites(sqlite, userId, writes);
    if (!projected) throw new InvestmentDomainError("unknown_product");
    await applySaleResults(sqlite, userId, writes, projected.operationResults);
    await assertInvestmentWrites(sqlite, userId, writes);
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
  await writeRowsValidated(
    userId,
    writes,
    async (db) => {
      const projected = await projectInvestmentWrites(db, userId, writes);
      if (projected) await applySaleResults(db, userId, writes, projected.operationResults);
      await assertInvestmentWrites(db, userId, writes);
    },
  );
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
    async (db) => {
      const projected = await projectInvestmentWrites(db, userId, writes);
      if (projected) await applySaleResults(db, userId, writes, projected.operationResults);
      await assertInvestmentWrites(db, userId, writes);
    },
  );
}
