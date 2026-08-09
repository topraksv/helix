/**
 * Stateful repository oracle.
 *
 * Unit examples prove individual formulas. This test instead drives the real
 * repository and write layer through one long SQLite journal, then compares
 * every intermediate state with deliberately small arithmetic kept in this
 * file. The oracle does not import the ledger, card-cycle or investment math.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addInvestmentOperation,
  addTransaction,
  createCategory,
  createPerson,
  deleteInvestmentOperation,
  deleteTransaction,
  restoreInvestmentOperation,
  restoreTransaction,
  saveInvestmentProduct,
  setupInvestments,
  upsertPaymentSource,
} from "../src/data/repo";
import { projectInvestmentState } from "../src/domain/investment-projection";

const harness = vi.hoisted(() => ({
  db: null as DatabaseSync | null,
  nextId: 0,
}));

vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => ({
    getFirstAsync: async (sql: string, args: unknown[] = []) =>
      harness.db!.prepare(sql).get(...(args as never[])) ?? null,
    getAllAsync: async (sql: string, args: unknown[] = []) =>
      harness.db!.prepare(sql).all(...(args as never[])),
    runAsync: async (sql: string, args: unknown[] = []) => ({
      changes: Number(
        harness.db!.prepare(sql).run(...(args as never[])).changes,
      ),
    }),
  }),
  withTransaction: async (task: () => Promise<void>) => {
    harness.db!.exec("BEGIN");
    try {
      await task();
      harness.db!.exec("COMMIT");
    } catch (error) {
      harness.db!.exec("ROLLBACK");
      throw error;
    }
  },
}));
vi.mock("../src/db/ids", () => ({
  newId: () => `model-${String(++harness.nextId).padStart(4, "0")}`,
  deterministicId: async (key: string) => `det:${key}`,
  naturalKeys: new Proxy(
    {},
    {
      get:
        (_target, property) =>
        (...parts: unknown[]) =>
          `${String(property)}|${parts.join("|")}`,
    },
  ),
}));
vi.mock("../src/services/fx-fetch", () => ({ lookupRate: vi.fn() }));
vi.mock("../src/services/markets", () => ({ marketSellRateTry: vi.fn() }));
vi.mock("../src/sync/engine", () => ({ scheduleSync: vi.fn() }));

const USER = "model-user";
const TODAY = "2026-08-09";
// The normal quality gate proves all 100 journals. Stryker re-runs this test
// once per covered mutant, where one deterministic journal exercises the same
// repository statements without multiplying an 882-mutant run by 100.
const JOURNAL_SEEDS = process.env.STRYKER_MUTATOR_WORKER ? 1 : 100;
const migrationsDir = join(process.cwd(), "src/db/migrations");
const migrationSql = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
  .flatMap((name) =>
    readFileSync(join(migrationsDir, name), "utf8").split(
      "--> statement-breakpoint",
    ),
  )
  .map((statement) => statement.trim())
  .filter(Boolean);

interface ModelTransaction {
  id: string;
  type: "expense" | "income" | "transfer";
  amount: number;
  categoryId: string;
  paymentSourceId: string | null;
  purchaseDate: string | null;
  effectiveDate: string;
  cardStatementId: string | null;
  deleted: boolean;
}

interface ModelOperation {
  id: string;
  kind: "buy" | "sell";
  date: string;
  quantity: number;
  total: number;
  deleted: boolean;
}

const pad = (value: number) => String(value).padStart(2, "0");

function addMonth(year: number, month: number): [number, number] {
  return month === 12 ? [year + 1, 1] : [year, month + 1];
}

function cardDates(purchaseDate: string): {
  period: string;
  statement: string;
  due: string;
} {
  const [yearRaw, monthRaw, dayRaw] = purchaseDate.split("-").map(Number);
  let year = yearRaw!;
  let month = monthRaw!;
  if (dayRaw! > 25) [year, month] = addMonth(year, month);
  const [dueYear, dueMonth] = addMonth(year, month);
  return {
    period: `${year}-${pad(month)}`,
    statement: `${year}-${pad(month)}-25`,
    due: `${dueYear}-${pad(dueMonth)}-05`,
  };
}

function roundedRatio(
  total: number,
  numerator: number,
  denominator: number,
): number {
  return Math.floor((2 * total * numerator + denominator) / (2 * denominator));
}

function seededValue(seed: number, index: number, span: number): number {
  return (
    ((Math.imul(seed + 1, 1_664_525) + Math.imul(index + 1, 1_013_904_223)) >>>
      0) %
    span
  );
}

function walletOracle(
  openingCash: number,
  transactions: ModelTransaction[],
  operations: ModelOperation[],
) {
  let cash =
    openingCash +
    transactions
      .filter((row) => !row.deleted && row.type === "transfer")
      .reduce((sum, row) => sum + row.amount, 0);
  let quantity = 0;
  let cost = 0;
  let realized = 0;
  const saleResults = new Map<
    string,
    { costBasisMinor: number; realizedProfitLossMinor: number }
  >();
  const active = operations
    .filter((row) => !row.deleted)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const operation of active) {
    if (operation.kind === "buy") {
      cash -= operation.total;
      quantity += operation.quantity;
      cost += operation.total;
      continue;
    }
    const costBasis =
      operation.quantity === quantity
        ? cost
        : roundedRatio(cost, operation.quantity, quantity);
    const result = operation.total - costBasis;
    cash += operation.total;
    quantity -= operation.quantity;
    cost -= costBasis;
    realized += result;
    saleResults.set(operation.id, {
      costBasisMinor: costBasis,
      realizedProfitLossMinor: result,
    });
  }
  return {
    cash,
    quantity,
    cost,
    averageCost: quantity === 0 ? null : roundedRatio(cost, 1, quantity),
    realized,
    saleResults,
  };
}

describe("repository model oracle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
  });

  afterAll(() => {
    harness.db?.close();
    vi.useRealTimers();
  });

  it(`matches balances, category totals, card cycles and investment wallet for ${JOURNAL_SEEDS} seeded 50-step journals`, async () => {
    for (let seed = 0; seed < JOURNAL_SEEDS; seed += 1) {
      harness.db?.close();
      harness.nextId = 0;
      harness.db = new DatabaseSync(":memory:");
      for (const statement of migrationSql) harness.db.exec(statement);

      const personId = await createPerson(USER, "Ben");
      const expenseCategoryId = await createCategory(USER, {
        name: "Market",
        kind: "expense",
        isTransfer: false,
        sortOrder: 0,
      });
      const incomeCategoryId = await createCategory(USER, {
        name: "Maaş",
        kind: "income",
        isTransfer: false,
        sortOrder: 1,
      });
      const transferCategoryId = await createCategory(USER, {
        name: "Yatırım",
        kind: "expense",
        isTransfer: true,
        sortOrder: 2,
      });
      const cardId = await upsertPaymentSource(USER, {
        name: "Model Kart",
        type: "credit_card",
        personId,
        statementDay: 25,
        dueDay: 5,
      });
      const openingCash = 2_000_000;
      await setupInvestments(USER, {
        startedOn: "2026-01-01",
        openingCashMinor: openingCash,
      });
      const productId = await saveInvestmentProduct(USER, {
        assetType: "equity",
        name: "SASA",
      });

      const transactions: ModelTransaction[] = [];
      const operations: ModelOperation[] = [];
      const snapshots = new Map<string, Record<string, unknown>>();
      const operationSnapshots = new Map<string, Record<string, unknown>>();
      const journal: string[] = [];
      let mutationCount = 0;

      const assertState = async (step: string) => {
        const rows = harness
          .db!.prepare(
            `SELECT id, type, amount_try_minor, category_id, payment_source_id, purchase_date,
                effective_date, card_statement_id, deleted_at
         FROM transactions WHERE user_id = ? ORDER BY id`,
          )
          .all(USER) as Record<string, unknown>[];
        expect(rows, `${step}: transaction count`).toHaveLength(
          transactions.length,
        );
        for (const expected of transactions) {
          const actual = rows.find((row) => row.id === expected.id);
          expect(actual, `${step}: ${expected.id}`).toMatchObject({
            type: expected.type,
            amount_try_minor: expected.amount,
            category_id: expected.categoryId,
            payment_source_id: expected.paymentSourceId,
            purchase_date: expected.purchaseDate,
            effective_date: expected.effectiveDate,
            card_statement_id: expected.cardStatementId,
            deleted_at: expected.deleted ? expect.any(String) : null,
          });
        }

        const liveActual = rows.filter((row) => row.deleted_at == null);
        const actualBalance = liveActual.reduce(
          (sum, row) =>
            sum +
            (row.type === "income"
              ? Number(row.amount_try_minor)
              : -Number(row.amount_try_minor)),
          0,
        );
        const expectedBalance = transactions
          .filter((row) => !row.deleted)
          .reduce(
            (sum, row) =>
              sum + (row.type === "income" ? row.amount : -row.amount),
            0,
          );
        expect(actualBalance, `${step}: balance`).toBe(expectedBalance);

        const categoryTotals = <T>(
          source: readonly T[],
          categoryOf: (row: T) => string,
          amountOf: (row: T) => number,
        ) => {
          const totals = new Map<string, number>();
          for (const row of source) {
            const category = categoryOf(row);
            const amount = amountOf(row);
            totals.set(category, (totals.get(category) ?? 0) + amount);
          }
          return [...totals].sort(([a], [b]) => a.localeCompare(b));
        };
        expect(
          categoryTotals(
            liveActual,
            (row) => String(row.category_id),
            (row) => Number(row.amount_try_minor),
          ),
          `${step}: category totals`,
        ).toEqual(
          categoryTotals(
            transactions.filter((row) => !row.deleted),
            (row) => row.categoryId,
            (row) => row.amount,
          ),
        );

        for (const transaction of transactions.filter(
          (row) => row.paymentSourceId === cardId,
        )) {
          const dates = cardDates(transaction.purchaseDate!);
          const statement = harness
            .db!.prepare(
              "SELECT period_month, statement_date, due_date FROM credit_card_statements WHERE id = ?",
            )
            .get(transaction.cardStatementId!) as Record<string, unknown>;
          expect(statement, `${step}: card ${transaction.id}`).toMatchObject({
            period_month: dates.period,
            statement_date: dates.statement,
            due_date: dates.due,
          });
        }

        const profile = harness
          .db!.prepare(
            "SELECT started_on, opening_cash_minor FROM investment_profiles WHERE user_id = ? AND deleted_at IS NULL",
          )
          .get(USER) as Record<string, unknown>;
        const productRows = harness
          .db!.prepare(
            "SELECT id, asset_type, name FROM investment_products WHERE user_id = ? AND deleted_at IS NULL",
          )
          .all(USER) as Record<string, unknown>[];
        const operationRows = harness
          .db!.prepare(
            `SELECT id, product_id, kind, operation_date, quantity, unit_price_minor, total_minor,
                cost_basis_minor, realized_profit_loss_minor
         FROM investment_operations WHERE user_id = ? AND deleted_at IS NULL ORDER BY operation_date, id`,
          )
          .all(USER) as Record<string, unknown>[];
        const categoryRows = harness
          .db!.prepare(
            "SELECT id, is_transfer FROM categories WHERE user_id = ? AND deleted_at IS NULL",
          )
          .all(USER) as Record<string, unknown>[];
        const actualWallet = projectInvestmentState(
          {
            startedOn: String(profile.started_on),
            openingCashMinor: Number(profile.opening_cash_minor),
          },
          productRows.map((row) => ({
            id: String(row.id),
            assetType: row.asset_type as "equity",
            name: String(row.name),
          })),
          operationRows.map((row) => ({
            id: String(row.id),
            productId: String(row.product_id),
            kind: row.kind as "buy" | "sell",
            operationDate: String(row.operation_date),
            quantity: row.quantity == null ? null : String(row.quantity),
            unitPriceMinor:
              row.unit_price_minor == null
                ? null
                : Number(row.unit_price_minor),
            totalMinor: Number(row.total_minor),
          })),
          liveActual.map((row) => ({
            id: String(row.id),
            type: String(row.type),
            status: "realized",
            deletedAt: null,
            effectiveDate: String(row.effective_date),
            categoryId: String(row.category_id),
            amountTryMinor: Number(row.amount_try_minor),
            personIsSelf: true,
          })),
          categoryRows.map((row) => ({
            id: String(row.id),
            isTransfer: Boolean(row.is_transfer),
          })),
        );
        const expectedWallet = walletOracle(
          openingCash,
          transactions,
          operations,
        );
        expect(actualWallet, `${step}: wallet`).toMatchObject({
          cashMinor: expectedWallet.cash,
          investedCostMinor: expectedWallet.cost,
          realizedProfitLossMinor: expectedWallet.realized,
        });
        expect(actualWallet.products[0], `${step}: holding`).toMatchObject({
          id: productId,
          quantity: String(expectedWallet.quantity),
          costMinor: expectedWallet.cost,
          averageCostMinor: expectedWallet.averageCost,
          realizedProfitLossMinor: expectedWallet.realized,
        });
        for (const [id, result] of expectedWallet.saleResults) {
          expect(
            operationRows.find((row) => row.id === id),
            `${step}: sale cache ${id}`,
          ).toMatchObject({
            cost_basis_minor: result.costBasisMinor,
            realized_profit_loss_minor: result.realizedProfitLossMinor,
          });
        }
      };

      const checkpoint = async (step: string) => {
        journal.push(step);
        mutationCount += 1;
        try {
          await assertState(`seed ${seed}: ${step}`);
        } catch (error) {
          throw new Error(
            `seed ${seed}; minimal failing prefix (${journal.length} mutations): ${journal.join(" -> ")}`,
            { cause: error },
          );
        }
      };

      for (let index = 0; index < 26; index += 1) {
        const kind = (index + seed) % 4;
        const type = (["expense", "income", "expense", "transfer"] as const)[
          kind
        ]!;
        const categoryId = [
          expenseCategoryId,
          incomeCategoryId,
          expenseCategoryId,
          transferCategoryId,
        ][kind]!;
        const paymentSourceId = kind === 2 ? cardId : null;
        const purchaseDate = `2026-${pad(1 + Math.floor(index / 8))}-${pad(3 + seededValue(seed, index, 26))}`;
        const amount = 1_000 + index * 137 + seededValue(seed, index, 500);
        const id = await addTransaction(USER, {
          type,
          amountMinor: amount,
          currency: "TRY",
          fxRate: null,
          amountTryMinor: amount,
          effectiveDate: purchaseDate as `${number}-${number}-${number}`,
          categoryId,
          paymentSourceId,
          personId,
          note: `model-${index}`,
        });
        const dates = paymentSourceId ? cardDates(purchaseDate) : null;
        const row = harness
          .db!.prepare(
            "SELECT card_statement_id FROM transactions WHERE id = ?",
          )
          .get(id) as Record<string, unknown>;
        transactions.push({
          id,
          type,
          amount,
          categoryId,
          paymentSourceId,
          purchaseDate: dates ? purchaseDate : null,
          effectiveDate: dates?.due ?? purchaseDate,
          cardStatementId: dates ? String(row.card_statement_id) : null,
          deleted: false,
        });
        await checkpoint(`transaction add ${index + 1}`);
      }

      for (const index of [2, 7, 13, 19]) {
        const model = transactions[index]!;
        const snapshot = await deleteTransaction(USER, model.id);
        snapshots.set(model.id, snapshot!);
        model.deleted = true;
        await checkpoint(`transaction delete ${index}`);
      }
      for (const index of [7, 19]) {
        const model = transactions[index]!;
        await restoreTransaction(USER, snapshots.get(model.id)!);
        model.deleted = false;
        await checkpoint(`transaction restore ${index}`);
      }

      for (let index = 0; index < 16; index += 1) {
        const sell = index % 3 === 2;
        const quantity = sell ? 1 : 2 + seededValue(seed, index, 2);
        const unitPrice =
          (sell ? 18_000 + index * 100 : 10_000 + index * 125) +
          seededValue(seed, index, 500);
        const total = quantity * unitPrice;
        const id = await addInvestmentOperation(USER, {
          productId,
          kind: sell ? "sell" : "buy",
          operationDate:
            `2026-04-${pad(index + 1)}` as `${number}-${number}-${number}`,
          quantity: String(quantity),
          unitPriceMinor: unitPrice,
          totalMinor: total,
        });
        operations.push({
          id,
          kind: sell ? "sell" : "buy",
          date: `2026-04-${pad(index + 1)}`,
          quantity,
          total,
          deleted: false,
        });
        await checkpoint(`investment operation ${index + 1}`);
      }

      const sale = operations.find((operation) => operation.kind === "sell")!;
      const operationSnapshot = await deleteInvestmentOperation(USER, sale.id);
      operationSnapshots.set(sale.id, operationSnapshot!);
      sale.deleted = true;
      await checkpoint("investment sale delete");
      await restoreInvestmentOperation(USER, operationSnapshots.get(sale.id)!);
      sale.deleted = false;
      await checkpoint("investment sale restore");
      expect(mutationCount, `seed ${seed}: mutation count`).toBe(50);
    }
  }, 30_000);
});
