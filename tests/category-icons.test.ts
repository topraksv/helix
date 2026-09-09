import { describe, expect, it } from "vitest";
import { categoryIcon, conceptOf, suggestCategoryIcon } from "../src/domain/category-icons";

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
});

/**
 * The same vocabulary, asked the other question: are two strings about the
 * same thing? It is what lets a statement line find the owner's own column
 * without either of them sharing a word.
 */
describe("what a piece of text is about", () => {
  it("answers nothing for text the vocabulary does not recognise", () => {
    expect(conceptOf("ABC XYZ 1234")).toBeNull();
    expect(conceptOf("")).toBeNull();
  });

  it("answers the same thing for two words that mean the same thing", () => {
    const market = conceptOf("MIGROS MARKET");
    expect(market).not.toBeNull();
    expect(conceptOf("Gıda")).toBe(market);
    expect(conceptOf("Mutfak Alışverişi")).toBe(market);
  });

  it("keeps unrelated subjects apart", () => {
    const rent = conceptOf("Kira");
    const health = conceptOf("Eczane");
    expect(rent).not.toBeNull();
    expect(health).not.toBeNull();
    expect(rent).not.toBe(health);
  });

  /**
   * The first matching rule wins, exactly as the icon it also chooses does —
   * so the two answers can never disagree about the same name.
   */
  it("resolves an overlap the same way the icon does", () => {
    expect(conceptOf("Araçla Metro")).toBe(conceptOf("Yakıt"));
    expect(suggestCategoryIcon("Araçla Metro", "expense")).toBe("⛽");
  });
});
