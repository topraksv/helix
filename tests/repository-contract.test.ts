import { beforeEach, describe, expect, it, vi } from "vitest";
import { required } from "./helpers";

const dependencies = vi.hoisted(() => ({
  getSqliteAsync: vi.fn(),
  readSetting: vi.fn(),
  writeRows: vi.fn(),
  writeSetting: vi.fn(),
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
  fromDbShape: vi.fn(),
  nowIso: () => "2026-07-16T00:00:00.000Z",
  readSetting: dependencies.readSetting,
  settingRow: dependencies.settingRow,
  softDelete: vi.fn(),
  writeRows: dependencies.writeRows,
  writeSetting: dependencies.writeSetting,
}));
vi.mock("../src/services/fx-fetch", () => ({ lookupRate: vi.fn() }));
vi.mock("../src/services/markets", () => ({ marketSellRateTry: vi.fn() }));

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
  });

  it("keeps the existing runtime API available from data/repo", () => {
    for (const name of publicRuntimeExports) expect(repository[name]).toBeDefined();
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
      getFirstAsync: async () => undefined,
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

  it("still allows add mode, which does not depend on knowing what to remove", async () => {
    await repository.importSheets("user-1", { ...request, mode: "add" } as never);
    expect(dependencies.writeRows).toHaveBeenCalled();
  });
});
