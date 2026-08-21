import { beforeEach, describe, expect, it, vi } from "vitest";
import { required } from "./helpers";
import { addDaysISO, todayISO } from "../src/domain/dates";

const dependencies = vi.hoisted(() => ({
  getSqliteAsync: vi.fn(),
  readSetting: vi.fn(),
  writeRows: vi.fn(),
  restoreRows: vi.fn(),
  restoreRow: vi.fn(),
  writeRowsValidated: vi.fn(),
  writeSetting: vi.fn(),
  assertLiveRow: vi.fn(async (sqlite: { getFirstAsync: (sql: string, args: unknown[]) => Promise<unknown> }, table: string, userId: string, id: string) => {
    const row = await sqlite.getFirstAsync(`SELECT id FROM ${table} WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, [id, userId]);
    if (!row || typeof row !== "object" || !("id" in row)) throw new Error(`Cannot edit missing ${table} row`);
  }),
  assertRestorableRows: vi.fn(async () => {}),
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
  restoreRows: dependencies.restoreRows,
  restoreRow: dependencies.restoreRow,
  writeRowsValidated: dependencies.writeRowsValidated,
  assertLiveRow: dependencies.assertLiveRow,
  assertRestorableRows: dependencies.assertRestorableRows,
  writeSetting: dependencies.writeSetting,
}));
vi.mock("../src/services/fx-fetch", () => ({ lookupRate: vi.fn() }));
vi.mock("../src/services/markets", () => ({ marketSellRateTry: vi.fn() }));
vi.mock("../src/sync/engine", () => ({ scheduleSync: vi.fn() }));

import * as repository from "../src/data/repo";
import { buildPlanRows, linkDueRowsToCardStatements, type NewPlan } from "../src/data/repo/installments";

const publicRuntimeExports = [
  "TEMPLATE_CATEGORIES",
  "TEMPLATE_EXTRA_CATEGORIES",
  "ReferencedRecordError",
  "CreditCardCycleRequiredError",
  "InstallmentHistoryConflictError",
  "SubscriptionCategoryRequiredError",
  "FxRateUnavailableError",
  "seedWorkspace",
  "setOpeningBalance",
  "finalizeOnboarding",
  "upsertPaymentSource",
  "createCategory",
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
  "removeInvestmentProductHistory",
  "categoryReferenceUsage",
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
  "setExpectedAmount",
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
    dependencies.getSqliteAsync.mockResolvedValue({
      getAllAsync: async () => [],
      getFirstAsync: async () => null,
    });
    dependencies.readSetting.mockResolvedValue(null);
    dependencies.restoreRows.mockImplementation(async (userId: string, writes: unknown[]) => {
      dependencies.writeRows(userId, writes);
    });
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

  it("rejects unknown payment source types before touching persistence", async () => {
    await expect(repository.upsertPaymentSource("user-1", {
      name: "Bilinmeyen",
      type: "crypto_wallet" as never,
      personId: "person-1",
      dueDay: null,
      statementDay: null,
    })).rejects.toThrow("Invalid payment source type");
    expect(dependencies.getSqliteAsync).not.toHaveBeenCalled();
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("rejects malformed category classification before touching persistence", async () => {
    await expect(repository.createCategory("user-1", {
      name: "Bilinmeyen",
      kind: "other" as never,
      isTransfer: false,
      sortOrder: 0,
    })).rejects.toThrow("Invalid category kind");
    await expect(repository.createCategory("user-1", {
      name: "Bilinmeyen",
      kind: "expense",
      isTransfer: "yes" as never,
      sortOrder: 0,
    })).rejects.toThrow("Invalid category transfer flag");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("moves a card purchase to its statement due date atomically", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM persons")) return { id: "person-1" };
        if (sql.includes("FROM categories")) return { kind: "expense", is_transfer: 0 };
        if (sql.includes("FROM payment_sources")) {
          return { id: "card-1", type: "credit_card", statement_day: 25, due_day: 5 };
        }
        return null;
      },
      getAllAsync: async () => [],
    });

    await repository.addTransaction("user-1", {
      type: "expense",
      amountMinor: 12_345,
      currency: "TRY",
      fxRate: null,
      amountTryMinor: 12_345,
      effectiveDate: "2026-07-26",
      categoryId: "category-1",
      paymentSourceId: "card-1",
      personId: "person-1",
      note: "Kart alışverişi",
    });

    const [, writes] = required(dependencies.writeRows.mock.calls[0]) as [
      string,
      { table: string; row: Record<string, unknown> }[],
    ];
    expect(writes.map((write) => write.table)).toEqual(["credit_card_statements", "transactions"]);
    expect(writes[0]?.row).toMatchObject({
      periodMonth: "2026-08",
      statementDate: "2026-08-25",
      dueDate: "2026-09-05",
    });
    expect(writes[1]?.row).toMatchObject({
      purchaseDate: "2026-07-26",
      effectiveDate: "2026-09-05",
      cardStatementId: writes[0]?.row.id,
      amountMinor: 12_345,
      amountTryMinor: 12_345,
    });
  });

  it("rejects a card purchase without a valid statement cycle before writing", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM persons")) return { id: "person-1" };
        if (sql.includes("FROM categories")) return { kind: "expense", is_transfer: 0 };
        if (sql.includes("FROM payment_sources")) {
          return { id: "card-1", type: "credit_card", statement_day: null, due_day: 5 };
        }
        return null;
      },
      getAllAsync: async () => [],
    });

    await expect(repository.addTransaction("user-1", {
      type: "expense",
      amountMinor: 1_000,
      currency: "TRY",
      fxRate: null,
      amountTryMinor: 1_000,
      effectiveDate: "2026-07-26",
      categoryId: "category-1",
      paymentSourceId: "card-1",
      personId: "person-1",
      note: null,
    })).rejects.toBeInstanceOf(repository.CreditCardCycleRequiredError);
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

  it("rejects an installment plan person that is not live in the current account", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => sql.includes("FROM persons")
        ? null
        : { kind: "expense", is_transfer: 0 },
      getAllAsync: async () => [],
    });

    await expect(repository.createInstallmentPlan("user-1", {
      title: "Kredi",
      kind: "loan",
      totalAmountMinor: null,
      monthlyAmountMinor: 1_000,
      installmentCount: 2,
      currency: "TRY",
      fxRate: null,
      startMonth: "2026-07",
      dueDay: 5,
      paymentSourceId: null,
      personId: "person-from-another-account",
      personIsSelf: true,
      categoryId: "category-1",
      note: null,
      tryFactor: 1,
    })).rejects.toThrow("Transaction person does not exist");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("rejects a loan payment source that is not live in the current account", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM persons")) return { id: "person-1" };
        if (sql.includes("FROM categories")) return { kind: "expense", is_transfer: 0 };
        if (sql.includes("FROM payment_sources")) return null;
        return null;
      },
      getAllAsync: async () => [],
    });

    await expect(repository.createInstallmentPlan("user-1", {
      title: "Kredi",
      kind: "loan",
      totalAmountMinor: null,
      monthlyAmountMinor: 1_000,
      installmentCount: 2,
      currency: "TRY",
      fxRate: null,
      startMonth: "2026-07",
      dueDay: 5,
      paymentSourceId: "source-from-another-account",
      personId: "person-1",
      personIsSelf: true,
      categoryId: "category-1",
      note: null,
      tryFactor: 1,
    })).rejects.toThrow("Installment payment source does not exist");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("rejects malformed installment values before materializing rows", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => sql.includes("FROM persons")
        ? { id: "person-1" }
        : { kind: "expense", is_transfer: 0 },
      getAllAsync: async () => [],
    });
    const input = {
      title: "Kredi",
      kind: "loan" as const,
      totalAmountMinor: null,
      monthlyAmountMinor: 10_000,
      installmentCount: 3,
      currency: "TRY",
      fxRate: null,
      startMonth: "2026-07" as const,
      dueDay: 5,
      paymentSourceId: null,
      personId: "person-1",
      personIsSelf: true,
      categoryId: "category-1",
      note: null,
      tryFactor: 1,
    };

    await expect(repository.createInstallmentPlan("user-1", { ...input, startMonth: "2026-99" as never }))
      .rejects.toThrow("Invalid installment start month");
    await expect(repository.createInstallmentPlan("user-1", { ...input, installmentCount: 0 }))
      .rejects.toThrow("Invalid installment count");
    await expect(repository.createInstallmentPlan("user-1", { ...input, monthlyAmountMinor: -1 }))
      .rejects.toThrow("Installment amount must be positive");
    await expect(repository.createInstallmentPlan("user-1", { ...input, tryFactor: 0 }))
      .rejects.toThrow("Invalid installment FX factor");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
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

  it("refuses a person reassignment that would overdraw investment cash", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => {
        if (sql.includes("is_self = 0")) return { id: "watch", user_id: "user-1", is_self: 0, deleted_at: null };
        if (sql.includes("FROM persons")) return { id: "self" };
        return null;
      },
      getAllAsync: async (sql: string) => {
        if (sql.includes("FROM investment_profiles")) {
          return [{
            id: "profile", user_id: "user-1", started_on: "2026-01-01",
            opening_cash_minor: 10_000, deleted_at: null,
          }];
        }
        if (sql.includes("FROM transactions")) {
          return [{
            id: "watch-withdrawal", user_id: "user-1", type: "transfer", status: "realized",
            category_id: "transfer", person_id: "watch", effective_date: "2026-07-03",
            amount_try_minor: -20_000, deleted_at: null,
          }];
        }
        if (sql.includes("FROM categories")) {
          return [{ id: "transfer", user_id: "user-1", is_transfer: 1, deleted_at: null }];
        }
        if (sql.includes("FROM persons")) {
          return [
            { id: "self", user_id: "user-1", is_self: 1, deleted_at: null },
            { id: "watch", user_id: "user-1", is_self: 0, deleted_at: null },
          ];
        }
        return [];
      },
    });
    dependencies.writeRows.mockImplementationOnce(() => {
      throw new Error("unsafe unvalidated write");
    });
    dependencies.writeRowsValidated.mockImplementationOnce(async (
      _userId: string,
      writes: { table: string; row: Record<string, unknown> }[],
      validate: (sqlite: unknown) => Promise<void>,
    ) => {
      expect(writes.find((write) => write.table === "transactions")?.row.personId).toBe("self");
      await validate(await dependencies.getSqliteAsync());
    });

    try {
      await expect(repository.reassignAndDeletePerson("user-1", "watch", "self"))
        .rejects.toThrow("insufficient investment cash");
    } finally {
      dependencies.writeRows.mockReset();
      dependencies.writeRowsValidated.mockReset();
    }
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

  it("requires a variable subscription's real amount before confirmation", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM expected_payments")) {
          return {
            id: "expected-1", direction: "out", kind: "subscription", ref_id: "subscription-1",
            due_date: "2026-07-15", amount_minor: 5_000, amount_is_estimated: 1,
            currency: "TRY", status: "pending", transaction_id: null,
          };
        }
        if (sql.includes("FROM subscriptions")) return { amount_mode: "variable" };
        return null;
      },
    });

    await expect(repository.confirmExpected("user-1", "expected-1", {
      personId: "person-1",
      categoryId: "category-1",
    })).rejects.toThrow("Variable subscription amount must be entered before confirmation");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("saves a variable subscription amount on only the pending expected row", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => sql.includes("FROM expected_payments")
        ? {
            id: "expected-1", direction: "out", kind: "subscription", ref_id: "subscription-1",
            due_date: "2026-07-15", amount_minor: 5_000, amount_is_estimated: 1,
            currency: "TRY", status: "pending", transaction_id: null,
          }
        : { amount_mode: "variable" },
    });

    await repository.setExpectedAmount("user-1", "expected-1", 7_250);
    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.table).toBe("expected_payments");
    expect(writes[0]?.row).toMatchObject({ amountMinor: 7_250, amountIsEstimated: false });
  });

  function expectedSqlite(over: { expected?: Record<string, unknown>; subscription?: Record<string, unknown> | null; source?: Record<string, unknown> | null } = {}) {
    return {
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM expected_payments")) {
          return {
            id: "expected-1", direction: "out", kind: "subscription", ref_id: "subscription-1",
            due_date: "2026-07-15", amount_minor: 5_000, amount_is_estimated: 0,
            currency: "TRY", status: "pending", transaction_id: null,
            ...over.expected,
          };
        }
        if (sql.includes("FROM subscriptions")) {
          return over.subscription === undefined
            ? {
                person_id: "person-1", category_id: "category-1", amount_mode: "fixed",
                payment_source_id: null, next_due_date: "2026-07-15", interval_months: 1, billing_day: 15,
              }
            : over.subscription;
        }
        if (sql.includes("FROM payment_sources")) return over.source ?? null;
        if (sql.includes("FROM persons")) return { id: "person-1" };
        if (sql.includes("FROM categories")) return { kind: "expense", is_transfer: 0 };
        return null;
      },
    };
  }

  it("puts a card-paid subscription on the statement its purchase date falls in", async () => {
    // Paying by credit card does not move money on the due date -- it moves it
    // when that card's statement is due. The ledger row has to say so, or the
    // month's cash flow would show the charge in the wrong month entirely.
    dependencies.getSqliteAsync.mockResolvedValue(expectedSqlite({
      subscription: {
        person_id: "person-1", category_id: "category-1", amount_mode: "fixed",
        payment_source_id: "card-1", next_due_date: "2026-07-15", interval_months: 1, billing_day: 15,
      },
      source: { id: "card-1", type: "credit_card", statement_day: 20, due_day: 10 },
    }));

    await repository.confirmExpected("user-1", "expected-1", { personId: "person-1", categoryId: "category-1" });

    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    const statement = writes.find((write: { table: string }) => write.table === "credit_card_statements");
    const transaction = writes.find((write: { table: string }) => write.table === "transactions");
    expect(statement).toBeDefined();
    expect(transaction?.row.cardStatementId).toBe(statement?.row.id);
    // The effective date is the statement's due date, not the expected row's.
    expect(transaction?.row.effectiveDate).not.toBe("2026-07-15");
  });

  it("advances the subscription's next due date when its payment is confirmed", async () => {
    // Confirming July's payment is what makes August's appear. Without this the
    // rule would keep re-offering the month that was already paid.
    dependencies.getSqliteAsync.mockResolvedValue(expectedSqlite());

    await repository.confirmExpected("user-1", "expected-1", { personId: "person-1", categoryId: "category-1" });

    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    const rule = writes.find((write: { table: string }) => write.table === "subscriptions");
    expect(rule?.row.nextDueDate).toBe("2026-08-15");
  });

  function paidSqlite(transactionOrigin: string | null, over: Record<string, unknown> = {}) {
    return {
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM expected_payments")) {
          return {
            id: "expected-1", direction: "out", kind: "subscription", ref_id: "subscription-1",
            due_date: "2026-07-15", amount_minor: 5_000, amount_is_estimated: 0, currency: "TRY",
            status: "paid", transaction_id: "tx-1", ...over,
          };
        }
        if (sql.includes("FROM subscriptions")) {
          return {
            id: "subscription-1", person_id: "person-1", category_id: "category-1",
            next_due_date: "2026-08-15", interval_months: 1, billing_day: 15,
          };
        }
        if (sql.includes("FROM transactions")) return { id: "tx-1", origin: transactionOrigin, amount_minor: 5_000 };
        return null;
      },
    };
  }

  it("undoes a confirmation by removing the row it created and rolling the rule back", async () => {
    dependencies.getSqliteAsync.mockResolvedValue(paidSqlite("expected"));

    await repository.revertExpected("user-1", "expected-1");

    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    const transaction = writes.find((write: { table: string }) => write.table === "transactions");
    const expected = writes.find((write: { table: string }) => write.table === "expected_payments");
    const rule = writes.find((write: { table: string }) => write.table === "subscriptions");
    expect(transaction?.row.deletedAt).toBe(NOW);
    expect(expected?.row).toMatchObject({ status: "pending", paidAt: null, transactionId: null, autoConfirmed: false });
    // The month becomes due again, so the rule has to point back at it.
    expect(rule?.row.nextDueDate).toBe("2026-07-15");
  });

  it("only unlinks a transaction the owner had already recorded, never deletes it", async () => {
    // A MATCHED transaction is the owner's own record of real money. The undo
    // owns the link, not the money -- deleting it would destroy data the
    // expectation never created.
    dependencies.getSqliteAsync.mockResolvedValue(paidSqlite("manual"));

    await repository.revertExpected("user-1", "expected-1");

    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    expect(writes.some((write: { table: string }) => write.table === "transactions")).toBe(false);
    expect(writes.find((write: { table: string }) => write.table === "expected_payments")?.row)
      .toMatchObject({ status: "pending", transactionId: null });
  });

  it("does nothing when the payment was never confirmed", async () => {
    dependencies.getSqliteAsync.mockResolvedValue(paidSqlite("expected", { status: "pending" }));
    await repository.revertExpected("user-1", "expected-1");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("edits an invoice amount only where a variable amount actually exists", async () => {
    // A fixed subscription's amount lives on the rule, not on the month, and a
    // recurring income has no invoice at all. Editing either here would write a
    // number the rule would immediately contradict.
    dependencies.getSqliteAsync.mockResolvedValue(expectedSqlite({ expected: { kind: "recurring_income" } }));
    await expect(repository.setExpectedAmount("user-1", "expected-1", 7_250))
      .rejects.toThrow("Only subscription amounts can be edited");

    dependencies.getSqliteAsync.mockResolvedValue(expectedSqlite({ subscription: null }));
    await expect(repository.setExpectedAmount("user-1", "expected-1", 7_250))
      .rejects.toThrow("Expected payment source rule does not exist");

    dependencies.getSqliteAsync.mockResolvedValue(expectedSqlite());
    await expect(repository.setExpectedAmount("user-1", "expected-1", 7_250))
      .rejects.toThrow("Only variable subscription amounts can be edited");

    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("refuses to confirm against a date the ledger cannot place", async () => {
    dependencies.getSqliteAsync.mockResolvedValue(expectedSqlite({ expected: { due_date: "not-a-date" } }));
    await expect(repository.confirmExpected("user-1", "expected-1", { personId: "person-1", categoryId: "category-1" }))
      .rejects.toThrow("Invalid expected payment date");

    dependencies.getSqliteAsync.mockResolvedValue(expectedSqlite());
    await expect(repository.confirmExpected("user-1", "expected-1", {
      personId: "person-1", categoryId: "category-1", paidOn: "15/07/2026" as never,
    })).rejects.toThrow("Invalid expected payment date");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("refuses to confirm a payment whose rule has gone", async () => {
    // The rule carries the category and person the transaction is written with.
    // Without it there is nothing to write the payment against.
    dependencies.getSqliteAsync.mockResolvedValue(expectedSqlite({ subscription: null }));
    await expect(repository.confirmExpected("user-1", "expected-1", { personId: "person-1", categoryId: "category-1" }))
      .rejects.toThrow("Expected payment source rule does not exist");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("confirms a variable subscription using the entered amount in both ledger rows", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM expected_payments")) {
          return {
            id: "expected-1", direction: "out", kind: "subscription", ref_id: "subscription-1",
            due_date: "2026-07-15", amount_minor: 5_000, amount_is_estimated: 1,
            currency: "TRY", status: "pending", transaction_id: null,
          };
        }
        if (sql.includes("FROM subscriptions")) {
          return {
            person_id: "person-1", category_id: "category-1", amount_mode: "variable",
            payment_source_id: null, next_due_date: "2026-07-15", interval_months: 1, billing_day: 15,
          };
        }
        if (sql.includes("FROM persons")) return { id: "person-1" };
        if (sql.includes("FROM categories")) return { kind: "expense", is_transfer: 0 };
        return null;
      },
    });

    await repository.confirmExpected("user-1", "expected-1", {
      personId: "person-1", categoryId: "category-1", actualAmountMinor: 7_250,
    });
    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    expect(writes.find((write: { table: string }) => write.table === "transactions")?.row.amountMinor).toBe(7_250);
    expect(writes.find((write: { table: string }) => write.table === "expected_payments")?.row).toMatchObject({
      amountMinor: 7_250,
      amountIsEstimated: false,
      status: "paid",
    });
  });

  it("does not let a confirmation reassign a rule to another live person", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM expected_payments")) {
          return {
            id: "expected-1",
            direction: "out",
            kind: "subscription",
            ref_id: "subscription-1",
            due_date: "2026-07-15",
            amount_minor: 5_000,
            currency: "TRY",
            status: "pending",
            transaction_id: null,
          };
        }
        if (sql.includes("FROM persons")) return { is_self: 1 };
        if (sql.includes("FROM subscriptions")) return { person_id: "watch", category_id: "category-1" };
        if (sql.includes("FROM categories")) return { kind: "expense", is_transfer: 0 };
        return null;
      },
    });

    await expect(repository.confirmExpected("user-1", "expected-1", {
      personId: "self",
      categoryId: "category-1",
    })).rejects.toThrow("Expected payment person does not match source rule");
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

  it("rewinds a subscription schedule when undoing its confirmation", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM subscriptions")) {
          return {
            id: "subscription-1",
            next_due_date: "2026-08-10",
            interval_months: 1,
            billing_day: 10,
          };
        }
        if (sql.includes("FROM transactions")) return { id: "transaction-1", deleted_at: null };
        return {
          id: "expected-1",
          direction: "out",
          kind: "subscription",
          ref_id: "subscription-1",
          due_date: "2026-07-10",
          amount_minor: 5_000,
          currency: "TRY",
          status: "paid",
          transaction_id: "transaction-1",
        };
      },
    });

    await repository.revertExpected("user-1", "expected-1");
    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    expect(writes.find((write: { table: string }) => write.table === "subscriptions")?.row.nextDueDate)
      .toBe("2026-07-10");
    expect(writes.find((write: { table: string }) => write.table === "transactions")?.row.deletedAt)
      .toBe(NOW);
    expect(writes.find((write: { table: string }) => write.table === "expected_payments")?.row.status)
      .toBe("pending");
  });

  /**
   * Undo removes what the confirmation CREATED and nothing else.
   *
   * Matching points an expectation at a payment the owner had already
   * recorded. Undoing that link must unlink it; deleting the transaction would
   * destroy a record of real money that the expectation never owned.
   */
  it.each([
    ["expected", true],
    [null, true],
    ["manual", false],
    ["statement", false],
    ["spreadsheet", false],
  ])("reverting a confirmation deletes an origin=%s transaction: %s", async (origin, deleted) => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM subscriptions")) return null;
        if (sql.includes("FROM transactions")) return { id: "transaction-1", deleted_at: null, origin };
        return {
          id: "expected-1",
          direction: "out",
          kind: "recurring_income",
          ref_id: "income-1",
          due_date: "2026-07-10",
          amount_minor: 5_000,
          currency: "TRY",
          status: "paid",
          transaction_id: "transaction-1",
        };
      },
    });

    await repository.revertExpected("user-1", "expected-1");
    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    const transactionWrite = writes.find((write: { table: string }) => write.table === "transactions");
    expect(Boolean(transactionWrite)).toBe(deleted);
    // The expectation is released either way — that is what undo means.
    expect(writes.find((write: { table: string }) => write.table === "expected_payments")?.row.transactionId)
      .toBeNull();
  });

  it("does not rewind a subscription after a later confirmation advanced it again", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM subscriptions")) {
          return { next_due_date: "2026-09-10", interval_months: 1, billing_day: 10 };
        }
        if (sql.includes("FROM transactions")) return { id: "transaction-1", deleted_at: null };
        return {
          id: "expected-1",
          direction: "out",
          kind: "subscription",
          ref_id: "subscription-1",
          due_date: "2026-07-10",
          amount_minor: 5_000,
          currency: "TRY",
          status: "paid",
          transaction_id: "transaction-1",
        };
      },
    });

    await repository.revertExpected("user-1", "expected-1");
    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    expect(writes.some((write: { table: string }) => write.table === "subscriptions")).toBe(false);
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

  it("tombstones seeded rows removed before onboarding commit", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getAllAsync: async (sql: string) => {
        if (sql.includes("FROM persons")) {
          return [{ id: "id:onboardingPerson|user-1|1", userId: "user-1", name: "Ada", isSelf: false, deletedAt: null }];
        }
        if (sql.includes("FROM payment_sources")) {
          return [{ id: "id:onboardingSource|user-1|0", userId: "user-1", name: "Ada Nakit", type: "cash", personId: "id:onboardingPerson|user-1|1", deletedAt: null }];
        }
        if (sql.includes("FROM categories")) {
          return [{ id: "id:seedCategory|user-1|Market", userId: "user-1", name: "Market", kind: "expense", isColumn: true, isTransfer: false, deletedAt: null }];
        }
        return [];
      },
    });

    await repository.seedWorkspace("user-1", {
      templateCategories: [],
      startMonth: "2026-07",
      openingBalanceMinor: 0,
      persons: [{ name: "Ben", isSelf: true }],
      sources: [],
    });

    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    const tombstones = writes.filter((write: { row: { deletedAt?: unknown } }) => write.row.deletedAt != null);
    expect(tombstones.map((write: { table: string; row: { id: string } }) => `${write.table}:${write.row.id}`)).toEqual([
      "persons:id:onboardingPerson|user-1|1",
      "payment_sources:id:onboardingSource|user-1|0",
      "categories:id:seedCategory|user-1|Market",
    ]);
  });

  it("rejects a seeded credit card that has no statement/due cycle", async () => {
    // Onboarding is where most cards are created. A card without a cycle cannot
    // place an instalment on a statement later, so it is refused at the seed
    // rather than discovered when the first card plan is built.
    await expect(repository.seedWorkspace("user-1", {
      templateCategories: [],
      startMonth: "2026-07",
      openingBalanceMinor: 0,
      persons: [{ name: "Ben", isSelf: true }],
      sources: [{ name: "Kart", type: "credit_card", personIndex: 0, statementDay: null, dueDay: null }],
    })).rejects.toBeInstanceOf(repository.CreditCardCycleRequiredError);
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("refuses an opening balance month that is malformed or still in the future", async () => {
    // The anchor is what every later balance is measured from, so a month the
    // ledger cannot place it in must fail loudly instead of anchoring at zero.
    const future = `${new Date().getUTCFullYear() + 1}-01` as const;
    for (const month of ["2026-99", "nope", future]) {
      await expect(repository.setOpeningBalance("user-1", month as never, 1_000))
        .rejects.toThrow("Invalid opening balance month");
    }
    await expect(repository.seedWorkspace("user-1", {
      templateCategories: [],
      startMonth: future as never,
      openingBalanceMinor: 0,
      persons: [{ name: "Ben", isSelf: true }],
      sources: [],
    })).rejects.toThrow("Invalid opening balance month");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("refuses a seeded source whose owner is not one of the seeded people", async () => {
    await expect(repository.seedWorkspace("user-1", {
      templateCategories: [],
      startMonth: "2026-07",
      openingBalanceMinor: 0,
      persons: [{ name: "Ben", isSelf: true }],
      sources: [{ name: "Kart", type: "cash", personIndex: 7, statementDay: null, dueDay: null }],
    })).rejects.toThrow("Onboarding payment source owner does not exist");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("keeps an earlier imported anchor rather than moving it forward", async () => {
    // An import can set a start month before onboarding finishes. Re-anchoring
    // to the later month would strand every row that came before it, so the
    // earlier month wins and no anchor row is written at all.
    dependencies.readSetting.mockResolvedValue("2024-01");

    await repository.seedWorkspace("user-1", {
      templateCategories: [],
      startMonth: "2026-07",
      openingBalanceMinor: 12_345,
      persons: [{ name: "Ben", isSelf: true }],
      sources: [],
    });

    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    const anchorKeys = writes
      .filter((write: { table: string }) => write.table === "settings")
      .map((write: { row: { key: string } }) => write.row.key);
    expect(anchorKeys).not.toContain("start_month");
    expect(anchorKeys).not.toContain("opening_balance_minor");
  });

  it("opens the app only by writing the onboarded flag", async () => {
    // The route guard reads this one setting; nothing else marks completion.
    await repository.finalizeOnboarding("user-1");
    expect(dependencies.writeSetting).toHaveBeenCalledWith("user-1", "onboarded", true);
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
        : sql.includes("FROM subscriptions") ? (stored ? { ...stored, id: "sub-1" } : null)
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

  it("rejects invalid subscription scheduling before writing a rule", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => sql.includes("FROM categories")
        ? { id: "cat-1" }
        : sql.includes("FROM persons") ? { is_self: 1 } : null,
      getAllAsync: async () => [],
    });
    const input = {
      name: "Netflix",
      amountMinor: 4_990,
      currency: "TRY",
      cycle: "monthly" as const,
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
    };

    await expect(repository.upsertSubscription("user-1", { ...input, intervalMonths: 0 }))
      .rejects.toThrow("Invalid subscription interval");
    await expect(repository.upsertSubscription("user-1", { ...input, intervalMonths: 13 }))
      .rejects.toThrow("Invalid subscription interval");
    await expect(repository.upsertSubscription("user-1", { ...input, amountMinor: -1 }))
      .rejects.toThrow("Subscription amount must be positive");
    await expect(repository.upsertSubscription("user-1", { ...input, billingDay: 0 }))
      .rejects.toThrow("Invalid subscription billing day");
    await expect(repository.upsertSubscription("user-1", { ...input, nextDueDate: "2026-02-31" as never }))
      .rejects.toThrow("Invalid subscription due date");
    await expect(repository.upsertSubscription("user-1", { ...input, cycle: "weekly" as never }))
      .rejects.toThrow("Invalid subscription cycle");
    // A trial end that is not a real date would silently never end.
    await expect(repository.upsertSubscription("user-1", { ...input, trialEndDate: "2026-13-01" as never }))
      .rejects.toThrow("Invalid subscription trial date");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("keeps a paid month and tombstones the months a deactivated rule no longer owes", async () => {
    // Editing a rule regenerates its expected payments. A month already PAID
    // must not come back as pending -- that would ask the owner to pay it
    // twice -- and a month the rule no longer owes has to be withdrawn.
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM categories")) return { id: "cat-1" };
        if (sql.includes("FROM persons")) return { is_self: 1 };
        if (sql.includes("FROM subscriptions")) return { id: "sub-1" };
        return null;
      },
      getAllAsync: async () => [
        {
          id: "expected-paid", user_id: "user-1", direction: "out", kind: "subscription", ref_id: "sub-1",
          due_date: "2026-07-05", amount_minor: 4_990, currency: "TRY", status: "paid", deleted_at: null,
        },
        {
          id: "expected-pending", user_id: "user-1", direction: "out", kind: "subscription", ref_id: "sub-1",
          due_date: "2026-08-05", amount_minor: 4_990, currency: "TRY", status: "pending", deleted_at: null,
        },
      ],
    });

    await repository.upsertSubscription("user-1", {
      id: "sub-1", name: "Netflix", amountMinor: 4_990, currency: "TRY", cycle: "monthly", intervalMonths: 1,
      billingDay: 5, nextDueDate: "2026-08-05", paymentSourceId: null, categoryId: "cat-1",
      personId: "person-1", isActive: false, trialEndDate: null, autoPay: false,
      websiteDomain: null, note: null,
    });

    const [, writes] = required(dependencies.writeRowsValidated.mock.calls[0]);
    const expectedWrites = writes.filter((write: { table: string }) => write.table === "expected_payments");
    const tombstoned = expectedWrites.filter((write: { row: { deletedAt?: unknown } }) => write.row.deletedAt != null);
    // The pending month is withdrawn; the paid one is never touched.
    expect(tombstoned.map((write: { row: { id: string } }) => write.row.id)).toEqual(["expected-pending"]);
    expect(expectedWrites.some((write: { row: { id: string } }) => write.row.id === "expected-paid")).toBe(false);
  });

  it("refuses a subscription billed to a card that has no statement cycle", async () => {
    // Without a cycle the charge cannot be placed on a statement, so every
    // month of this subscription would land on the wrong date.
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM categories")) return { id: "cat-1" };
        if (sql.includes("FROM persons")) return { is_self: 1 };
        if (sql.includes("FROM payment_sources")) {
          return { id: "card-1", type: "credit_card", statement_day: null, due_day: null };
        }
        return null;
      },
      getAllAsync: async () => [],
    });

    await expect(repository.upsertSubscription("user-1", {
      name: "Netflix", amountMinor: 4_990, currency: "TRY", cycle: "monthly", intervalMonths: 1,
      billingDay: 5, nextDueDate: "2026-08-05", paymentSourceId: "card-1", categoryId: "cat-1",
      personId: "person-1", isActive: true, trialEndDate: null, autoPay: false,
      websiteDomain: null, note: null,
    })).rejects.toBeInstanceOf(repository.CreditCardCycleRequiredError);
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("rejects a variable-amount subscription that also enables auto-pay", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => sql.includes("FROM categories")
        ? { id: "cat-1" }
        : sql.includes("FROM persons") ? { is_self: 1 } : null,
      getAllAsync: async () => [],
    });
    await expect(repository.upsertSubscription("user-1", {
      name: "Elektrik",
      amountMinor: 1_000_00,
      amountMode: "variable",
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
      autoPay: true,
      websiteDomain: null,
      note: null,
    })).rejects.toThrow("Variable subscriptions cannot use auto-pay");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("accepts a variable-amount subscription saved with no estimate at all", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => sql.includes("FROM categories")
        ? { id: "cat-1" }
        : sql.includes("FROM persons") ? { is_self: 1 } : null,
      getAllAsync: async () => [],
    });
    await repository.upsertSubscription("user-1", {
      name: "Elektrik",
      amountMinor: 0, // the "no estimate yet" sentinel — a real bill amount is never known
      amountMode: "variable",
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
    });
    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    const subscriptionWrite = writes.find((write: { table: string }) => write.table === "subscriptions");
    expect(subscriptionWrite?.row).toMatchObject({ amountMinor: 0, amountMode: "variable" });
  });

  it("still rejects a zero amount for a fixed subscription", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => sql.includes("FROM categories")
        ? { id: "cat-1" }
        : sql.includes("FROM persons") ? { is_self: 1 } : null,
      getAllAsync: async () => [],
    });
    await expect(repository.upsertSubscription("user-1", {
      name: "Netflix",
      amountMinor: 0,
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
    })).rejects.toThrow("Amount is outside the supported range");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("preserves a manually entered invoice amount when a variable subscription's rule is edited", async () => {
    // A bill due a few days out is inside every horizon this repository
    // generates, regardless of which real date the suite runs on.
    const dueDate = addDaysISO(todayISO(), 5);
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) =>
        sql.includes("FROM categories") ? { id: "cat-1" }
        : sql.includes("FROM persons") ? { is_self: 1 }
        : sql.includes("FROM subscriptions")
          ? { id: "sub-1", amount_minor: 1_000_00, currency: "TRY", canceled_at: null, amount_mode: "variable" }
          : null,
      getAllAsync: async (sql: string) => sql.includes("FROM expected_payments")
        ? [{
            id: "expected-1", direction: "out", kind: "subscription", ref_id: "sub-1",
            due_date: dueDate, amount_minor: 1_247_50, amount_is_estimated: 0,
            currency: "TRY", status: "pending",
          }]
        : [],
    });

    await repository.upsertSubscription("user-1", {
      id: "sub-1",
      name: "Elektrik",
      amountMinor: 1_100_00, // a new forecast entered while editing the rule
      amountMode: "variable",
      currency: "TRY",
      cycle: "monthly",
      intervalMonths: 1,
      billingDay: 5,
      nextDueDate: dueDate,
      paymentSourceId: null,
      categoryId: "cat-1",
      personId: "person-1",
      isActive: true,
      trialEndDate: null,
      autoPay: false,
      websiteDomain: null,
      note: null,
    });

    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    const expectedWrite = writes.find((write: { table: string }) => write.table === "expected_payments");
    // The already-entered invoice amount survives the edit; the new forecast
    // (1_100_00) must not silently overwrite what the user already typed in.
    expect(expectedWrite?.row).toMatchObject({ amountMinor: 1_247_50, amountIsEstimated: false });
  });

  it("rejects invalid recurring-income scheduling before writing a rule", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => sql.includes("FROM persons") ? { is_self: 1 } : { kind: "income" },
      getAllAsync: async () => [],
    });
    const input = {
      name: "Maaş",
      kind: "salary" as const,
      defaultAmountMinor: 50_000,
      currency: "TRY",
      payDay: 15,
      recurrence: "weekly" as const,
      anchorDate: "2026-07-18",
      personId: "person-1",
      categoryId: "income-cat",
      isActive: true,
      note: null,
    };

    await expect(repository.upsertRecurringIncome("user-1", { ...input, payDay: 32 }))
      .rejects.toThrow("Invalid recurring income pay day");
    await expect(repository.upsertRecurringIncome("user-1", { ...input, defaultAmountMinor: -1 }))
      .rejects.toThrow("Recurring income amount must be positive");
    await expect(repository.upsertRecurringIncome("user-1", { ...input, anchorDate: "2026-02-31" as never }))
      .rejects.toThrow("Invalid recurring income anchor date");
    await expect(repository.upsertRecurringIncome("user-1", { ...input, recurrence: "daily" as never }))
      .rejects.toThrow("Invalid recurring income recurrence");
    await expect(repository.upsertRecurringIncome("user-1", { ...input, kind: "crypto" as never }))
      .rejects.toThrow("Invalid recurring income kind");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("does not revive a subscription deleted while its edit form was open", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => sql.includes("FROM categories")
        ? { id: "cat-1" }
        : sql.includes("FROM persons")
          ? { is_self: 1 }
          : sql.includes("FROM subscriptions") && sql.includes("SELECT amount_minor")
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
    })).rejects.toThrow("Cannot edit missing subscriptions row");
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

  it("plans a valid spreadsheet import into one atomic write", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => sql.includes("FROM persons") ? { id: "person-self" } : null,
      getAllAsync: async () => [],
    });
    dependencies.readSetting.mockResolvedValue(null);

    const result = await repository.importSheets("user-1", {
      sheets: [{
        sheetName: "2026",
        year: 2026,
        months: ["2026-07"],
        columns: [{ label: "Market", kindGuess: "expense", isInvestment: false, balanceLike: false, dueDay: null }],
        cells: [[{ valueMinor: 10_000, formulaParts: null, comment: null, commentParts: null }]],
        skippedColumns: [],
        openingBalance: null,
      }],
      excludedLabels: [],
      selfId: "person-self",
      mode: "add",
    });

    expect(result).toEqual({ imported: 1 });
    expect(dependencies.writeRows).toHaveBeenCalledTimes(1);
    const [, writes] = required(dependencies.writeRows.mock.calls[0]) as [
      string,
      { table: string; row: Record<string, unknown> }[],
    ];
    expect(writes.map((write) => write.table)).toEqual([
      "categories",
      "transactions",
      "settings",
      "settings",
    ]);
    expect(writes.find((write) => write.table === "transactions")?.row).toMatchObject({
      amountMinor: 10_000,
      amountTryMinor: 10_000,
      personId: "person-self",
      isAggregate: true,
    });
  });

  it("refuses an offline import that would overdraw the investment wallet", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => sql.includes("FROM persons") ? { id: "person-self" } : null,
      getAllAsync: async (sql: string) => {
        if (sql.includes("FROM investment_profiles")) {
          return [{
            id: "profile", user_id: "user-1", started_on: "2026-01-01",
            opening_cash_minor: 10_000, deleted_at: null,
          }];
        }
        if (sql.includes("FROM categories")) {
          return [{
            id: "investment-category", user_id: "user-1", name: "Yatırım",
            kind: "expense", sort_order: 0, is_transfer: 1, deleted_at: null,
          }];
        }
        if (sql.includes("FROM persons")) {
          return [{ id: "person-self", user_id: "user-1", is_self: 1, deleted_at: null }];
        }
        return [];
      },
    });
    dependencies.readSetting.mockResolvedValue(null);
    dependencies.writeRowsValidated.mockImplementationOnce(async (
      userId: string,
      writes: { table: string; row: Record<string, unknown> }[],
      validate: (sqlite: unknown) => Promise<void>,
    ) => {
      expect(userId).toBe("user-1");
      expect(writes.find((write) => write.table === "transactions")?.row).toMatchObject({
        type: "transfer",
        amountTryMinor: -20_000,
        personId: "person-self",
      });
      await validate(await dependencies.getSqliteAsync());
      dependencies.writeRows(userId, writes);
    });

    await expect(repository.importSheets("user-1", {
      sheets: [{
        sheetName: "2026",
        year: 2026,
        months: ["2026-07"],
        columns: [{ label: "Yatırım", kindGuess: "expense", isInvestment: true, balanceLike: false, dueDay: null }],
        cells: [[{ valueMinor: -20_000, formulaParts: null, comment: null, commentParts: null }]],
        skippedColumns: [],
        openingBalance: null,
      }],
      excludedLabels: [],
      selfId: "person-self",
      mode: "add",
    })).rejects.toThrow("insufficient investment cash");

    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });
});

/**
 * The installment plan write path, which until now only had its refusals
 * tested.
 *
 * Measured 2026-08-21: `src/data/repo/installments.ts` sat at 12.5% functions
 * and 30.4% statements. The rejection cases above reach the guards at the top
 * of `buildPlanRows` and stop there, so the part that actually turns one plan
 * into N dated money rows — the split, the deterministic ids that make an edit
 * reproduce the same paid/unpaid rows, the realized/pending boundary — ran in
 * no test at all. That is the half where a mistake moves money.
 */
describe("installment plan materialization", () => {
  const plan: NewPlan = {
    title: "Dizüstü",
    kind: "card_installment",
    totalAmountMinor: 10_000,
    monthlyAmountMinor: null,
    installmentCount: 3,
    currency: "TRY",
    fxRate: null,
    startMonth: "2026-06",
    dueDay: 15,
    paymentSourceId: null,
    personId: "person-1",
    personIsSelf: true,
    categoryId: "category-1",
    note: null,
    tryFactor: 1,
  };

  const build = async (over: Partial<NewPlan> = {}, today = "2026-07-20") =>
    buildPlanRows("plan-1", { ...plan, ...over }, today as never);

  it("writes the plan plus one dated row per installment, and nothing else", async () => {
    const { rows, keepNos } = await build();

    expect(rows[0]).toMatchObject({ table: "installment_plans", row: { id: "plan-1", installmentCount: 3 } });
    const txRows = rows.slice(1);
    expect(txRows).toHaveLength(3);
    expect(txRows.map((r) => r.row.effectiveDate)).toEqual(["2026-06-15", "2026-07-15", "2026-08-15"]);
    expect(txRows.map((r) => r.row.installmentNo)).toEqual([1, 2, 3]);
    expect(keepNos).toEqual(new Set([1, 2, 3]));
  });

  it("splits the total exactly, with the rounding remainder on the last month", async () => {
    // 10_000 / 3 does not divide. The shares must still sum to the total, or a
    // plan quietly costs more or less than the thing that was bought.
    const { rows } = await build();
    const amounts = rows.slice(1).map((r) => r.row.amountMinor as number);

    expect(amounts).toEqual([3_333, 3_333, 3_334]);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it("realizes only the installments whose date has already passed", async () => {
    // The realized/pending split is derived from the date, never stored, which
    // is what lets an edit regenerate the same plan without losing history.
    const { rows } = await build({}, "2026-07-20");
    expect(rows.slice(1).map((r) => r.row.status)).toEqual(["realized", "realized", "pending"]);

    const { rows: earlier } = await build({}, "2026-06-01");
    expect(earlier.slice(1).map((r) => r.row.status)).toEqual(["pending", "pending", "pending"]);
  });

  it("gives every installment an id derived from its plan and position", async () => {
    // Deterministic, so re-saving an edited plan updates the same rows instead
    // of stacking a second copy of every month.
    const { rows } = await build();
    expect(rows.slice(1).map((r) => r.row.id)).toEqual([
      "id:installmentTx|plan-1|1",
      "id:installmentTx|plan-1|2",
      "id:installmentTx|plan-1|3",
    ]);
  });

  it("converts each share with the plan's own factor rather than the amount", async () => {
    const { rows } = await build({ currency: "USD", fxRate: "40", tryFactor: 40, totalAmountMinor: 300 });
    const txRows = rows.slice(1);

    expect(txRows.map((r) => r.row.amountMinor)).toEqual([100, 100, 100]);
    expect(txRows.map((r) => r.row.amountTryMinor)).toEqual([4_000, 4_000, 4_000]);
    expect(txRows.every((r) => r.row.currency === "USD" && r.row.fxRate === "40")).toBe(true);
  });

  it("repeats a fixed monthly amount for a loan instead of splitting a total", async () => {
    const { rows } = await build({ kind: "loan", totalAmountMinor: null, monthlyAmountMinor: 2_500 });
    expect(rows.slice(1).map((r) => r.row.amountMinor)).toEqual([2_500, 2_500, 2_500]);
  });

  it("attaches every installment to the card statement that will bill it", async () => {
    // A card plan is not N loose charges: each month's row belongs to the
    // statement whose due date it lands on, which is what makes one payment
    // settle a whole month instead of each row asking to be paid separately.
    dependencies.getSqliteAsync.mockResolvedValue({ getAllAsync: async () => [], getFirstAsync: async () => null });
    const { rows } = await build({ paymentSourceId: "card-1" });

    const linked = await linkDueRowsToCardStatements("user-1", "card-1", { statementDay: 25, dueDay: 15 }, rows);

    const statements = linked.filter((w) => w.table === "credit_card_statements");
    const txRows = linked.filter((w) => w.table === "transactions");
    const planRows = linked.filter((w) => w.table === "installment_plans");

    // Three months, three statements, and the plan row passes through untouched.
    expect(statements).toHaveLength(3);
    expect(txRows).toHaveLength(3);
    expect(planRows).toHaveLength(1);
    expect(planRows[0]?.row.cardStatementId).toBeUndefined();

    const statementIds = new Set(statements.map((w) => String(w.row.id)));
    for (const tx of txRows) {
      expect(statementIds.has(String(tx.row.cardStatementId)), String(tx.row.effectiveDate)).toBe(true);
    }
    // Distinct months bill on distinct statements.
    expect(new Set(txRows.map((w) => String(w.row.cardStatementId))).size).toBe(3);
  });

  it("reuses one statement when two installments fall in the same billing period", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({ getAllAsync: async () => [], getFirstAsync: async () => null });
    const { rows } = await build({ installmentCount: 2, totalAmountMinor: 200 });
    const sameMonth = rows.map((w) =>
      w.table === "transactions" ? { ...w, row: { ...w.row, effectiveDate: "2026-06-15" } } : w,
    );

    const linked = await linkDueRowsToCardStatements("user-1", "card-1", { statementDay: 25, dueDay: 15 }, sameMonth);

    expect(linked.filter((w) => w.table === "credit_card_statements")).toHaveLength(1);
  });

  it("refuses a plan whose parameters cannot describe a schedule", async () => {
    for (const [why, patch] of [
      ["an unknown kind", { kind: "mortgage" as never }],
      ["an unsupported currency", { currency: "XYZ" }],
      ["a start month that is not a month", { startMonth: "2026-13" as never }],
      ["a zero installment count", { installmentCount: 0 }],
      ["a non-positive FX factor", { tryFactor: 0 }],
      ["a negative total", { totalAmountMinor: -1 }],
      // `generateSchedule` clamps a corrupt day so an already-STORED plan can
      // still render; a new one is refused here instead of being silently
      // moved to another day of the month.
      ["a due day outside the month", { dueDay: 45 }],
    ] as [string, Partial<NewPlan>][]) {
      await expect(build(patch), why).rejects.toThrow();
    }
  });
});

/**
 * Skipping an expected payment, and taking that back.
 *
 * Measured 2026-08-21, `src/data/repo/expected.ts` sat at 66.7% functions with
 * lines 223-240 — the whole of `skipExpected` and `unskipExpected` — never
 * executed. Both are guard-first by design: an undo arrives from a snackbar
 * the owner may tap late, twice, or after the row has already moved on, and
 * the guard is the only thing stopping a stale tap from resurrecting a paid
 * item as unpaid.
 */
describe("skipping an expected payment", () => {
  const expectedRow = (over: Record<string, unknown> = {}) => ({
    id: "expected-1",
    user_id: "user-1",
    kind: "subscription",
    ref_id: "sub-1",
    direction: "out",
    due_date: "2026-07-10",
    amount_minor: 100_00,
    currency: "TRY",
    status: "pending",
    ...over,
  });

  const withRow = (row: Record<string, unknown> | null) => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getAllAsync: async () => [],
      getFirstAsync: async () => row,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves a pending or late item to skipped", async () => {
    for (const status of ["pending", "late"]) {
      dependencies.writeRows.mockClear();
      withRow(expectedRow({ status }));

      await repository.skipExpected("user-1", "expected-1");

      expect(dependencies.writeRows, status).toHaveBeenCalledWith("user-1", [{
        table: "expected_payments",
        row: expect.objectContaining({ id: "expected-1", status: "skipped" }),
      }]);
    }
  });

  it("leaves an item that has already moved on exactly where it is", async () => {
    // A paid item skipped by a stale tap would take a real transaction out of
    // the catch-up list while leaving the money written.
    for (const status of ["paid", "skipped"]) {
      dependencies.writeRows.mockClear();
      withRow(expectedRow({ status }));

      await repository.skipExpected("user-1", "expected-1");

      expect(dependencies.writeRows, status).not.toHaveBeenCalled();
    }
  });

  it("does nothing for an item this account cannot see", async () => {
    withRow(null);
    await repository.skipExpected("user-1", "expected-1");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("returns a skipped item to pending, and only a skipped one", async () => {
    withRow(expectedRow({ status: "skipped" }));
    await repository.unskipExpected("user-1", "expected-1");
    expect(dependencies.writeRows).toHaveBeenCalledWith("user-1", [{
      table: "expected_payments",
      row: expect.objectContaining({ id: "expected-1", status: "pending" }),
    }]);

    // Double-undo, or an undo that arrives after the item was confirmed.
    for (const status of ["pending", "paid"]) {
      dependencies.writeRows.mockClear();
      withRow(expectedRow({ status }));

      await repository.unskipExpected("user-1", "expected-1");

      expect(dependencies.writeRows, status).not.toHaveBeenCalled();
    }
  });

  it("refuses to confirm a variable subscription before its amount is known", async () => {
    // A variable bill carries 0 until the invoice arrives. Confirming it then
    // would write a zero-lira charge and mark the month settled.
    withRow(expectedRow({ amount_is_estimated: 1 }));
    dependencies.getSqliteAsync.mockResolvedValue({
      getAllAsync: async () => [],
      getFirstAsync: async (sql: string) =>
        sql.includes("FROM subscriptions")
          ? { id: "sub-1", amount_mode: "variable", person_id: "person-1", category_id: null }
          : expectedRow({ amount_is_estimated: 1 }),
    });

    await expect(repository.confirmExpected("user-1", "expected-1", { personId: "person-1" }))
      .rejects.toThrow("Variable subscription amount must be entered before confirmation");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });
});

/**
 * Deleting a subscription or income rule, and undoing that.
 *
 * Measured 2026-08-21, `src/data/repo/rules.ts` sat at 41.2% functions with
 * lines 385-439 never executed — the delete-with-undo path in full. Deleting a
 * rule must also tombstone the payments it has already generated, or the
 * reminders outlive the rule; undo has to bring back exactly that set and
 * nothing else, or a restored rule arrives with months it never scheduled.
 */
describe("rule deletion and undo", () => {
  const subscription = { id: "sub-1", user_id: "user-1", name: "Servis", deleted_at: null };
  const pendingExpected = [
    { id: "expected-1", user_id: "user-1", kind: "subscription", ref_id: "sub-1", status: "pending", deleted_at: null },
    { id: "expected-2", user_id: "user-1", kind: "subscription", ref_id: "sub-1", status: "late", deleted_at: null },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.restoreRows.mockImplementation(async (userId: string, writes: unknown[]) => {
      dependencies.writeRows(userId, writes);
    });
  });

  it("tombstones the rule and every payment it still had outstanding", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async () => subscription,
      getAllAsync: async () => pendingExpected,
    });

    const snapshot = await repository.deleteSubscriptionWithExpected("user-1", "sub-1");

    const [, writes] = dependencies.writeRows.mock.calls[0] as [string, { table: string; row: Record<string, unknown> }[]];
    expect(writes).toHaveLength(3);
    expect(writes[0]?.table).toBe("subscriptions");
    // One timestamp for the whole delete, so the rule and its payments cannot
    // be restored to different moments.
    const stamps = new Set(writes.map((w) => String(w.row.deletedAt)));
    expect(stamps.size).toBe(1);
    expect(writes.slice(1).map((w) => w.row.id)).toEqual(["expected-1", "expected-2"]);

    // The snapshot is what undo replays, so it must carry the originals.
    expect(snapshot).toEqual({ table: "subscriptions", root: subscription, expected: pendingExpected });
  });

  it("reports nothing to delete for a rule this account cannot see", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async () => null,
      getAllAsync: async () => [],
    });

    expect(await repository.deleteSubscriptionWithExpected("user-1", "missing")).toBeNull();
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("routes an income rule to its own table and kind", async () => {
    const income = { id: "income-1", user_id: "user-1", name: "Maaş", deleted_at: null };
    const seen: unknown[][] = [];
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async () => income,
      getAllAsync: async (_sql: string, args: unknown[]) => { seen.push(args); return []; },
    });

    const snapshot = await repository.deleteRecurringIncomeWithExpected("user-1", "income-1");

    expect(snapshot?.table).toBe("recurring_incomes");
    // The expected rows are looked up by the rule's OWN kind; the subscription
    // kind here would tombstone another rule's payments.
    expect(seen[0]).toEqual(["user-1", "recurring_income", "income-1"]);
  });

  it("brings back exactly what the snapshot recorded", async () => {
    await repository.restoreDeletedRule("user-1", {
      table: "subscriptions",
      root: subscription,
      expected: pendingExpected,
    });

    const [, writes] = dependencies.writeRows.mock.calls[0] as [string, { table: string; row: Record<string, unknown> }[]];
    expect(writes).toHaveLength(3);
    expect(writes.every((w) => w.row.deletedAt === null)).toBe(true);
    expect(writes.map((w) => w.row.id)).toEqual(["sub-1", "expected-1", "expected-2"]);
  });
});

/**
 * The repository's error contract.
 *
 * These are not decoration: screens switch on them. `attachment-panel.tsx:96`
 * reads `AttachmentRejectedError.reason` to say WHICH rule a file broke rather
 * than "olmadı", and the import flow reads `ImportBatchUnreadableError.years`
 * to name the years it refused. `name` is what survives a structured-clone
 * across the sync worker boundary, where `instanceof` does not.
 */
describe("repository error contract", () => {
  it("gives every error a stable name and a message that says what happened", () => {
    const cases: [Error, string, string][] = [
      [new repository.ReferencedRecordError(), "ReferencedRecordError", "Record still has live references"],
      [new repository.CreditCardCycleRequiredError(), "CreditCardCycleRequiredError", "Credit-card statement and due dates are required"],
      [new repository.InstallmentHistoryConflictError(), "InstallmentHistoryConflictError", "Realized installments cannot be removed or rewritten"],
      [new repository.SubscriptionCategoryRequiredError(), "SubscriptionCategoryRequiredError", "Subscription category is required"],
    ];
    for (const [error, name, message] of cases) {
      expect(error).toBeInstanceOf(Error);
      expect(error.name, name).toBe(name);
      expect(error.message, name).toBe(message);
    }
  });

  it("carries the machine-readable detail each caller actually reads", () => {
    const fx = new repository.FxRateUnavailableError("USD");
    expect(fx.name).toBe("FxRateUnavailableError");
    expect(fx.currency).toBe("USD");
    expect(fx.message).toContain("USD");

    const batch = new repository.ImportBatchUnreadableError([2024, 2025]);
    expect(batch.name).toBe("ImportBatchUnreadableError");
    expect(batch.years).toEqual([2024, 2025]);
    // The years are joined into the message, so a reader sees which ones.
    expect(batch.message).toContain("2024, 2025");

    const attachment = new repository.AttachmentRejectedError("too_large");
    expect(attachment.name).toBe("AttachmentRejectedError");
    expect(attachment.reason).toBe("too_large");
    expect(attachment.message).toContain("too_large");
  });
});

/**
 * The installment write path's SUCCESS side.
 *
 * Everything else in this file drives these functions only through their
 * refusals, so the branches that actually move money -- materialising a
 * schedule, shrinking one, tombstoning a plan -- were never executed. A plan is
 * the app's largest single write: one row plus one transaction per month.
 */
describe("installment plan lifecycle", () => {
  const plan = {
    title: "Buzdolabı",
    kind: "loan" as const,
    totalAmountMinor: null,
    monthlyAmountMinor: 1_000,
    installmentCount: 3,
    currency: "TRY",
    fxRate: null,
    startMonth: "2026-07",
    dueDay: 5,
    paymentSourceId: null,
    personId: "person-1",
    personIsSelf: true,
    categoryId: "category-1",
    note: null,
    tryFactor: 1,
  };

  function sqliteWith(planTransactions: Record<string, unknown>[] = [], planRow: Record<string, unknown> | null = null) {
    return {
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM persons")) return { id: "person-1" };
        if (sql.includes("FROM installment_plans")) return planRow;
        if (sql.includes("COUNT(*)")) return { n: planTransactions.length };
        return { kind: "expense", is_transfer: 0 };
      },
      getAllAsync: async () => planTransactions,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("materialises one transaction per month alongside the plan row", async () => {
    dependencies.getSqliteAsync.mockResolvedValue(sqliteWith());

    const planId = await repository.createInstallmentPlan("user-1", plan);
    expect(planId).toBe("new-id");

    const [, writes] = dependencies.writeRows.mock.calls[0] as [string, { table: string; row: Record<string, unknown> }[]];
    const transactions = writes.filter((write) => write.table === "transactions");
    expect(writes.filter((write) => write.table === "installment_plans")).toHaveLength(1);
    expect(transactions).toHaveLength(3);
    // Every instalment carries its number and the plan it belongs to, which is
    // what lets an edit rewrite the schedule instead of stacking a second one.
    expect(transactions.map((write) => write.row.installmentNo)).toEqual([1, 2, 3]);
    expect(transactions.every((write) => write.row.installmentPlanId === planId)).toBe(true);
    // The months advance from startMonth rather than all landing on it.
    expect(new Set(transactions.map((write) => String(write.row.effectiveDate).slice(0, 7))).size).toBe(3);
  });

  it("tombstones the pending months an edit drops off the end of the schedule", async () => {
    const existing = [1, 2, 3].map((no) => ({
      id: `id:installmentTx|plan-1|${no}`, user_id: "user-1", installment_plan_id: "plan-1", installment_no: no,
      status: "pending", type: "expense", amount_minor: 1_000, currency: "TRY", amount_try_minor: 1_000,
      entry_date: "2026-07-05", effective_date: "2026-07-05", deleted_at: null, person_id: "person-1", is_aggregate: 0,
    }));
    dependencies.getSqliteAsync.mockResolvedValue(
      sqliteWith(existing, { id: "plan-1", user_id: "user-1", deleted_at: null }),
    );

    await repository.updateInstallmentPlan("user-1", "plan-1", { ...plan, installmentCount: 2 });

    const [, writes] = dependencies.writeRowsValidated.mock.calls[0] as [string, { table: string; row: Record<string, unknown> }[]];
    const tombstoned = writes.filter((write) => write.table === "transactions" && write.row.deletedAt != null);
    expect(tombstoned).toHaveLength(1);
    // The deterministic id names the month that was dropped: the third.
    expect(tombstoned[0]!.row.id).toBe("id:installmentTx|plan-1|3");
    // The two months that survive are rewritten, not duplicated.
    expect(writes.filter((write) => write.table === "transactions" && write.row.deletedAt == null)).toHaveLength(2);
  });

  it("refuses to shrink a plan past an instalment that has already been paid", async () => {
    const realized = [{
      id: "id:installmentTx|plan-1|3", user_id: "user-1", installment_plan_id: "plan-1", installment_no: 3,
      status: "realized", type: "expense", amount_minor: 1_000, currency: "TRY", amount_try_minor: 1_000,
      entry_date: "2026-09-05", effective_date: "2026-09-05", deleted_at: null, person_id: "person-1", is_aggregate: 0,
    }];
    dependencies.getSqliteAsync.mockResolvedValue(
      sqliteWith(realized, { id: "plan-1", user_id: "user-1", deleted_at: null }),
    );

    await expect(repository.updateInstallmentPlan("user-1", "plan-1", { ...plan, installmentCount: 2 }))
      .rejects.toBeInstanceOf(repository.InstallmentHistoryConflictError);
    expect(dependencies.writeRowsValidated).not.toHaveBeenCalled();
  });

  it("tombstones a plan together with every instalment it generated", async () => {
    const transactions = [1, 2].map((no) => ({
      id: `id:installmentTx|plan-1|${no}`, user_id: "user-1", installment_plan_id: "plan-1", installment_no: no,
      status: "pending", type: "expense", amount_minor: 1_000, currency: "TRY", amount_try_minor: 1_000,
      entry_date: "2026-07-05", effective_date: "2026-07-05", deleted_at: null, person_id: "person-1", is_aggregate: 0,
    }));
    dependencies.getSqliteAsync.mockResolvedValue(
      sqliteWith(transactions, { id: "plan-1", user_id: "user-1", title: "Buzdolabı", deleted_at: null }),
    );

    await repository.deletePlan("user-1", "plan-1");

    const [, writes] = dependencies.writeRows.mock.calls[0] as [string, { table: string; row: Record<string, unknown> }[]];
    expect(writes).toHaveLength(3);
    expect(writes.every((write) => write.row.deletedAt != null)).toBe(true);
    expect(writes.map((write) => write.table)).toEqual(["installment_plans", "transactions", "transactions"]);
  });

  it("writes nothing when the plan to delete is already gone", async () => {
    dependencies.getSqliteAsync.mockResolvedValue(sqliteWith([], null));

    await repository.deletePlan("user-1", "plan-1");

    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("routes a card plan through its statement cycle instead of the plan's own due day", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM persons")) return { id: "person-1" };
        if (sql.includes("FROM payment_sources")) return { id: "card-1", type: "credit_card", statement_day: 20, due_day: 10 };
        if (sql.includes("FROM installment_plans")) return null;
        return { kind: "expense", is_transfer: 0 };
      },
      getAllAsync: async () => [],
    });

    await repository.createInstallmentPlan("user-1", {
      ...plan, kind: "card_installment", paymentSourceId: "card-1", dueDay: 5,
    });

    const [, writes] = dependencies.writeRows.mock.calls[0] as [string, { table: string; row: Record<string, unknown> }[]];
    const transactions = writes.filter((write) => write.table === "transactions");
    // A card instalment is not due on the plan's own dueDay -- it is due when
    // the statement it lands on is due, so every row is attached to one.
    expect(writes.some((write) => write.table === "credit_card_statements")).toBe(true);
    expect(transactions).toHaveLength(3);
    expect(transactions.every((write) => typeof write.row.cardStatementId === "string")).toBe(true);
  });

  it("refuses a card plan whose source is not a credit card with a cycle", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM persons")) return { id: "person-1" };
        if (sql.includes("FROM payment_sources")) return { id: "acct-1", type: "bank_account", statement_day: null, due_day: null };
        return { kind: "expense", is_transfer: 0 };
      },
      getAllAsync: async () => [],
    });

    await expect(repository.createInstallmentPlan("user-1", {
      ...plan, kind: "card_installment", paymentSourceId: "acct-1",
    })).rejects.toBeInstanceOf(repository.CreditCardCycleRequiredError);
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("keeps an already-paid instalment exactly as it was recorded", async () => {
    const realized = {
      id: "id:installmentTx|plan-1|1", user_id: "user-1", installment_plan_id: "plan-1", installment_no: 1,
      status: "realized", type: "expense", amount_minor: 4_444, currency: "TRY", amount_try_minor: 4_444,
      entry_date: "2026-07-05", effective_date: "2026-07-05", deleted_at: null, person_id: "person-1", is_aggregate: 0,
    };
    dependencies.getSqliteAsync.mockResolvedValue(
      sqliteWith([realized], { id: "plan-1", user_id: "user-1", deleted_at: null }),
    );

    await repository.updateInstallmentPlan("user-1", "plan-1", { ...plan, monthlyAmountMinor: 9_999 });

    const [, writes] = dependencies.writeRowsValidated.mock.calls[0] as [string, { table: string; row: Record<string, unknown> }[]];
    const paid = writes.find((write) => write.table === "transactions" && write.row.id === "id:installmentTx|plan-1|1");
    // The new monthly amount rewrites the PENDING months only. History is what
    // actually happened; an edit must not restate it at the new price.
    //
    // `amount_minor`, not `amountMinor`: this row is the stored one handed back
    // through `fromDbShape`, which this suite mocks as identity, so it keeps its
    // database shape. The regenerated months below are built fresh and carry the
    // camelCase write shape -- the difference is the point.
    expect(paid?.row.amount_minor).toBe(4_444);
    const pending = writes.filter((write) => write.table === "transactions" && write.row.id !== "id:installmentTx|plan-1|1");
    expect(pending).toHaveLength(2);
    expect(pending.every((write) => write.row.amountMinor === 9_999)).toBe(true);
  });

  it("counts the live instalments a delete would take with it", async () => {
    dependencies.getSqliteAsync.mockResolvedValue(sqliteWith([{}, {}, {}]));
    expect(await repository.countInstallmentsForPlan("user-1", "plan-1")).toBe(3);

    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async () => null,
      getAllAsync: async () => [],
    });
    // No row at all still has to read as zero, not as undefined.
    expect(await repository.countInstallmentsForPlan("user-1", "plan-1")).toBe(0);
  });
});

/**
 * The subscription category, created on demand.
 *
 * Subscriptions need a category and the owner usually has not made one. This
 * reuses an existing category by NAME before creating anything, because a
 * second "Abonelikler" would split the same spending across two columns.
 */
describe("subscription category", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses a category that already carries the name", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async () => null,
      getAllAsync: async () => [
        { id: "category-9", name: "Abonelikler", kind: "expense", deleted_at: null },
      ],
    });

    expect(await repository.ensureSubscriptionCategory("user-1", "Abonelikler")).toBe("category-9");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("creates one at the end of the column order when there is none", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async () => ({ max_order: 4 }),
      getAllAsync: async () => [],
    });

    const id = await repository.ensureSubscriptionCategory("user-1", "Abonelikler");

    expect(id).toBe("id:seedCategory|user-1|Abonelikler");
    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    expect(writes[0]?.row).toMatchObject({
      name: "Abonelikler", kind: "expense", isColumn: true, sortOrder: 5,
    });
  });

  it("starts the order at zero for an account with no categories yet", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async () => ({ max_order: null }),
      getAllAsync: async () => [],
    });

    await repository.ensureSubscriptionCategory("user-1", "Abonelikler");
    const [, writes] = required(dependencies.writeRows.mock.calls[0]);
    expect(writes[0]?.row.sortOrder).toBe(0);
  });
});

/**
 * The recurring-income write path.
 *
 * `upsertRecurringIncome` had no test at all: every branch of a rule that
 * generates money into the ledger every month was unexecuted. Its refusals
 * matter as much as its success, because a rule that saves with a bad anchor
 * silently stops producing the payments the owner is counting on.
 */
describe("recurring income rules", () => {
  const income = {
    name: "Maaş",
    kind: "salary" as const,
    defaultAmountMinor: 50_000,
    currency: "TRY",
    payDay: 15,
    personId: "person-1",
    categoryId: "category-1",
    isActive: true,
    note: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM persons")) return { is_self: 1 };
        if (sql.includes("FROM categories")) return { kind: "income", is_transfer: 0 };
        return null;
      },
      getAllAsync: async () => [],
    });
  });

  it("writes the rule and the payments it is expected to produce", async () => {
    const id = await repository.upsertRecurringIncome("user-1", income);

    expect(id).toBe("new-id");
    const [, writes] = required(dependencies.writeRowsValidated.mock.calls[0]);
    const rule = writes.find((write: { table: string }) => write.table === "recurring_incomes");
    expect(rule?.row).toMatchObject({ name: "Maaş", defaultAmountMinor: 50_000, recurrence: "monthly", payDay: 15 });
    // A monthly rule anchors on the pay day alone; the anchor date is for the
    // day-interval cadences and must stay null here.
    expect(rule?.row.anchorDate).toBeNull();
    expect(writes.some((write: { table: string }) => write.table === "expected_payments")).toBe(true);
  });

  it("requires an anchor date for a cadence that is not monthly", async () => {
    // Weekly and biweekly repeat from a specific day, not from a day-of-month,
    // so without an anchor there is nothing to count from.
    await expect(repository.upsertRecurringIncome("user-1", { ...income, recurrence: "weekly" }))
      .rejects.toThrow("Invalid recurring income anchor date");
    await expect(repository.upsertRecurringIncome("user-1", { ...income, recurrence: "biweekly", anchorDate: "15/07/2026" as never }))
      .rejects.toThrow("Invalid recurring income anchor date");
    expect(dependencies.writeRowsValidated).not.toHaveBeenCalled();
  });

  it("keeps the anchor for a weekly rule and drops it for a monthly one", async () => {
    await repository.upsertRecurringIncome("user-1", { ...income, recurrence: "weekly", anchorDate: "2026-07-03" });
    const [, weekly] = required(dependencies.writeRowsValidated.mock.calls[0]);
    expect(weekly.find((write: { table: string }) => write.table === "recurring_incomes")?.row)
      .toMatchObject({ recurrence: "weekly", anchorDate: "2026-07-03" });

    vi.clearAllMocks();
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => sql.includes("FROM persons") ? { is_self: 1 } : { kind: "income", is_transfer: 0 },
      getAllAsync: async () => [],
    });
    await repository.upsertRecurringIncome("user-1", { ...income, recurrence: "monthly", anchorDate: "2026-07-03" });
    const [, monthly] = required(dependencies.writeRowsValidated.mock.calls[0]);
    expect(monthly.find((write: { table: string }) => write.table === "recurring_incomes")?.row.anchorDate).toBeNull();
  });

  it("refuses the inputs a rule cannot be built from", async () => {
    const cases: [Partial<typeof income> & Record<string, unknown>, string][] = [
      [{ currency: "NOT-A-CURRENCY" }, "Invalid recurring income currency"],
      // Zero is caught by the shared money guard before the rule's own check.
      [{ defaultAmountMinor: 0 }, "Amount is outside the supported range"],
      [{ kind: "bonus" as never }, "Invalid recurring income kind"],
      [{ recurrence: "daily" as never }, "Invalid recurring income recurrence"],
      [{ payDay: 32 }, "Invalid recurring income pay day"],
    ];
    for (const [over, message] of cases) {
      await expect(repository.upsertRecurringIncome("user-1", { ...income, ...over }), message)
        .rejects.toThrow(message);
    }
    expect(dependencies.writeRowsValidated).not.toHaveBeenCalled();
  });

  it("refuses a rule whose earner is not a live person of this account", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async () => null,
      getAllAsync: async () => [],
    });
    await expect(repository.upsertRecurringIncome("user-1", income))
      .rejects.toThrow("Recurring income person is required");
    expect(dependencies.writeRowsValidated).not.toHaveBeenCalled();
  });

  it("checks the edited rule is still live before rewriting it", async () => {
    // Editing reuses the caller's id, so a rule deleted on another device must
    // not be resurrected by an edit that raced the delete.
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: async (sql: string) => {
        if (sql.includes("FROM persons")) return { is_self: 1 };
        if (sql.includes("FROM recurring_incomes")) return { id: "income-1" };
        return { kind: "income", is_transfer: 0 };
      },
      getAllAsync: async () => [],
    });

    const id = await repository.upsertRecurringIncome("user-1", { ...income, id: "income-1" });

    expect(id).toBe("income-1");
    expect(dependencies.assertLiveRow).toHaveBeenCalledWith(
      expect.anything(), "recurring_incomes", "user-1", "income-1",
    );
  });
});

/**
 * What the app asks before it lets a spreadsheet govern the columns.
 *
 * Onboarding reads `hasImportedData` at the moment it commits, and the import
 * wizard reads `importedYears` to warn that a year would be REPLACED. Both
 * decide whether existing data is about to be overwritten, and neither had a
 * test.
 */
describe("import batch questions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a year as imported only when its batch actually holds rows", async () => {
    const batches: Record<string, unknown> = {
      "import_batch:2024": { transactions: ["tx-1"], cellNotes: [], installmentPlans: [] },
      "import_batch:2025": { transactions: [], cellNotes: [], installmentPlans: [] },
      "import_batch:2026": { transactions: [], cellNotes: ["note-1"], installmentPlans: [] },
    };
    dependencies.readSetting.mockImplementation(async (_userId: string, key: string) => batches[key] ?? null);

    // 2025 recorded a batch that wrote nothing, so replacing it destroys
    // nothing and the warning must not be shown for it.
    expect(await repository.importedYears("user-1", [2024, 2025, 2026, 2027])).toEqual([2024, 2026]);
  });

  it("asks each year once even when the caller repeats it", async () => {
    dependencies.readSetting.mockResolvedValue({ transactions: ["tx-1"], cellNotes: [], installmentPlans: [] });

    expect(await repository.importedYears("user-1", [2024, 2024, 2024])).toEqual([2024]);
    expect(dependencies.readSetting).toHaveBeenCalledTimes(1);
  });

  it("answers whether any workbook has ever been imported", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({ getFirstAsync: async () => ({ n: 2 }), getAllAsync: async () => [] });
    expect(await repository.hasImportedData("user-1")).toBe(true);

    dependencies.getSqliteAsync.mockResolvedValue({ getFirstAsync: async () => ({ n: 0 }), getAllAsync: async () => [] });
    expect(await repository.hasImportedData("user-1")).toBe(false);

    // No settings row at all reads as "never imported", not as undefined.
    dependencies.getSqliteAsync.mockResolvedValue({ getFirstAsync: async () => null, getAllAsync: async () => [] });
    expect(await repository.hasImportedData("user-1")).toBe(false);
  });
});
