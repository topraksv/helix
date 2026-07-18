import { describe, expect, it } from "vitest";
import { ExportTextBuilder, isValidImportRow, MAX_BACKUP_ROWS, parseExportBundleText, validateBundleRelationships, validateExportBundle } from "../src/services/backup-validation";
import { SYNCED_TABLES, type SyncedTableName } from "../src/db/schema";

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

  it("rejects unsafe money, invalid enums and impossible calendar dates", () => {
    expect(isValidImportRow("transactions", { ...transaction, amount_minor: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
    expect(isValidImportRow("transactions", { ...transaction, type: "refund" })).toBe(false);
    expect(isValidImportRow("transactions", { ...transaction, effective_date: "2026-02-31" })).toBe(false);
  });

  it("requires UUID-shaped primary, owner and relation ids", () => {
    expect(isValidImportRow("transactions", { ...transaction, id: "tx-1" })).toBe(false);
    expect(isValidImportRow("transactions", { ...transaction, person_id: "person-1" })).toBe(false);
    expect(isValidImportRow("transactions", { ...transaction, user_id: "source-user" })).toBe(false);
  });

  it("validates persisted statement months and dates", () => {
    expect(isValidImportRow("credit_card_statements", statement)).toBe(true);
    expect(isValidImportRow("credit_card_statements", { ...statement, period_month: "2026-13" })).toBe(false);
    expect(isValidImportRow("credit_card_statements", { ...statement, due_date: "2026-02-30" })).toBe(false);
  });

  it("keeps legacy monthly-income backups readable and validates new schedules/budgets", () => {
    const legacyIncome = {
      id: id(11), user_id: sourceUserId, created_at: timestamp, updated_at: timestamp, deleted_at: null,
      name: "Maaş", kind: "salary", default_amount_minor: 50_000_00, currency: "TRY", pay_day: 15,
      person_id: personId, category_id: null, is_active: 1, note: null,
    };
    expect(isValidImportRow("recurring_incomes", legacyIncome)).toBe(true);
    expect(isValidImportRow("recurring_incomes", { ...legacyIncome, recurrence: "weekly", anchor_date: null })).toBe(false);
    expect(isValidImportRow("recurring_incomes", { ...legacyIncome, recurrence: "biweekly", anchor_date: "2026-07-18" })).toBe(true);

    const budget = {
      id: id(12), user_id: sourceUserId, created_at: timestamp, updated_at: timestamp, deleted_at: null,
      category_id: categoryId, month: "2026-07", amount_minor: 10_000_00,
    };
    expect(isValidImportRow("category_budgets", budget)).toBe(true);
    expect(isValidImportRow("category_budgets", { ...budget, amount_minor: 0 })).toBe(false);
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
