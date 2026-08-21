import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  getAllAsync: vi.fn(),
  getFirstAsync: vi.fn(),
  validatedWrites: vi.fn(),
  writeRows: vi.fn(),
  assertInvestmentWrites: vi.fn(),
  committedIds: [] as string[],
}));

vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => ({
    getAllAsync: dependencies.getAllAsync,
    getFirstAsync: dependencies.getFirstAsync,
  }),
}));

vi.mock("../src/db/ids", () => ({
  deterministicId: vi.fn(async () => "deterministic-id"),
  naturalKeys: {
    ccColumn: () => "cc-column",
    expected: () => "expected",
    setting: () => "setting",
  },
}));

vi.mock("../src/db/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/db/mutations")>();
  return {
    ...actual,
    writeRows: dependencies.writeRows,
    writeSetting: vi.fn(async () => undefined),
    softDelete: vi.fn(async () => null),
    writeRowsValidated: dependencies.validatedWrites,
  };
});

vi.mock("../src/data/repo/investment-validation", () => ({
  assertInvestmentWrites: dependencies.assertInvestmentWrites,
}));

vi.mock("../src/data/repo/transactions", () => ({
  cardStatementWrite: vi.fn(),
}));

vi.mock("../src/data/repo/expected", () => ({
  confirmExpected: vi.fn(),
}));

import { runMaintenance } from "../src/data/repo/maintenance";
import { InvestmentDomainError } from "../src/domain/investments";

const USER = "11111111-1111-4111-8111-111111111111";

function dueTransaction(id: string, type: "transfer" | "expense", amountTryMinor: number) {
  return {
    id,
    user_id: USER,
    type,
    amount_minor: amountTryMinor,
    amount_try_minor: amountTryMinor,
    currency: "TRY",
    effective_date: "2026-08-01",
    status: "pending",
    is_aggregate: 0,
    deleted_at: null,
  };
}

describe("investment-aware maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.committedIds.length = 0;
    const due = [
      dueTransaction("refund", "transfer", -8_000),
      dueTransaction("ordinary", "expense", 500),
      dueTransaction("deposit", "transfer", 5_000),
    ];
    dependencies.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM persons") && sql.includes("is_self = 1")) return [{ id: "self" }];
      if (sql.includes("key = 'cc_column_removed'")) return [{ value: "true" }];
      if (sql.includes("status = 'pending'") && sql.includes("effective_date <=")) return due;
      return [];
    });
    dependencies.getFirstAsync.mockResolvedValue(null);
    dependencies.assertInvestmentWrites.mockImplementation(async (_db, _userId, writes) => {
      const amount = Number(writes[0]?.row.amountTryMinor);
      if (amount < 0) throw new InvestmentDomainError("insufficient_cash");
      return null;
    });
    dependencies.validatedWrites.mockImplementation(async (_userId, writes, validate) => {
      await validate({});
      dependencies.committedIds.push(String(writes[0]?.row.id));
      return writes;
    });
  });

  it("realizes funding first and leaves an unaffordable scheduled refund pending", async () => {
    await runMaintenance(USER);

    const attemptedIds = dependencies.validatedWrites.mock.calls.map((call) => call[1][0].row.id);
    expect(attemptedIds).toEqual(["deposit", "ordinary", "refund"]);
    expect(dependencies.committedIds).toEqual(["deposit", "ordinary"]);
    expect(dependencies.validatedWrites).toHaveBeenCalledTimes(3);
    expect(dependencies.assertInvestmentWrites).toHaveBeenCalledTimes(3);
  });
});

/**
 * The repairs `runMaintenance` performs before anything else.
 *
 * These fix data that a historical bug or an older client wrote. They run on
 * every start, they rewrite rows the owner never touched, and none of them had
 * a test -- so a repair that stopped repairing, or started rewriting the wrong
 * rows, would have been invisible.
 */
describe("maintenance repairs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.getFirstAsync.mockResolvedValue(null);
    dependencies.getAllAsync.mockResolvedValue([]);
    dependencies.validatedWrites.mockResolvedValue([]);
  });

  it("collapses duplicate self-persons onto the oldest and repoints what referenced them", async () => {
    // A historical seed bug could create a second "self". Two selves means the
    // dashboard counts one person's money twice, so the newer one is folded in.
    const duplicateRow = { id: "self-new", user_id: USER, name: "Ben", is_self: 1, deleted_at: null };
    dependencies.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("is_self = 1")) return [{ id: "self-old" }, { id: "self-new" }];
      if (sql.includes("FROM transactions WHERE") && sql.includes("person_id")) {
        return [{ id: "tx-1", user_id: USER, person_id: "self-new", type: "expense", amount_minor: 100 }];
      }
      return [];
    });
    dependencies.getFirstAsync.mockImplementation(async (sql: string) =>
      sql.includes("FROM persons WHERE id") ? duplicateRow : null);

    await runMaintenance(USER);

    const repair = dependencies.writeRows.mock.calls.find(
      (call) => Array.isArray(call[1]) && call[1].some((write: { table: string }) => write.table === "persons"),
    );
    expect(repair).toBeDefined();
    const writes = repair![1] as { table: string; row: Record<string, unknown> }[];
    // The reference moves to the survivor...
    expect(writes.find((write) => write.table === "transactions")?.row.personId).toBe("self-old");
    // ...and only then is the duplicate withdrawn.
    expect(writes.find((write) => write.table === "persons")?.row.deletedAt).toBeTruthy();
  });

  it("leaves a single self-person completely alone", async () => {
    dependencies.getAllAsync.mockImplementation(async (sql: string) =>
      sql.includes("is_self = 1") ? [{ id: "self-old" }] : []);

    await runMaintenance(USER);

    expect(dependencies.writeRows.mock.calls.some(
      (call) => Array.isArray(call[1]) && call[1].some((write: { table: string }) => write.table === "persons"),
    )).toBe(false);
  });

  it("rewrites a refund stored as income in an expense category into a negative expense", async () => {
    // Older editors recorded an expense refund as income +100 in the expense
    // category. Same balance effect, but every chart that nets a category
    // disagreed with it. Canonical form is expense -100.
    dependencies.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("category_kind")) {
        return [{
          id: "tx-refund", user_id: USER, type: "income", category_kind: "expense",
          amount_minor: 100, amount_try_minor: 100, currency: "TRY",
          effective_date: "2026-08-01", status: "realized", deleted_at: null, is_aggregate: 0,
        }];
      }
      return [];
    });

    await runMaintenance(USER);

    const repair = dependencies.writeRows.mock.calls.find(
      (call) => Array.isArray(call[1]) && call[1].some((write: { row: { id?: unknown } }) => write.row.id === "tx-refund"),
    );
    expect(repair).toBeDefined();
    const row = (repair![1] as { row: Record<string, unknown> }[])[0]!.row;
    expect(row).toMatchObject({ type: "expense", amountMinor: -100, amountTryMinor: -100 });
  });
});
