import { beforeEach, describe, expect, it, vi } from "vitest";
import { required } from "./helpers";

const dependencies = vi.hoisted(() => ({
  getSqliteAsync: vi.fn(),
  readSetting: vi.fn(),
  writeRows: vi.fn(),
  writeRowsValidated: vi.fn(),
  writeSetting: vi.fn(),
  assertLiveRow: vi.fn(async (sqlite: { getFirstAsync: (sql: string, args: unknown[]) => Promise<unknown> }, table: string, userId: string, id: string) => {
    const row = await sqlite.getFirstAsync(`SELECT id FROM ${table} WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, [id, userId]);
    if (!row) throw new Error(`Cannot edit missing ${table} row`);
  }),
  assertNotTombstonedRow: vi.fn(async (sqlite: { getFirstAsync: (sql: string, args: unknown[]) => Promise<{ deleted_at: string | null } | null> }, table: string, userId: string, id: string) => {
    const row = await sqlite.getFirstAsync(`SELECT deleted_at FROM ${table} WHERE id = ? AND user_id = ?`, [id, userId]);
    if (row?.deleted_at != null) throw new Error(`Cannot revive deleted ${table} row through an edit`);
  }),
  deterministicId: vi.fn(async (key: string) => `id:${key}`),
  settingRow: vi.fn(async (userId: string, key: string, value: unknown) => ({ table: "settings", row: { id: `id:setting|${userId}|${key}`, key, value: JSON.stringify(value), deletedAt: null } })),
}));

vi.mock("../src/db/client", () => ({ getSqliteAsync: dependencies.getSqliteAsync }));
vi.mock("../src/db/ids", () => ({
  deterministicId: dependencies.deterministicId,
  naturalKeys: new Proxy({}, {
    get: (_target, property) => (...parts: unknown[]) => `${String(property)}|${parts.join("|")}`,
  }),
  newId: () => "new-id",
}));
vi.mock("../src/db/mutations", () => ({
  fromDbShape: vi.fn((_table: string, row: Record<string, unknown>) => row),
  nowIso: () => "2026-07-16T00:00:00.000Z",
  readSetting: dependencies.readSetting,
  settingRow: dependencies.settingRow,
  softDelete: vi.fn(),
  writeRows: dependencies.writeRows,
  writeRowsValidated: dependencies.writeRowsValidated,
  assertLiveRow: dependencies.assertLiveRow,
  assertNotTombstonedRow: dependencies.assertNotTombstonedRow,
  writeSetting: dependencies.writeSetting,
}));
vi.mock("../src/services/fx-fetch", () => ({ lookupRate: vi.fn() }));
vi.mock("../src/services/markets", () => ({ marketSellRateTry: vi.fn() }));
vi.mock("../src/sync/engine", () => ({ scheduleSync: vi.fn() }));

import * as repository from "../src/data/repo";

const publicRuntimeExports = [
  "TEMPLATE_CATEGORIES",
  "TEMPLATE_EXTRA_CATEGORIES",
  "ReferencedRecordError",
  "CreditCardCycleRequiredError",
  "InstallmentHistoryConflictError",
  "SubscriptionCategoryRequiredError",
  "FxRateUnavailableError",
  "seedWorkspace",
  "applyOnboardingBalance",
  "setOpeningBalance",
  "finalizeOnboarding",
  "upsertPaymentSource",
  "personReferenceUsage",
  "paymentSourceReferenceUsage",
  "deleteUnreferencedPerson",
  "reassignAndDeletePerson",
  "deleteUnreferencedPaymentSource",
  "reassignAndDeletePaymentSource",
  "addTransaction",
  "updateTransaction",
  "deleteTransaction",
  "setCurrentBalance",
  "setupInvestments",
  "saveInvestmentProduct",
  "addInvestmentOperation",
  "updateInvestmentOperation",
  "deleteInvestmentOperation",
  "restoreInvestmentOperation",
  "countTransactionsForCategory",
  "countInstallmentsForPlan",
  "createInstallmentPlan",
  "updateInstallmentPlan",
  "deletePlan",
  "ensureSubscriptionCategory",
  "upsertSubscription",
  "upsertRecurringIncome",
  "deleteSubscriptionWithExpected",
  "deleteRecurringIncomeWithExpected",
  "restoreDeletedRule",
  "confirmExpected",
  "skipExpected",
  "revertExpected",
  "bulkMonthEntry",
  "importedYears",
  "hasImportedData",
  "importSheets",
  "runMaintenance",
  "upsertCategoryBudget",
  "deleteCategoryBudget",
  "deleteCategoryWithBudgets",
  "restoreCategoryWithBudgets",
] as const;

describe("repository compatibility contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.readSetting.mockResolvedValue(null);
    dependencies.writeRowsValidated.mockImplementation(async (userId: string, writes: unknown[], validate: (sqlite: unknown) => Promise<void>) => {
      await validate(await dependencies.getSqliteAsync());
      dependencies.writeRows(userId, writes);
    });
  });

  it("keeps the existing runtime API available from data/repo", () => {
    for (const name of publicRuntimeExports) expect(repository[name]).toBeDefined();
  });

  it("rejects impossible transaction dates before touching persistence", async () => {
    const input = {
      type: "expense" as const,
      amountMinor: 1_000,
      currency: "TRY",
      fxRate: null,
      amountTryMinor: 1_000,
      effectiveDate: "2026-02-31",
      categoryId: "category-1",
      paymentSourceId: null,
      personId: "person-1",
      note: null,
    };
    await expect(repository.addTransaction("user-1", input)).rejects.toThrow("Invalid transaction date");
    await expect(repository.updateTransaction("user-1", {}, input)).rejects.toThrow("Invalid transaction date");
    expect(dependencies.getSqliteAsync).not.toHaveBeenCalled();
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("rejects a transaction person that is not live in the current account", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) =>
        sql.includes("FROM persons") ? null : { kind: "expense", is_transfer: 0 },
    });
    const input = {
      type: "expense" as const,
      amountMinor: 1_000,
      currency: "TRY",
      fxRate: null,
      amountTryMinor: 1_000,
      effectiveDate: "2026-07-15",
      categoryId: "category-1",
      paymentSourceId: null,
      personId: "person-from-another-account",
      note: null,
    };
    await expect(repository.addTransaction("user-1", input)).rejects.toThrow("Transaction person does not exist");
    expect(dependencies.writeRowsValidated).not.toHaveBeenCalled();
  });

  it("does not revive a transaction deleted while its edit form was open", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM persons")) return { id: "person-1" };
        if (sql.includes("FROM categories")) return { kind: "expense", is_transfer: 0 };
        if (sql.includes("FROM transactions")) return null;
        return null;
      },
    });
    const input = {
      type: "expense" as const,
      amountMinor: 1_000,
      currency: "TRY",
      fxRate: null,
      amountTryMinor: 1_000,
      effectiveDate: "2026-07-15",
      categoryId: "category-1",
      paymentSourceId: null,
      personId: "person-1",
      note: null,
    };

    await expect(repository.updateTransaction("user-1", { id: "transaction-1" }, input))
      .rejects.toThrow("Cannot edit missing transactions row");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("rejects malformed bulk months before constructing persisted dates", async () => {
    await expect(repository.bulkMonthEntry("user-1", "2026-7" as never, "person-1", [])).rejects.toThrow("Invalid bulk entry month");
    expect(dependencies.getSqliteAsync).not.toHaveBeenCalled();
  });

  it("rejects expected confirmations for a person outside the current account", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => sql.includes("FROM expected_payments")
        ? {
            id: "expected-1",
            direction: "in",
            kind: "recurring_income",
            ref_id: "income-1",
            due_date: "2026-07-15",
            amount_minor: 5_000,
            currency: "TRY",
            status: "pending",
            transaction_id: null,
          }
        : sql.includes("FROM persons") ? null : { category_id: "income-category" },
    });

    await expect(repository.confirmExpected("user-1", "expected-1", {
      personId: "person-from-another-account",
      categoryId: "income-category",
    })).rejects.toThrow("Transaction person does not exist");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("requires the live rule category when confirming an expected income", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM expected_payments")) {
          return {
            id: "expected-1",
            direction: "in",
            kind: "recurring_income",
            ref_id: "income-1",
            due_date: "2026-07-15",
            amount_minor: 5_000,
            currency: "TRY",
            status: "pending",
            transaction_id: null,
          };
        }
        if (sql.includes("FROM persons")) return { id: "person-1" };
        if (sql.includes("FROM recurring_incomes")) return { category_id: null };
        if (sql.includes("FROM categories")) return null;
        return null;
      },
    });

    await expect(repository.confirmExpected("user-1", "expected-1", {
      personId: "person-1",
      categoryId: null,
    })).rejects.toThrow("Transaction category is required");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("deletes and restores orphaned card statements with their payment source", async () => {
    const source = {
      id: "source-1",
      user_id: "user-1",
      type: "credit_card",
      deleted_at: null,
    };
    const statement = {
      id: "statement-1",
      user_id: "user-1",
      payment_source_id: "source-1",
      period_month: "2026-07",
      deleted_at: null,
    };
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => sql.includes("COUNT(*)")
        ? { installmentPlans: 0, cardInstallmentPlans: 0, transactions: 0, subscriptions: 0 }
        : source,
      getAllAsync: async (sql: string) => sql.includes("credit_card_statements") ? [statement] : [],
    });

    const snapshot = await repository.deleteUnreferencedPaymentSource("user-1", "source-1");
    expect(snapshot).toEqual({ source, statements: [statement] });
    const [, deleteWrites] = required(dependencies.writeRows.mock.calls[0]);
    expect(deleteWrites.map((write: { table: string }) => write.table)).toEqual([
      "payment_sources",
      "credit_card_statements",
    ]);
    expect(deleteWrites.every((write: { row: { deletedAt: string } }) => write.row.deletedAt === NOW)).toBe(true);

    dependencies.writeRows.mockReset();
    await repository.restorePaymentSource("user-1", snapshot!);
    const [, restoreWrites] = required(dependencies.writeRows.mock.calls[0]);
    expect(restoreWrites.map((write: { table: string }) => write.table)).toEqual([
      "payment_sources",
      "credit_card_statements",
    ]);
    expect(restoreWrites.every((write: { row: { deletedAt: null } }) => write.row.deletedAt === null)).toBe(true);
  });

  it("tombstones every old card statement during payment-source reassignment", async () => {
    const source = { id: "source-1", user_id: "user-1", type: "credit_card", deleted_at: null };
    const statement = {
      id: "statement-1",
      user_id: "user-1",
      payment_source_id: "source-1",
      period_month: "2026-07",
      deleted_at: null,
    };
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async () => source,
      getAllAsync: async (sql: string) => sql.includes("credit_card_statements") ? [statement] : [],
    });

    await repository.reassignAndDeletePaymentSource("user-1", "source-1", null);
    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    expect(writes.map((write: { table: string }) => write.table)).toEqual([
      "credit_card_statements",
      "payment_sources",
    ]);
    expect(writes[0].row.deletedAt).toBe(NOW);
  });

  it("writes a replacement opening anchor atomically", async () => {
    await repository.setOpeningBalance("user-1", "2026-07", 12_345);
    expect(dependencies.writeRows).toHaveBeenCalledTimes(1);
    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    expect(writes.map((write: { row: { key: string } }) => write.row.key)).toEqual([
      "start_month",
      "opening_balance_minor",
    ]);
    expect(dependencies.writeSetting).not.toHaveBeenCalled();
  });

  it("seeds every onboarding row AND the ledger anchor in ONE write", async () => {
    await repository.seedWorkspace("user-1", {
      templateCategories: [{ name: "Market", kind: "expense", isColumn: true, icon: "🛒" }],
      startMonth: "2026-07",
      openingBalanceMinor: 12_345,
      persons: [
        { name: "Ben", isSelf: true },
        { name: "Ada", isSelf: false },
      ],
      sources: [{
        name: "Ada Nakit",
        type: "cash",
        personIndex: 1,
        statementDay: null,
        dueDay: null,
      }],
    });

    expect(dependencies.writeRows).toHaveBeenCalledTimes(1);
    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    // start_month and opening_balance_minor are ONE semantic unit that
    // useLedgerState consumes together. They used to be two further
    // writeSetting transactions AFTER this one, so a failure between them
    // anchored the ledger at the new month with the PREVIOUS opening balance.
    expect(writes.map((write: { table: string }) => write.table)).toEqual([
      "persons",
      "persons",
      "payment_sources",
      "categories",
      "settings",
      "settings",
    ]);
    expect(writes[2].row.personId).toBe("id:onboardingPerson|user-1|1");
    expect(dependencies.settingRow.mock.calls).toEqual([
      ["user-1", "start_month", "2026-07"],
      ["user-1", "opening_balance_minor", 12_345],
    ]);
    expect(dependencies.writeSetting).not.toHaveBeenCalled();
  });

  it("rejects an onboarding graph without exactly one self person", async () => {
    await expect(repository.seedWorkspace("user-1", {
      templateCategories: [],
      startMonth: "2026-07",
      openingBalanceMinor: 0,
      persons: [{ name: "Ada", isSelf: false }],
      sources: [],
    })).rejects.toThrow("exactly one self person");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  /**
   * `canceled_at` models the CURRENT cancellation, not the first one in the
   * subscription's lifetime: reactivating clears it and a later cancellation
   * stamps a fresh date. `upsertSubscription` (via `subscription-form.tsx`) is
   * the only writer of `is_active` for subscriptions, so these four transitions
   * are the complete state space.
   */
  const NOW = "2026-07-16T00:00:00.000Z";
  const FIRST_CANCELLATION = "2026-01-05T09:00:00.000Z";

  async function saveSubscription(
    stored: { amount_minor: number; currency: string; canceled_at: string | null } | null,
    overrides: { isActive: boolean; amountMinor?: number; note?: string | null },
  ) {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) =>
        sql.includes("FROM categories") ? { id: "cat-1" }
        : sql.includes("FROM persons") ? { is_self: 1 }
        : sql.includes("FROM subscriptions") ? stored
        : null,
      getAllAsync: async () => [],
    });
    await repository.upsertSubscription("user-1", {
      id: "sub-1",
      name: "Netflix",
      amountMinor: overrides.amountMinor ?? 4_990,
      currency: "TRY",
      cycle: "monthly",
      intervalMonths: 1,
      billingDay: 5,
      nextDueDate: "2026-08-05",
      paymentSourceId: null,
      categoryId: "cat-1",
      personId: "person-1",
      isActive: overrides.isActive,
      trialEndDate: null,
      autoPay: false,
      websiteDomain: null,
      note: overrides.note ?? null,
    });
    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    return {
      subscription: writes.find((write: { table: string }) => write.table === "subscriptions"),
      wrotePriceHistory: writes.some((write: { table: string }) => write.table === "price_history"),
    };
  }

  it("stamps a cancellation date when an active subscription is switched off", async () => {
    const { subscription } = await saveSubscription(
      { amount_minor: 4_990, currency: "TRY", canceled_at: null },
      { isActive: false },
    );
    expect(subscription.row.canceledAt).toBe(NOW);
  });

  it("keeps the original cancellation date when an inactive subscription is edited", async () => {
    const { subscription, wrotePriceHistory } = await saveSubscription(
      { amount_minor: 4_990, currency: "TRY", canceled_at: FIRST_CANCELLATION },
      { isActive: false, note: "kapatıldı" },
    );
    expect(subscription.row.canceledAt).toBe(FIRST_CANCELLATION);
    // An unchanged price must not append a new price-history row either.
    expect(wrotePriceHistory).toBe(false);
  });

  it("clears the cancellation date when a subscription is reactivated", async () => {
    const { subscription } = await saveSubscription(
      { amount_minor: 4_990, currency: "TRY", canceled_at: FIRST_CANCELLATION },
      { isActive: true },
    );
    expect(subscription.row.canceledAt).toBeNull();
  });

  it("stamps a fresh date on a second cancellation, never the first one", async () => {
    // State after the reactivation above: live row, cleared timestamp.
    const { subscription } = await saveSubscription(
      { amount_minor: 4_990, currency: "TRY", canceled_at: null },
      { isActive: false },
    );
    expect(subscription.row.canceledAt).toBe(NOW);
    expect(subscription.row.canceledAt).not.toBe(FIRST_CANCELLATION);
  });

  it("records price history when an inactive subscription's amount changes", async () => {
    const { wrotePriceHistory } = await saveSubscription(
      { amount_minor: 4_990, currency: "TRY", canceled_at: FIRST_CANCELLATION },
      { isActive: false, amountMinor: 5_990 },
    );
    expect(wrotePriceHistory).toBe(true);
  });

  it("does not revive a subscription deleted while its edit form was open", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => sql.includes("FROM categories")
        ? { id: "cat-1" }
        : sql.includes("FROM persons")
          ? { is_self: 1 }
          : sql.includes("FROM subscriptions")
            ? { amount_minor: 4_990, currency: "TRY", canceled_at: null, deleted_at: NOW }
            : null,
      getAllAsync: async () => [],
    });

    await expect(repository.upsertSubscription("user-1", {
      id: "sub-1",
      name: "Netflix",
      amountMinor: 4_990,
      currency: "TRY",
      cycle: "monthly",
      intervalMonths: 1,
      billingDay: 5,
      nextDueDate: "2026-08-05",
      paymentSourceId: null,
      categoryId: "cat-1",
      personId: "person-1",
      isActive: true,
      trialEndDate: null,
      autoPay: false,
      websiteDomain: null,
      note: null,
    })).rejects.toThrow("Cannot revive deleted subscriptions row through an edit");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("rejects oversized onboarding text and money before any write", async () => {
    await expect(repository.seedWorkspace("user-1", {
      templateCategories: [],
      startMonth: "2026-07",
      openingBalanceMinor: 100_000_000_000_000,
      persons: [{ name: "Ben", isSelf: true }],
      sources: [],
    })).rejects.toThrow("supported range");
    await expect(repository.seedWorkspace("user-1", {
      templateCategories: [],
      startMonth: "2026-07",
      openingBalanceMinor: 0,
      persons: [{ name: "x".repeat(121), isSelf: true }],
      sources: [],
    })).rejects.toThrow("maximum length");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });
});

/**
 * Replace mode must never silently become add mode.
 *
 * `importBatchMap` used to DROP a year whose batch record failed to parse, so
 * `priorBatches.get(year)` was `undefined`, the cleanup list for that year came
 * out empty, and the previous import's rows stayed live while the new ones were
 * written on top — a doubled year with no error at all.
 */
describe("replace-mode import with an unreadable batch", () => {
  beforeEach(() => {
    dependencies.writeRows.mockReset();
    dependencies.getSqliteAsync.mockResolvedValue({
      getAllAsync: async (sql: string) =>
        sql.includes("import_batch:")
          ? [{ key: "import_batch:2026", value: "{not json" }]
          : [],
      getFirstAsync: async (sql: string) => sql.includes("FROM persons") ? { id: "person-self" } : undefined,
      runAsync: async () => undefined,
    });
    dependencies.readSetting.mockResolvedValue(null);
  });

  const request = {
    sheets: [{
      name: "2026",
      orientation: "vertical" as const,
      months: ["2026-01"],
      columns: [{ label: "Market", kind: "expense" as const }],
      cells: [],
      notes: [],
      installmentPlans: [],
    }],
    excludedLabels: [],
    selfId: "person-self",
  };

  it("refuses the import and writes NOTHING", async () => {
    await expect(
      repository.importSheets("user-1", { ...request, mode: "replace" } as never),
    ).rejects.toBeInstanceOf(repository.ImportBatchUnreadableError);
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("names the blocked year so the user knows what to clean", async () => {
    await repository
      .importSheets("user-1", { ...request, mode: "replace" } as never)
      .then(
        () => { throw new Error("expected a refusal"); },
        (error: { years: number[] }) => expect(error.years).toEqual([2026]),
      );
  });

  it("also refuses add mode because it would overwrite the only ownership index", async () => {
    await expect(
      repository.importSheets("user-1", { ...request, mode: "add" } as never),
    ).rejects.toBeInstanceOf(repository.ImportBatchUnreadableError);
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("rejects a stale or foreign self owner before planning any import writes", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getAllAsync: async () => [],
      getFirstAsync: async () => undefined,
      runAsync: async () => undefined,
    });
    await expect(
      repository.importSheets("user-1", { ...request, selfId: "person-from-user-2", mode: "add" } as never),
    ).rejects.toThrow("live self person");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });
});
