import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
