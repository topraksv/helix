import { CURRENCY_INFO, FETCHED_FX_CURRENCIES } from "./fx-provider";
import { tr } from "../i18n/tr";
import type { InvestmentAssetType } from "./investments";

export interface InvestmentMarketTitle {
  code: string;
  label: string;
  assetType: Extract<InvestmentAssetType, "metal" | "currency">;
  icon?: string;
  mark?: string;
  metalTone?: "gold" | "silver" | "copper";
  live: boolean;
}

/** Product names share the same canonical source as the market card, while
 * investment-only instruments stay out of the live quote subscription. */
const METAL_TITLES: InvestmentMarketTitle[] = [
  { code: "ALTIN", label: tr.markets.gram, assetType: "metal", mark: "Au", metalTone: "gold", live: true },
  { code: "CEYREK_YENI", label: tr.markets.quarter, assetType: "metal", mark: "¼", metalTone: "gold", live: true },
  { code: "YARIM_ALTIN", label: tr.markets.half, assetType: "metal", mark: "½", metalTone: "gold", live: false },
  { code: "TEK_YENI", label: tr.markets.full, assetType: "metal", mark: "1", metalTone: "gold", live: true },
  { code: "ATA_YENI", label: tr.markets.republic, assetType: "metal", mark: "C", metalTone: "gold", live: true },
  { code: "RESAT_ALTIN", label: tr.markets.resat, assetType: "metal", mark: "R", metalTone: "gold", live: false },
  { code: "GUMUS", label: tr.markets.silver, assetType: "metal", mark: "Ag", metalTone: "silver", live: false },
  { code: "BAKIR", label: tr.markets.copper, assetType: "metal", mark: "Cu", metalTone: "copper", live: false },
];

const CURRENCY_TITLES: InvestmentMarketTitle[] = FETCHED_FX_CURRENCIES.map((currency) => ({
  code: currency === "USD" || currency === "EUR" ? `${currency}TRY` : `FX_${currency}`,
  label: `${CURRENCY_INFO[currency].name} · ${currency}`,
  assetType: "currency",
  icon: CURRENCY_INFO[currency].flag,
  live: currency === "USD" || currency === "EUR",
}));

export const INVESTMENT_MARKET_TITLES: readonly InvestmentMarketTitle[] = [
  ...METAL_TITLES,
  ...CURRENCY_TITLES,
];

export const MARKET_SYMBOLS = INVESTMENT_MARKET_TITLES
  .filter((item) => item.live)
  .map(({ code, label }) => ({ code, label }));
