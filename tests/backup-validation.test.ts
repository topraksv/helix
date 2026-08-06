import { describe, expect, it } from "vitest";
import { ExportTextBuilder, isValidImportRow, MAX_BACKUP_ROWS, parseExportBundleText, validateBundleRelationships, validateExportBundle } from "../src/services/backup-validation";
import { SYNCED_TABLES, type SyncedTableName } from "../src/db/schema";
import { LOCAL_ONLY_USER_ID } from "../src/domain/user-id";
import { MAX_ABS_AMOUNT_MINOR } from "../src/domain/money";

const timestamp = "2026-07-15T12:00:00.000Z";
const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const sourceUserId = id(1);
const transactionId = id(2);
const categoryId = id(3);
const personId = id(4);
const cardId = id(5);
const transaction = {
  id: transactionId,
  user_id: sourceUserId,
  created_at: timestamp,
  updated_at: timestamp,
  deleted_at: null,
  type: "expense",
  amount_minor: 125_00,
  currency: "TRY",
  fx_rate: null,
  amount_try_minor: 125_00,
  entry_date: "2026-07-15",
  effective_date: "2026-07-15",
  status: "realized",
  category_id: categoryId,
  payment_source_id: null,
  person_id: personId,
  installment_plan_id: null,
  installment_no: null,
  subscription_id: null,
  is_aggregate: 0,
  note: null,
};
const statement = {
  id: id(6),
  user_id: sourceUserId,
  created_at: timestamp,
  updated_at: timestamp,
  deleted_at: null,
  payment_source_id: cardId,
  period_month: "2026-07",
  statement_date: "2026-07-25",
  due_date: "2026-08-05",
};
const person = {
  id: personId,
  user_id: sourceUserId,
  created_at: timestamp,
  updated_at: timestamp,
  deleted_at: null,
  name: "Kendim",
  is_self: 1,
};
const category = {
  id: categoryId,
  user_id: sourceUserId,
  created_at: timestamp,
  updated_at: timestamp,
  deleted_at: null,
  name: "Market",
  kind: "expense",
  icon: null,
  color: null,
  sort_order: 0,
  is_column: 1,
};
const cellNote = {
  id: id(7),
  user_id: sourceUserId,
  created_at: timestamp,
  updated_at: timestamp,
  deleted_at: null,
  month: "2026-07",
  category_id: categoryId,
  body: "Haftalık alışveriş",
};

