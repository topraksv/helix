import { describe, expect, it } from "vitest";
import type { PaymentSourceType } from "../src/domain/types";
import { categoryIcon, paymentSourceIcon, suggestCategoryIcon } from "../src/domain/category-icons";

const expectedPaymentSourceIcons: Record<PaymentSourceType, string> = {
  credit_card: "💳",
  debit_card: "🏧",
  virtual_card: "🔒",
  e_wallet: "📱",
  cash: "💵",
  direct_debit: "🔁",
  bank_transfer: "🏦",
};

describe("category icon policy", () => {
  it("keeps earlier keyword rules ahead of later matching rules", () => {
    expect(suggestCategoryIcon("Araçla Metro", "expense")).toBe("⛽");
  });

  it("recognizes Turkish keyword casing and normalizes Turkish fallback names", () => {
    expect(suggestCategoryIcon("MAAŞ", "income")).toBe("💰");
    expect(suggestCategoryIcon("İSİMSİZ", "expense")).toBe("🗂️");
    expect(suggestCategoryIcon("isimsiz", "expense")).toBe("🗂️");
  });

  it("chooses a stable fallback for unmatched names", () => {
    expect(suggestCategoryIcon("qxz", "expense")).toBe("🎯");
    expect(suggestCategoryIcon("  qxz  ", "expense")).toBe("🎯");
  });

  it("falls back inside the income pool for an unmatched income name", () => {
    // Income and expense draw from DIFFERENT pools, so an unmatched income
    // category must not be handed a shopping bag. Same name, same icon every
    // time, or a category's icon would change on each render.
    const income = suggestCategoryIcon("qxz", "income");
    expect(["💰", "💵", "🪙", "📈", "🏦", "💳", "🤝", "✨"]).toContain(income);
    expect(suggestCategoryIcon("qxz", "income")).toBe(income);
    expect(suggestCategoryIcon("  QXZ  ", "income")).toBe(income);
  });

  it("uses a stored category icon before falling back to its suggestion", () => {
    expect(categoryIcon({ name: "Market", kind: "expense", icon: "🧺" })).toBe("🧺");
    expect(categoryIcon({ name: "Market", kind: "expense", icon: null })).toBe("🛒");
  });

  it.each(Object.entries(expectedPaymentSourceIcons))("uses the expected icon for %s", (type, icon) => {
    expect(paymentSourceIcon(type as PaymentSourceType)).toBe(icon);
  });
});
