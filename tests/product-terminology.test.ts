import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sourceFiles } from "./source-corpus";
import { join, resolve } from "node:path";
import { productTerms, tr } from "../src/i18n/tr";

describe("canonical product terminology", () => {
  it("keeps Helix as the application identity", () => {
    const appConfig = JSON.parse(
      readFileSync(resolve(process.cwd(), "app.json"), "utf8"),
    ) as { expo: { name: string; slug: string } };

    expect(appConfig.expo).toMatchObject({ name: "Helix", slug: "helix" });
  });

  it("uses one product and matrix-orientation vocabulary", () => {
    expect(productTerms).toEqual({
      appName: "Helix",
      financialTable: "Mali Tablo",
      rowFocused: "Satır odaklı",
      columnFocused: "Kolon odaklı",
      item: "Kalem",
      items: "Kalemler",
      column: "Kolon",
      columns: "Kolonlar",
      paymentMethod: "Ödeme Yöntemi",
      paymentMethods: "Ödeme Yöntemleri",
      recurringIncome: "Düzenli Gelir",
      recurringIncomes: "Düzenli Gelirler",
      balanceAdjustment: "Bakiye Düzeltme",
      balanceAdjustments: "Bakiye Düzeltmeleri",
    });
    expect(tr.app.name).toBe(productTerms.appName);
    expect(tr.tabBar.cashflow).toBe(productTerms.financialTable);
    expect(tr.cashflow.title).toBe(productTerms.financialTable);
    expect(tr.cashflow.monthsAsRows).toBe(productTerms.rowFocused);
    expect(tr.cashflow.monthsAsColumns).toBe(productTerms.columnFocused);
    expect(tr.settings.sources).toBe(productTerms.paymentMethods);
    expect(tr.settings.incomeRules).toBe(productTerms.recurringIncomes);
    expect(tr.settings.opening).toBe(productTerms.balanceAdjustment);
  });
});

/**
 * `tr` is a 1000-key surface that nothing else references, so a string whose
 * last caller was deleted stays there forever, reads as live copy to the next
 * person editing the file, and gets translated, reviewed and shipped. Walking
 * the real object (not the file) means a rename or a restructure cannot make
 * this test quietly stop checking anything.
 */
describe("copy surface", () => {
  // An array is addressed by index, never by a literal path, so the array
  // itself is the unit that has to be reachable.
  const dottedPaths = (node: unknown, prefix: string): string[] =>
    typeof node === "object" && node !== null && !Array.isArray(node)
      ? Object.entries(node).flatMap(([key, value]) => dottedPaths(value, `${prefix}.${key}`))
      : [prefix];

  it("has no string that nothing can render", () => {
    const blob = [
      ...sourceFiles("src", { atLeast: 150 }),
      ...sourceFiles("tests", { atLeast: 90 }),
      ...sourceFiles("e2e", { atLeast: 5 }),
    ]
      .filter((file) => file !== join("src", "i18n", "tr.ts"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    // A group read as a whole — `tr.computed.ops[op].title`, `{ ...tr.errors }`
    // — makes every key under it reachable without naming any of them.
    const readWhole = (group: string): boolean =>
      new RegExp(`${group.replace(/\./g, "\\.")}(?![.\\w])`).test(blob);

    const unreachable = dottedPaths(tr, "tr").filter((path) => {
      if (blob.includes(path)) return false;
      for (let cut = path.lastIndexOf("."); cut > "tr".length; cut = path.lastIndexOf(".", cut - 1)) {
        if (readWhole(path.slice(0, cut))) return false;
      }
      return true;
    });

    expect(unreachable).toEqual([]);
  });
});
