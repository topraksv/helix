import { beforeEach, describe, expect, it, vi } from "vitest";
import { required } from "./helpers";

const dependencies = vi.hoisted(() => ({
  getSqliteAsync: vi.fn(),
  readSetting: vi.fn(),
  writeRows: vi.fn(),
  writeSetting: vi.fn(),
  deterministicId: vi.fn(async (key: string) => `id:${key}`),
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

  it("seeds related onboarding rows in one write before applying the anchor", async () => {
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
    expect(writes.map((write: { table: string }) => write.table)).toEqual([
      "persons",
      "persons",
      "payment_sources",
      "categories",
    ]);
    expect(writes[2].row.personId).toBe("id:onboardingPerson|user-1|1");
    expect(dependencies.writeSetting.mock.calls).toEqual([
      ["user-1", "start_month", "2026-07"],
      ["user-1", "opening_balance_minor", 12_345],
    ]);
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
