import { describe, expect, it } from "vitest";
import type { SQLiteDatabase } from "expo-sqlite";
import { assertInvestmentWrites, projectInvestmentWrites } from "../src/data/repo/investment-validation";
import type { RowWrite } from "../src/db/mutations";
import { MAX_ABS_AMOUNT_MINOR } from "../src/domain/money";

const USER = "11111111-1111-4111-8111-111111111111";

type Rows = Record<string, Record<string, unknown>[]>;

function database(rows: Rows, onRead?: () => void): SQLiteDatabase {
  return {
    getAllAsync: async (sql: string, args?: unknown[]) => {
      onRead?.();
      expect(args).toEqual([USER]);
      const table = sql.match(/FROM\s+(\w+)/i)?.[1];
      return table ? rows[table] ?? [] : [];
    },
  } as unknown as SQLiteDatabase;
}

function ownerGraph(): Rows {
  return {
    investment_profiles: [{
      id: "profile", user_id: USER, started_on: "2026-07-01",
      opening_cash_minor: 10_000, deleted_at: null,
    }],
    investment_products: [{
      id: "product", user_id: USER, asset_type: "equity", name: "SASA", deleted_at: null,
    }],
    investment_operations: [],
    persons: [{ id: "self", user_id: USER, is_self: 1, deleted_at: null }],
    categories: [{ id: "transfer", user_id: USER, is_transfer: 1, deleted_at: null }],
    transactions: [],
  };
}

async function expectDomainCode(rows: Rows, code: string, writes: RowWrite[] = []): Promise<void> {
  await expect(assertInvestmentWrites(database(rows), USER, writes, true)).rejects.toMatchObject({ code });
}

