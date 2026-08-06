import { describe, expect, it } from "vitest";
import type { SQLiteDatabase } from "expo-sqlite";
import { assertInvestmentWrites } from "../src/data/repo/investment-validation";

const USER = "11111111-1111-4111-8111-111111111111";

function database(rows: Record<string, Record<string, unknown>[]>): SQLiteDatabase {
  return {
    getAllAsync: async (sql: string, args?: unknown[]) => {
      expect(args).toEqual([USER]);
      const table = sql.match(/FROM\s+(\w+)/i)?.[1];
      return table ? rows[table] ?? [] : [];
    },
  } as unknown as SQLiteDatabase;
}

describe("investment owner-graph validation", () => {
  it("uses persisted transfer semantics and the wallet cutoff, never a category name", async () => {
    const state = await assertInvestmentWrites(database({
      investment_profiles: [{
        id: "profile", user_id: USER, started_on: "2026-07-01",
        opening_cash_minor: 1_000, deleted_at: null,
      }],
      persons: [{ id: "self", user_id: USER, is_self: 1, deleted_at: null }],
      categories: [
        { id: "named-only", user_id: USER, name: "Yatırım", is_transfer: 0, deleted_at: null },
        { id: "actual-transfer", user_id: USER, name: "Birikim", is_transfer: 1, deleted_at: null },
      ],
      transactions: [
        {
          id: "name-is-not-semantics", user_id: USER, type: "transfer", status: "realized",
          category_id: "named-only", person_id: "self", effective_date: "2026-07-03", amount_try_minor: 9_000,
          deleted_at: null,
        },
        {
          id: "before-cutoff", user_id: USER, type: "transfer", status: "realized",
          category_id: "actual-transfer", person_id: "self", effective_date: "2026-06-30", amount_try_minor: 5_000,
          deleted_at: null,
        },
        {
          id: "deposit", user_id: USER, type: "transfer", status: "realized",
          category_id: "actual-transfer", person_id: "self", effective_date: "2026-07-03", amount_try_minor: 200,
          deleted_at: null,
        },
      ],
    }), USER, [], true);

    expect(state?.cashMinor).toBe(1_200);
  });

  it("excludes transfer rows owned by a watch-only person", async () => {
    const state = await assertInvestmentWrites(database({
      investment_profiles: [{
        id: "profile", user_id: USER, started_on: "2026-07-01",
        opening_cash_minor: 1_000, deleted_at: null,
      }],
      persons: [
        { id: "self", user_id: USER, is_self: 1, deleted_at: null },
        { id: "watch", user_id: USER, is_self: 0, deleted_at: null },
      ],
      categories: [{ id: "transfer", user_id: USER, is_transfer: 1, deleted_at: null }],
      transactions: [
        {
          id: "self-deposit", user_id: USER, type: "transfer", status: "realized",
          category_id: "transfer", person_id: "self", effective_date: "2026-07-03",
          amount_try_minor: 200, deleted_at: null,
        },
        {
          id: "watch-deposit", user_id: USER, type: "transfer", status: "realized",
          category_id: "transfer", person_id: "watch", effective_date: "2026-07-03",
          amount_try_minor: 900, deleted_at: null,
        },
      ],
    }), USER, [], true);

    expect(state?.cashMinor).toBe(1_200);
  });

  it("rejects a pending batch that would overdraw investment cash", async () => {
    const writes = [{
      table: "transactions" as const,
      row: {
        id: "imported-withdrawal", type: "transfer", status: "realized",
        categoryId: "transfer", personId: "self", effectiveDate: "2026-07-03",
        amountTryMinor: -2_000, deletedAt: null,
      },
    }];

    await expect(assertInvestmentWrites(database({
      investment_profiles: [{
        id: "profile", user_id: USER, started_on: "2026-07-01",
        opening_cash_minor: 1_000, deleted_at: null,
      }],
      persons: [{ id: "self", user_id: USER, is_self: 1, deleted_at: null }],
      categories: [{ id: "transfer", user_id: USER, is_transfer: 1, deleted_at: null }],
    }), USER, writes)).rejects.toThrow("insufficient investment cash");
  });

  it("refuses live products without the account's single wallet profile", async () => {
    await expect(assertInvestmentWrites(database({
      investment_products: [{
        id: "orphan", user_id: USER, asset_type: "fund", name: "Fon",
        deleted_at: null,
      }],
    }), USER, [], true)).rejects.toThrow("does not exist");
  });

  it("refuses a wallet profile that starts in the future", async () => {
    await expect(assertInvestmentWrites(database({
      investment_profiles: [{
        id: "profile", user_id: USER, started_on: "2999-01-01",
        opening_cash_minor: 1_000, deleted_at: null,
      }],
    }), USER, [], true)).rejects.toThrow("invalid investment money");
  });
});
