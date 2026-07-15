import { describe, expect, it } from "vitest";
import { isValidImportRow, parseExportBundleText, validateExportBundle } from "../src/services/backup-validation";

const timestamp = "2026-07-15T12:00:00.000Z";
const transaction = {
  id: "tx-1",
  user_id: "source-user",
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
  category_id: "cat-1",
  payment_source_id: null,
  person_id: "person-1",
  installment_plan_id: null,
  installment_no: null,
  subscription_id: null,
  is_aggregate: 0,
  note: null,
};
const statement = {
  id: "statement-1",
  user_id: "source-user",
  created_at: timestamp,
  updated_at: timestamp,
  deleted_at: null,
  payment_source_id: "card-1",
  period_month: "2026-07",
  statement_date: "2026-07-25",
  due_date: "2026-08-05",
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

  it("validates persisted statement months and dates", () => {
    expect(isValidImportRow("credit_card_statements", statement)).toBe(true);
    expect(isValidImportRow("credit_card_statements", { ...statement, period_month: "2026-13" })).toBe(false);
    expect(isValidImportRow("credit_card_statements", { ...statement, due_date: "2026-02-30" })).toBe(false);
  });

  it("rejects one invalid row before returning any restore plan", () => {
    const bundle = {
      version: 1,
      exportedAt: timestamp,
      tables: { transactions: [transaction, { ...transaction, id: "tx-2", status: "unknown" }] },
    };
    expect(() => validateExportBundle(bundle)).toThrow("Geçersiz yedek dosyası");
  });

  it("parses a valid JSON bundle and rejects malformed JSON", () => {
    const bundle = { version: 1, exportedAt: timestamp, tables: { transactions: [transaction] } };
    expect(parseExportBundleText(JSON.stringify(bundle))).toEqual(bundle);
    expect(() => parseExportBundleText("{")).toThrow("Geçersiz yedek dosyası");
  });
});