describe("backup validation", () => {
  it("accepts a complete exported row", () => {
    expect(isValidImportRow("transactions", transaction)).toBe(true);
  });

  it("keeps generated transaction magnitudes on the exact product boundary", () => {
    let state = 0x6d2b79f5;
    const supported = [1, MAX_ABS_AMOUNT_MINOR];
    for (let index = 0; index < 256; index += 1) {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      supported.push((Math.abs(state) % 1_000_000_000) + 1);
    }
    for (const magnitude of supported) {
      expect(isValidImportRow("transactions", {
        ...transaction,
        amount_minor: magnitude,
        amount_try_minor: magnitude,
      })).toBe(true);
      expect(isValidImportRow("transactions", {
        ...transaction,
        amount_minor: -magnitude,
        amount_try_minor: -magnitude,
      })).toBe(true);
    }
    for (let offset = 1; offset <= 256; offset += 1) {
      expect(isValidImportRow("transactions", {
        ...transaction,
        amount_minor: MAX_ABS_AMOUNT_MINOR + offset,
        amount_try_minor: MAX_ABS_AMOUNT_MINOR + offset,
      })).toBe(false);
    }
  });

  it("keeps pre-generation backups recoverable and validates supplied generations", () => {
    expect(isValidImportRow("transactions", transaction)).toBe(true);
    expect(isValidImportRow("transactions", { ...transaction, tombstone_version: 2 })).toBe(true);
    expect(isValidImportRow("transactions", { ...transaction, tombstone_version: -1 })).toBe(false);
    expect(isValidImportRow("transactions", { ...transaction, tombstone_version: 1.5 })).toBe(false);
  });

  it("rejects unsafe money, invalid enums and impossible calendar dates", () => {
    expect(isValidImportRow("transactions", { ...transaction, amount_minor: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
    expect(isValidImportRow("transactions", { ...transaction, amount_minor: 100_000_000_000_000 })).toBe(false);
    expect(isValidImportRow("transactions", { ...transaction, amount_try_minor: -125_00 })).toBe(false);
    expect(isValidImportRow("transactions", { ...transaction, fx_rate: "1000001" })).toBe(false);
    expect(isValidImportRow("transactions", { ...transaction, installment_no: 0 })).toBe(false);
    expect(isValidImportRow("transactions", { ...transaction, type: "refund" })).toBe(false);
    expect(isValidImportRow("transactions", { ...transaction, effective_date: "2026-02-31" })).toBe(false);
    expect(isValidImportRow("transactions", { ...transaction, currency: "NOT-A-CURRENCY" })).toBe(false);
  });

  it("requires UUID-shaped primary, owner and relation ids", () => {
    expect(isValidImportRow("transactions", { ...transaction, id: "tx-1" })).toBe(false);
    expect(isValidImportRow("transactions", { ...transaction, person_id: "person-1" })).toBe(false);
    expect(isValidImportRow("transactions", { ...transaction, user_id: "source-user" })).toBe(false);
  });

  it("accepts only the stable legacy local owner outside the UUID rule", () => {
    expect(isValidImportRow("transactions", { ...transaction, user_id: LOCAL_ONLY_USER_ID })).toBe(true);
    expect(isValidImportRow("transactions", { ...transaction, user_id: "local-user" })).toBe(false);
    expect(isValidImportRow("transactions", { ...transaction, person_id: LOCAL_ONLY_USER_ID })).toBe(false);
  });

  it("validates persisted statement months and dates", () => {
    expect(isValidImportRow("credit_card_statements", statement)).toBe(true);
    expect(isValidImportRow("credit_card_statements", { ...statement, period_month: "2026-13" })).toBe(false);
    expect(isValidImportRow("credit_card_statements", { ...statement, due_date: "2026-02-30" })).toBe(false);
    expect(isValidImportRow("credit_card_statements", { ...statement, due_date: "2026-07-24" })).toBe(false);
  });

  it("keeps legacy monthly-income backups readable and validates new schedules/budgets", () => {
    const legacyIncome = {
      id: id(11), user_id: sourceUserId, created_at: timestamp, updated_at: timestamp, deleted_at: null,
      name: "Maaş", kind: "salary", default_amount_minor: 50_000_00, currency: "TRY", pay_day: 15,
      person_id: personId, category_id: null, is_active: 1, note: null,
    };
    expect(isValidImportRow("recurring_incomes", legacyIncome)).toBe(true);
    expect(isValidImportRow("recurring_incomes", { ...legacyIncome, recurrence: "monthly", anchor_date: "2026-02-31" })).toBe(false);
    expect(isValidImportRow("recurring_incomes", { ...legacyIncome, recurrence: "weekly", anchor_date: null })).toBe(false);
    expect(isValidImportRow("recurring_incomes", { ...legacyIncome, recurrence: "biweekly", anchor_date: "2026-07-18" })).toBe(true);

    const budget = {
      id: id(12), user_id: sourceUserId, created_at: timestamp, updated_at: timestamp, deleted_at: null,
      category_id: categoryId, month: "2026-07", amount_minor: 10_000_00,
    };
    expect(isValidImportRow("category_budgets", budget)).toBe(true);
    expect(isValidImportRow("category_budgets", { ...budget, amount_minor: 0 })).toBe(false);
  });

  it("validates investment rows and their exact quote relationship", () => {
    const profile = {
      id: id(20), user_id: sourceUserId, created_at: timestamp, updated_at: timestamp,
      deleted_at: null, started_on: "2026-07-01", opening_cash_minor: 10_000_00,
      setup_completed: 1,
    };
    const product = {
      id: id(21), user_id: sourceUserId, created_at: timestamp, updated_at: timestamp,
      deleted_at: null, asset_type: "metal", name: "Gram Altın", market_code: "ALTIN", note: null,
    };
    const operation = {
      id: id(22), user_id: sourceUserId, created_at: timestamp, updated_at: timestamp,
      deleted_at: null, product_id: product.id, kind: "buy", operation_date: "2026-07-02",
      quantity: "2", unit_price_minor: 50_000, total_minor: 100_000,
      cost_basis_minor: 0, realized_profit_loss_minor: 0, note: null, import_key: null,
    };
    expect(isValidImportRow("investment_profiles", profile)).toBe(true);
    expect(isValidImportRow("investment_profiles", { ...profile, started_on: "2999-01-01" })).toBe(false);
    expect(isValidImportRow("investment_products", product)).toBe(true);
    expect(isValidImportRow("investment_products", { ...product, name: "🧭".repeat(120) })).toBe(true);
    expect(isValidImportRow("investment_products", { ...product, name: "🧭".repeat(121) })).toBe(false);
    expect(isValidImportRow("investment_products", { ...product, market_code: "" })).toBe(false);
    expect(isValidImportRow("investment_operations", operation)).toBe(true);
    expect(isValidImportRow("investment_operations", { ...operation, import_key: "" })).toBe(false);
    expect(isValidImportRow("investment_operations", { ...operation, operation_date: "2999-01-01" })).toBe(false);
    expect(isValidImportRow("investment_operations", { ...operation, total_minor: 900_000 })).toBe(false);
    expect(() => validateBundleRelationships(validateExportBundle({
      version: 1,
      exportedAt: timestamp,
      tables: {
        investment_profiles: [profile],
        investment_products: [product],
        investment_operations: [operation],
      },
    }))).not.toThrow();
  });

  it("rejects one invalid row before returning any restore plan", () => {
    const bundle = {
      version: 1,
      exportedAt: timestamp,
      tables: { transactions: [transaction, { ...transaction, id: id(8), status: "unknown" }] },
    };
    expect(() => validateExportBundle(bundle)).toThrow("Geçersiz yedek dosyası");
  });

  it("parses a valid JSON bundle and rejects malformed JSON", () => {
    const bundle = { version: 1, exportedAt: timestamp, tables: { transactions: [transaction] } };
    expect(parseExportBundleText(JSON.stringify(bundle))).toEqual(bundle);
    expect(() => parseExportBundleText("{")).toThrow("Geçersiz yedek dosyası");
  });

  it("builds a restorable envelope for every synced table one table at a time", () => {
    const builder = new ExportTextBuilder(timestamp);
    for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
      const rows = table === "persons"
        ? [person]
        : table === "categories"
          ? [category]
          : table === "transactions"
            ? [transaction]
            : [];
      builder.addTable(table, rows);
    }
    const bundle = parseExportBundleText(builder.finish());

    expect(Object.keys(bundle.tables)).toHaveLength(Object.keys(SYNCED_TABLES).length);
    expect(() => validateBundleRelationships(bundle)).not.toThrow();
  });

  it("accepts real cancellation/payment timestamps instead of date-only text", () => {
    const subscription = {
      id: id(9), user_id: sourceUserId, created_at: timestamp, updated_at: timestamp, deleted_at: null,
      name: "Servis", amount_minor: 100_00, currency: "TRY", cycle: "monthly", interval_months: 1,
      billing_day: 10, next_due_date: "2026-08-10", payment_source_id: null, category_id: categoryId,
      person_id: personId, is_active: 0, canceled_at: timestamp, trial_end_date: null, auto_pay: 0,
      website_domain: null, logo_source: "initials", logo_ref: null, note: null,
    };
    const expected = {
      id: id(10), user_id: sourceUserId, created_at: timestamp, updated_at: timestamp, deleted_at: null,
      direction: "out", kind: "subscription", ref_id: subscription.id, due_date: "2026-07-10",
      amount_minor: 100_00, currency: "TRY", status: "paid", paid_at: timestamp,
      auto_confirmed: 0, transaction_id: transactionId,
    };
    expect(isValidImportRow("subscriptions", subscription)).toBe(true);
    expect(isValidImportRow("expected_payments", expected)).toBe(true);
  });

  it("rejects domain-invalid rows before backup or sync persistence", () => {
    const subscription = {
      id: id(30), user_id: sourceUserId, created_at: timestamp, updated_at: timestamp, deleted_at: null,
      name: "Servis", amount_minor: 100_00, currency: "TRY", cycle: "monthly", interval_months: 1,
      billing_day: 10, next_due_date: "2026-08-10", payment_source_id: null, category_id: categoryId,
      person_id: personId, is_active: 1, canceled_at: null, trial_end_date: null, auto_pay: 0,
      website_domain: null, logo_source: "initials", logo_ref: null, note: null,
    };
    const income = {
      id: id(31), user_id: sourceUserId, created_at: timestamp, updated_at: timestamp, deleted_at: null,
      name: "Maaş", kind: "salary", default_amount_minor: 50_000, currency: "TRY", pay_day: 15,
      recurrence: "monthly", anchor_date: null, person_id: personId, category_id: null,
      is_active: 1, note: null,
    };
    const plan = {
      id: id(32), user_id: sourceUserId, created_at: timestamp, updated_at: timestamp, deleted_at: null,
      title: "Telefon", kind: "card_installment", total_amount_minor: 120_000, monthly_amount_minor: null,
      installment_count: 3, currency: "TRY", start_month: "2026-07", due_day: 10,
      payment_source_id: cardId, person_id: personId, category_id: categoryId, note: null,
    };
    const fxRate = {
      id: id(33), user_id: sourceUserId, created_at: timestamp, updated_at: timestamp, deleted_at: null,
      currency: "USD", rate_date: "2026-07-15", rate_try: "40.25",
    };
    const cardSource = {
      id: id(34), user_id: sourceUserId, created_at: timestamp, updated_at: timestamp, deleted_at: null,
      name: "Kart", type: "credit_card", person_id: personId, due_day: null, statement_day: null,
      color: null, logo_source: "initials", logo_ref: null, is_active: 1,
    };

    expect(isValidImportRow("subscriptions", { ...subscription, amount_minor: 0 })).toBe(false);
    expect(isValidImportRow("subscriptions", { ...subscription, interval_months: 0 })).toBe(false);
    expect(isValidImportRow("subscriptions", { ...subscription, interval_months: 13 })).toBe(false);
    expect(isValidImportRow(
      "subscriptions",
      { ...subscription, name: "x".repeat(121) },
      { enforceInputLimits: true },
    )).toBe(false);
    expect(isValidImportRow("recurring_incomes", { ...income, default_amount_minor: -1 })).toBe(false);
    expect(isValidImportRow("installment_plans", { ...plan, installment_count: 0 })).toBe(false);
    expect(isValidImportRow("installment_plans", { ...plan, installment_count: 601 })).toBe(false);
    expect(isValidImportRow("installment_plans", { ...plan, start_month: "0000-01" })).toBe(false);
    expect(isValidImportRow("installment_plans", { ...plan, total_amount_minor: null, monthly_amount_minor: null })).toBe(false);
    expect(isValidImportRow("fx_rates", { ...fxRate, rate_try: "0" })).toBe(false);
    expect(isValidImportRow("transactions", { ...transaction, amount_minor: 0 })).toBe(false);
    expect(isValidImportRow("payment_sources", cardSource)).toBe(false);
    expect(isValidImportRow("installment_plans", { ...plan, payment_source_id: null })).toBe(false);
    expect(isValidImportRow(
      "transactions",
      { ...transaction, note: "x".repeat(1_001) },
      { enforceInputLimits: true },
    )).toBe(false);
  });

  it("keeps legacy user text restorable while new outbound writes use current limits", () => {
    const legacy = { ...transaction, note: "x".repeat(1_001) };
    expect(isValidImportRow("transactions", legacy)).toBe(true);
    expect(isValidImportRow("transactions", legacy, { enforceInputLimits: true })).toBe(false);
  });

  it("validates backup relationships against bundled or existing parent ids", () => {
    const bundle = validateExportBundle({
      version: 1,
      exportedAt: timestamp,
      tables: { persons: [person], categories: [category], transactions: [transaction], cell_notes: [cellNote] },
    });
    expect(() => validateBundleRelationships(bundle)).not.toThrow();

    const partial = validateExportBundle({ version: 1, exportedAt: timestamp, tables: { transactions: [transaction] } });
    expect(() => validateBundleRelationships(partial, {
      persons: new Set([personId]),
      categories: new Set([categoryId]),
    })).not.toThrow();
  });

  it("rejects dangling references, duplicate rows and mixed-account bundles", () => {
    const dangling = validateExportBundle({
      version: 1,
      exportedAt: timestamp,
      tables: { persons: [person], transactions: [transaction], cell_notes: [cellNote] },
    });
    expect(() => validateBundleRelationships(dangling)).toThrow("Geçersiz yedek dosyası");
    expect(() => validateExportBundle({
      version: 1,
      exportedAt: timestamp,
      tables: { persons: [person, person] },
    })).toThrow("Geçersiz yedek dosyası");
    expect(() => validateExportBundle({
      version: 1,
      exportedAt: timestamp,
      tables: { persons: [person], categories: [{ ...category, user_id: id(99) }] },
    })).toThrow("Geçersiz yedek dosyası");
  });

  it("rejects an oversized restore plan before iterating or writing its rows", () => {
    expect(() => validateExportBundle({
      version: 1,
      exportedAt: timestamp,
      tables: { transactions: Array(MAX_BACKUP_ROWS + 1).fill(transaction) },
    })).toThrow("Yedek dosyası güvenli içe aktarma sınırını aşıyor.");
  });
});
