import { expect, test, type BrowserContext } from "@playwright/test";
import { isolateExternalData, onboard } from "./helpers";

/**
 * The screen nothing was watching.
 *
 * Every other surface in this suite has a test; the market detail had none, and
 * it was rebuilt twice — once in 1.4.1 and once in 1.5.0 — with no browser ever
 * opening it in CI. The owner reported "grafik açılmıyor" and the only way to
 * answer was to drive it by hand.
 *
 * Two states, because the interesting one is the failure. `isolateExternalData`
 * already answers every external host with a 503, which is exactly what a
 * blocked or unreachable feed looks like from the app's side — so the default
 * here is offline and the working feed is the one that has to be arranged.
 */
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

test("says the feed is unreachable instead of drawing an empty screen", async ({ page, context }) => {
  await isolateExternalData(context);
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  await onboard(page);
  await page.goto("/helix/market-detail?code=USDTRY");

  // The state the owner is in when the host cannot be reached: named, not blank.
  await expect(page.getByText("Henüz fiyat alınamadı", { exact: false })).toBeVisible();
  // And named as the FEED's failure, not the chart's. Saying only "geçmiş
  // veriye ulaşılamıyor" here sent the owner — and me — hunting for a chart bug
  // across three rounds while the real answer was that the host was
  // unreachable. The dashboard card had said "Çevrimdışı" the whole time.
  await expect(page.getByText("Piyasa servisine ulaşılamıyor", { exact: false })).toBeVisible();
  // And offering a way out rather than a dead end.
  await expect(page.getByRole("button", { name: "Yeniden Dene" })).toBeVisible();
  expect(crashes, "an unreachable feed is not an exception").toEqual([]);
});

test("draws the price, the chart and the range block when the feed answers", async ({ page, context }) => {
  await isolateExternalData(context);
  await serveMarketData(context);
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  await onboard(page);
  await page.goto("/helix/market-detail?code=USDTRY");

  await expect(page.getByText("Satış")).toBeVisible();
  await expect(page.getByText("48,35 ₺").first()).toBeVisible();

  // The block that replaced the bar: the move leads, and the range labels its
  // own three figures. A missing one here is the "grafik açılmıyor" report.
  await expect(page.getByText("1A değişimi")).toBeVisible();
  // A live feed says nothing extra: the snapshot note is for when it is not.
  await expect(page.getByText("Son bilinen fiyat", { exact: false })).toBeHidden();
  for (const label of ["En düşük", "Kapanış", "En yüksek"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  // The chart itself drew: its axis carries the range's own figures.
  await expect(page.locator("svg").first()).toBeVisible();
  expect(crashes).toEqual([]);
});

test("marks a cached price as cached when the feed is not live", async ({ page, context }) => {
  await isolateExternalData(context);
  let served = 0;
  // Answer once, then go dark: the app keeps the quote it has and the screen
  // has to stop presenting it as current.
  await context.route(/data-api\.binance\.vision/, async (route) => {
    served += 1;
    if (served > 1) return route.fulfill({ status: 503, contentType: "text/plain", body: "down" });
    await route.fulfill({ status: 200, contentType: "application/json", body: TICKER });
  });
  await onboard(page);
  await page.goto("/helix/market-detail?code=USDTRY");
  await expect(page.getByText("48,35 ₺").first()).toBeVisible();
  await expect(page.getByText("Son bilinen fiyat", { exact: false })).toBeVisible();
});

test("keeps every range option reachable and answers each one", async ({ page, context }) => {
  await isolateExternalData(context);
  await serveMarketData(context);
  await onboard(page);
  await page.goto("/helix/market-detail?code=USDTRY");
  for (const range of ["1G", "1H", "1A", "1Y"]) {
    // The picker is a `Segmented`, which is a radiogroup — not buttons.
    await page.getByRole("radio", { name: range, exact: true }).click();
    // Each range relabels the change, so the block follows the picker instead
    // of showing the first answer for ever.
    await expect(page.getByText(`${range} değişimi`)).toBeVisible();
  }
});

/**
 * The fallback, from the outside.
 *
 * The owner's devices cannot resolve `data-api.binance.vision` — two devices,
 * two connections, while the same requests succeeded from elsewhere. A client
 * cannot route around a name that does not resolve, so the request has to leave
 * from somewhere that can: `supabase/functions/market-proxy`.
 *
 * Two things have to hold. The hop must only happen AFTER the direct request
 * fails, or every device pays for a function almost nobody needs. And a
 * workspace with no function deployed must behave exactly as it did before,
 * because a fallback that breaks the working case is worse than none.
 */
test("goes through the proxy only when the direct request fails", async ({ page, context }) => {
  await isolateExternalData(context);
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
  await onboard(page);
  await page.goto("/helix/market-detail?code=USDTRY");
  await expect(page.getByText("48,35 ₺").first()).toBeVisible();
  expect(direct, "the direct request is the one that ran").toBeGreaterThan(0);
  expect(proxied, "and the hop was never needed").toBe(0);
});

test("keeps working exactly as before when no proxy is deployed", async ({ page, context }) => {
  await isolateExternalData(context);
  // Everything external is a 503, including the function: this is a workspace
  // where the fallback exists in the client and nowhere else.
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  await onboard(page);
  await page.goto("/helix/market-detail?code=USDTRY");
  await expect(page.getByText("Piyasa servisine ulaşılamıyor", { exact: false })).toBeVisible();
  expect(crashes, "a missing function is not an exception").toEqual([]);
});