describe("investment owner-graph validation", () => {
  it("skips irrelevant writes but recognizes every owner-graph table", async () => {
    let reads = 0;
    const emptyDb = database({}, () => { reads += 1; });
    await expect(assertInvestmentWrites(emptyDb, USER, [])).resolves.toBeNull();
    expect(reads).toBe(0);

    for (const table of [
      "investment_profiles",
      "investment_products",
      "investment_operations",
      "transactions",
      "categories",
      "persons",
    ] as const) {
      reads = 0;
      const writes: RowWrite[] = [{ table, row: { id: `pending-${table}`, deletedAt: null } }];
      await assertInvestmentWrites(emptyDb, USER, writes).catch(() => {});
      expect(reads, table).toBe(6);
    }
  });

  it("forces projection for cache writers and validates sale caches by default", async () => {
    const invalidProfile = ownerGraph();
    invalidProfile.investment_profiles![0]!.started_on = "2999-01-01";
    await expect(projectInvestmentWrites(database(invalidProfile), USER, [{
      table: "settings", row: { id: "irrelevant" },
    }])).rejects.toMatchObject({ code: "invalid_money" });

    const rows = ownerGraph();
    rows.investment_operations = [
      {
        id: "holding", user_id: USER, product_id: "product", kind: "existing",
        operation_date: "2026-07-01", quantity: "10", unit_price_minor: 100,
        total_minor: 1_000, cost_basis_minor: 0, realized_profit_loss_minor: 0, deleted_at: null,
      },
      {
        id: "sale", user_id: USER, product_id: "product", kind: "sell",
        operation_date: "2026-07-02", quantity: "5", unit_price_minor: 140,
        total_minor: 700, cost_basis_minor: 0, realized_profit_loss_minor: 0, deleted_at: null,
      },
    ];
    await expect(assertInvestmentWrites(database(rows), USER, [], true)).rejects.toMatchObject({
      code: "quote_inconsistent",
    });
    await expect(assertInvestmentWrites(database(rows), USER, [], true, false)).resolves.toMatchObject({
      investedCostMinor: 500,
      realizedProfitLossMinor: 200,
    });
  });

  it("requires a profile for persisted and pending investment rows", async () => {
    const operationOnly: Rows = {
      investment_operations: [{ id: "orphan-operation", deleted_at: null }],
    };
    await expectDomainCode(operationOnly, "unknown_product");

    for (const table of ["investment_products", "investment_operations"] as const) {
      await expectDomainCode({}, "unknown_product", [{
        table,
        row: { id: `pending-${table}`, deletedAt: null },
      }]);
      await expectDomainCode({}, "unknown_product", [
        { table: "categories", row: { id: "unrelated", deletedAt: null } },
        {
          table,
          row: { id: `pending-deleted-${table}`, deletedAt: "2026-07-02T00:00:00.000Z" },
        },
      ]);
    }
    await expect(assertInvestmentWrites(database({}), USER, [{
      table: "categories", row: { id: "ordinary", isTransfer: false, deletedAt: null },
    }])).resolves.toBeNull();

    const tombstonedProfile = ownerGraph();
    tombstonedProfile.investment_profiles![0]!.deleted_at = "2026-07-02T00:00:00.000Z";
    await expectDomainCode(tombstonedProfile, "unknown_product");
  });

  it("overlays partial writes without discarding persisted fields", async () => {
    const rows = ownerGraph();
    const state = await assertInvestmentWrites(database(rows), USER, [{
      table: "investment_products",
      row: { id: "product", name: " ASELSAN " },
    }], true);
    expect(state?.products[0]).toMatchObject({ id: "product", assetType: "equity", name: "ASELSAN" });

    rows.investment_profiles![0]!.deleted_at = "2026-07-02T00:00:00.000Z";
    await expect(assertInvestmentWrites(database(rows), USER, [{
      table: "investment_profiles",
      row: {
        id: "profile", startedOn: "2026-07-01", openingCashMinor: 10_000, deletedAt: null,
      },
    }], true)).resolves.toBeTruthy();
  });

  it("rejects every invalid profile boundary and accepts the supported edges", async () => {
    const duplicate = ownerGraph();
    duplicate.investment_profiles!.push({ ...duplicate.investment_profiles![0]!, id: "profile-2" });
    await expectDomainCode(duplicate, "invalid_money");

    for (const openingCash of [-1, MAX_ABS_AMOUNT_MINOR + 1, 1.5]) {
      const rows = ownerGraph();
      rows.investment_profiles![0]!.opening_cash_minor = openingCash;
      await expectDomainCode(rows, "invalid_money");
    }
    for (const startedOn of ["not-a-date", "2999-01-01"]) {
      const rows = ownerGraph();
      rows.investment_profiles![0]!.started_on = startedOn;
      await expectDomainCode(rows, "invalid_money");
    }
    for (const openingCash of [0, MAX_ABS_AMOUNT_MINOR]) {
      const rows = ownerGraph();
      rows.investment_profiles![0]!.opening_cash_minor = openingCash;
      await expect(assertInvestmentWrites(database(rows), USER, [], true)).resolves.toMatchObject({
        cashMinor: openingCash,
      });
    }
  });

  it("accepts every asset type and rejects malformed product names and types", async () => {
    for (const assetType of ["metal", "currency", "equity", "fund", "crypto", "pension"]) {
      const rows = ownerGraph();
      rows.investment_products![0]!.asset_type = assetType;
      await expect(assertInvestmentWrites(database(rows), USER, [], true), assetType).resolves.toBeTruthy();
    }
    for (const product of [
      { asset_type: "unknown", name: "SASA" },
      { asset_type: "equity", name: "   " },
      { asset_type: "equity", name: null },
      { asset_type: "equity", name: "x".repeat(121) },
    ]) {
      const rows = ownerGraph();
      Object.assign(rows.investment_products![0]!, product);
      await expectDomainCode(rows, "unknown_product");
    }
    const edge = ownerGraph();
    edge.investment_products![0]!.name = ` ${"x".repeat(120)} `;
    await expect(assertInvestmentWrites(database(edge), USER, [], true)).resolves.toBeTruthy();

    const deleted = ownerGraph();
    deleted.investment_products![0]!.deleted_at = "2026-07-02T00:00:00.000Z";
    await expect(assertInvestmentWrites(database(deleted), USER, [], true)).resolves.toMatchObject({
      products: [],
    });
  });

  it("accepts amount-only pension contributions and today's dates", async () => {
    const rows = ownerGraph();
    rows.investment_profiles![0]!.started_on = "2026-08-09";
    rows.investment_products![0]!.asset_type = "pension";
    rows.investment_operations = [{
      id: "contribution", user_id: USER, product_id: "product", kind: "contribution",
      operation_date: "2026-08-09", quantity: null, unit_price_minor: null,
      total_minor: 1_000, cost_basis_minor: 0, realized_profit_loss_minor: 0, deleted_at: null,
    }];
    await expect(assertInvestmentWrites(database(rows), USER, [], true)).resolves.toMatchObject({
      cashMinor: 9_000,
      investedCostMinor: 1_000,
    });
  });

  it("rejects malformed operations before replay", async () => {
    const cases: { mutation: Record<string, unknown>; code: string }[] = [
      { mutation: { kind: "unknown" }, code: "invalid_money" },
      { mutation: { operation_date: "not-a-date" }, code: "invalid_money" },
      { mutation: { operation_date: "2999-01-01" }, code: "invalid_money" },
      { mutation: { kind: "buy", quantity: null, unit_price_minor: null }, code: "invalid_quantity" },
      { mutation: { kind: "contribution", quantity: null, unit_price_minor: 100 }, code: "invalid_quantity" },
      { mutation: { kind: "buy", quantity: "bad", unit_price_minor: 100 }, code: "invalid_quantity" },
      {
        mutation: { kind: "buy", quantity: "1", unit_price_minor: 100, total_minor: 999 },
        code: "quote_inconsistent",
      },
    ];
    for (const { mutation, code } of cases) {
      const rows = ownerGraph();
      rows.investment_operations = [{
        id: "operation", user_id: USER, product_id: "product", kind: "buy",
        operation_date: "2026-07-01", quantity: "1", unit_price_minor: 100,
        total_minor: 100, cost_basis_minor: 0, realized_profit_loss_minor: 0,
        deleted_at: null, ...mutation,
      }];
      await expect(
        assertInvestmentWrites(database(rows), USER, [], true),
        JSON.stringify(mutation),
      ).rejects.toMatchObject({ code });
    }

    const pendingCamelQuote = ownerGraph();
    pendingCamelQuote.investment_operations = [{
      id: "operation", user_id: USER, product_id: "product", kind: "buy",
      operation_date: "2026-07-01", quantity: "1", unit_price_minor: 100,
      total_minor: 100, cost_basis_minor: 0, realized_profit_loss_minor: 0,
      deleted_at: null,
    }];
    await expect(assertInvestmentWrites(database(pendingCamelQuote), USER, [{
      table: "investment_operations",
      row: { id: "operation", unitPriceMinor: 200, totalMinor: 200 },
    }], true)).resolves.toMatchObject({ investedCostMinor: 200 });
  });

  it("includes only realized self-owned transfer cash on or before today", async () => {
    const rows = ownerGraph();
    rows.persons!.push({ id: "watch", user_id: USER, is_self: 0, deleted_at: null });
    rows.persons!.push({
      id: "deleted-self", user_id: USER, is_self: 1,
      deleted_at: "2026-07-02T00:00:00.000Z",
    });
    rows.categories!.push({ id: "ordinary", user_id: USER, is_transfer: 0, deleted_at: null });
    const transaction = (id: string, overrides: Record<string, unknown> = {}) => ({
      id, user_id: USER, type: "transfer", status: "realized", category_id: "transfer",
      person_id: "self", effective_date: "2026-07-03", amount_try_minor: 100,
      deleted_at: null, ...overrides,
    });
    rows.transactions = [
      transaction("included"),
      transaction("expense", { type: "expense", amount_try_minor: 1_000 }),
      transaction("pending", { status: "pending", amount_try_minor: 2_000 }),
      transaction("ordinary", { category_id: "ordinary", amount_try_minor: 3_000 }),
      transaction("watch", { person_id: "watch", amount_try_minor: 4_000 }),
      transaction("deleted-owner", { person_id: "deleted-self", amount_try_minor: 8_000 }),
      transaction("future", { effective_date: "2999-01-01", amount_try_minor: 5_000 }),
      transaction("deleted", { deleted_at: "2026-07-04T00:00:00.000Z", amount_try_minor: 6_000 }),
      transaction("today", { effective_date: "2026-08-09", amount_try_minor: 7_000 }),
    ];

    await expect(assertInvestmentWrites(database(rows), USER, [], true)).resolves.toMatchObject({
      cashMinor: 17_100,
    });
  });

  it("projects pending person/category semantics in the same write batch", async () => {
    const rows = ownerGraph();
    rows.persons = [];
    rows.categories = [];
    rows.transactions = [];
    const writes: RowWrite[] = [
      { table: "persons", row: { id: "new-self", isSelf: true, deletedAt: null } },
      { table: "categories", row: { id: "new-transfer", isTransfer: true, deletedAt: null } },
      {
        table: "transactions",
        row: {
          id: "new-cash", type: "transfer", status: "realized", categoryId: "new-transfer",
          personId: "new-self", effectiveDate: "2026-08-09", amountTryMinor: 500, deletedAt: null,
        },
      },
    ];
    await expect(assertInvestmentWrites(database(rows), USER, writes)).resolves.toMatchObject({ cashMinor: 10_500 });

    rows.categories = [{ id: "deleted-transfer", is_transfer: 1, deleted_at: "2026-08-08T00:00:00.000Z" }];
    rows.persons = [{ id: "self", is_self: 1, deleted_at: null }];
    rows.transactions = [{
      id: "orphaned", type: "transfer", status: "realized", category_id: "deleted-transfer",
      person_id: "self", effective_date: "2026-08-09", amount_try_minor: 9_000, deleted_at: null,
    }];
    await expect(assertInvestmentWrites(database(rows), USER, [], true)).resolves.toMatchObject({ cashMinor: 10_000 });
  });

  it("rejects stale cache values on both buy and sale rows", async () => {
    for (const cache of [
      { cost_basis_minor: 1, realized_profit_loss_minor: 0 },
      { cost_basis_minor: 0, realized_profit_loss_minor: 1 },
    ]) {
      const buy = ownerGraph();
      buy.investment_operations = [{
        id: "buy", user_id: USER, product_id: "product", kind: "buy",
        operation_date: "2026-07-01", quantity: "1", unit_price_minor: 100,
        total_minor: 100, deleted_at: null, ...cache,
      }];
      await expectDomainCode(buy, "invalid_money");
    }

    const sale = ownerGraph();
    sale.investment_operations = [
      {
        id: "holding", user_id: USER, product_id: "product", kind: "existing",
        operation_date: "2026-07-01", quantity: "2", unit_price_minor: 100,
        total_minor: 200, cost_basis_minor: 0, realized_profit_loss_minor: 0, deleted_at: null,
      },
      {
        id: "sale", user_id: USER, product_id: "product", kind: "sell",
        operation_date: "2026-07-02", quantity: "1", unit_price_minor: 150,
        total_minor: 150, cost_basis_minor: 100, realized_profit_loss_minor: 49, deleted_at: null,
      },
    ];
    await expectDomainCode(sale, "quote_inconsistent");
    sale.investment_operations![1]!.realized_profit_loss_minor = 50;
    sale.investment_operations![1]!.cost_basis_minor = 99;
    await expectDomainCode(sale, "quote_inconsistent");
  });

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
