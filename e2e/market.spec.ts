import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { collectRuntimeErrors, isolateExternalData, onboard } from "./helpers";

// `isolateExternalData` answers every external host with 503, which is what an unreachable
// feed looks like, so offline is the default and the working feed is what gets arranged.
const KLINE = JSON.stringify(
  Array.from({ length: 30 }, (_, index) => {
    const open = 47 + index * 0.05;
    return [
      1_786_233_600_000 + index * 86_400_000,
      open.toFixed(8), (open + 0.2).toFixed(8), (open - 0.1).toFixed(8), (open + 0.1).toFixed(8),
      "1000.00000000", 1_786_319_999_999 + index * 86_400_000, "48000.00", 100, "500.00", "24000.00", "0",
    ];
  }),
);

/** The three books `MARKET_PAIRS` names; every tile is derived from these. */
const TICKER = JSON.stringify([
  { symbol: "PAXGTRY", bidPrice: "125000.00000000", bidQty: "1.00000000", askPrice: "125100.00000000", askQty: "1.00000000" },
  { symbol: "USDTTRY", bidPrice: "48.34000000", bidQty: "1.00000000", askPrice: "48.35000000", askQty: "1.00000000" },
  { symbol: "EURUSDT", bidPrice: "1.08000000", bidQty: "1.00000000", askPrice: "1.08100000", askQty: "1.00000000" },
]);

async function serveMarketData(context: BrowserContext): Promise<void> {
  await context.route(/data-api\.binance\.vision/, async (route) => {
    const url = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: url.includes("/klines") ? KLINE : TICKER,
    });
  });
}

test.beforeEach(({ context }) => isolateExternalData(context));

async function openUsdTry(page: Page): Promise<void> {
  await onboard(page);
  await page.goto("/helix/market-detail?code=USDTRY");
}

test("says the feed is unreachable instead of drawing an empty screen", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await openUsdTry(page);

  await expect(page.getByText("Henüz fiyat alınamadı", { exact: false })).toBeVisible();
  // Named as the FEED's failure, not the chart's: "geçmiş veriye ulaşılamıyor" sent a hunt for a chart bug.
  await expect(page.getByText("Piyasa servisine ulaşılamıyor", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yeniden Dene" })).toBeVisible();
  expect(errors, "an unreachable feed is not an exception").toEqual([]);
});

test("draws the price, the chart and the range block when the feed answers", async ({ page, context }) => {
  await serveMarketData(context);
  const errors = collectRuntimeErrors(page);
  await openUsdTry(page);

  await expect(page.getByText("Satış")).toBeVisible();
  await expect(page.getByText("48,35 ₺").first()).toBeVisible();

  await expect(page.getByText("1A değişimi")).toBeVisible();
  // The snapshot note is for a feed that is not live.
  await expect(page.getByText("Son bilinen fiyat", { exact: false })).toBeHidden();
  for (const label of ["En düşük", "Kapanış", "En yüksek"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.locator("svg").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("marks a cached price as cached when the feed is not live", async ({ page, context }) => {
  let served = 0;
  // Answer once, then go dark: the screen must stop presenting the kept quote as current.
  await context.route(/data-api\.binance\.vision/, async (route) => {
    served += 1;
    if (served > 1) return route.fulfill({ status: 503, contentType: "text/plain", body: "down" });
    await route.fulfill({ status: 200, contentType: "application/json", body: TICKER });
  });
  await openUsdTry(page);
  await expect(page.getByText("48,35 ₺").first()).toBeVisible();
  await expect(page.getByText("Son bilinen fiyat", { exact: false })).toBeVisible();
});

test("keeps every range option reachable and answers each one", async ({ page, context }) => {
  await serveMarketData(context);
  await openUsdTry(page);
  for (const range of ["1G", "1H", "1A", "1Y"]) {
    // `Segmented` is a radiogroup, not buttons.
    await page.getByRole("radio", { name: range, exact: true }).click();
    await expect(page.getByText(`${range} değişimi`)).toBeVisible();
  }
});

// The proxy hop must come only AFTER the direct request fails, and a workspace with no
// function deployed (the 503 case in the first test) must behave as it did before.
test("goes through the proxy only when the direct request fails", async ({ page, context }) => {
  let direct = 0;
  let proxied = 0;
  await context.route(/data-api\.binance\.vision/, async (route) => {
    direct += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: TICKER });
  });
  await context.route(/functions\/v1\/market-proxy/, async (route) => {
    proxied += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: TICKER });
  });
  await openUsdTry(page);
  await expect(page.getByText("48,35 ₺").first()).toBeVisible();
  expect(direct, "the direct request is the one that ran").toBeGreaterThan(0);
  expect(proxied, "and the hop was never needed").toBe(0);
});
