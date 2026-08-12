import { describe, expect, it } from "vitest";
import { CURRENCY_INFO, FETCHED_FX_CURRENCIES } from "../src/domain/fx-provider";
import { INVESTMENT_MARKET_TITLES, MARKET_SYMBOLS } from "../src/domain/investment-catalog";

describe("investment market identity catalog", () => {
  it("pins every persisted metal identity and its display metadata", () => {
    expect(INVESTMENT_MARKET_TITLES.slice(0, 8)).toEqual([
      { code: "ALTIN", label: "Gram Altın", assetType: "metal", mark: "Au", metalTone: "gold", live: true },
      { code: "CEYREK_YENI", label: "Çeyrek Altın", assetType: "metal", mark: "¼", metalTone: "gold", live: true },
      { code: "YARIM_ALTIN", label: "Yarım Altın", assetType: "metal", mark: "½", metalTone: "gold", live: false },
      { code: "TEK_YENI", label: "Tam Altın", assetType: "metal", mark: "1", metalTone: "gold", live: true },
      { code: "ATA_YENI", label: "Cumhuriyet Altını", assetType: "metal", mark: "C", metalTone: "gold", live: true },
      { code: "RESAT_ALTIN", label: "Reşat Altını", assetType: "metal", mark: "R", metalTone: "gold", live: false },
      { code: "GUMUS", label: "Gümüş", assetType: "metal", mark: "Ag", metalTone: "silver", live: false },
      { code: "BAKIR", label: "Bakır", assetType: "metal", mark: "Cu", metalTone: "copper", live: false },
    ]);
  });

  it("derives every currency identity without adding it to the live feed", () => {
    expect(INVESTMENT_MARKET_TITLES.slice(8)).toEqual(
      FETCHED_FX_CURRENCIES.map((currency) => ({
        code: currency === "USD" || currency === "EUR" ? `${currency}TRY` : `FX_${currency}`,
        label: `${CURRENCY_INFO[currency].name} · ${currency}`,
        assetType: "currency",
        icon: CURRENCY_INFO[currency].flag,
        live: currency === "USD" || currency === "EUR",
      })),
    );
    expect(MARKET_SYMBOLS).toEqual([
      { code: "ALTIN", label: "Gram Altın" },
      { code: "CEYREK_YENI", label: "Çeyrek Altın" },
      { code: "TEK_YENI", label: "Tam Altın" },
      { code: "ATA_YENI", label: "Cumhuriyet Altını" },
      { code: "USDTRY", label: "Amerikan Doları · USD" },
      { code: "EURTRY", label: "Euro · EUR" },
    ]);
  });
});
