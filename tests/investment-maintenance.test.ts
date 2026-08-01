import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  getAllAsync: vi.fn(),
  getFirstAsync: vi.fn(),
  validatedWrites: vi.fn(),
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
    writeRows: vi.fn(async () => undefined),
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
