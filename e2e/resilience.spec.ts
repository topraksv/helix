import { expect, test, type Page } from "@playwright/test";
import { addMarketExpense, collectRuntimeErrors, currentMonthKey, isolateExternalData, onboard, openCashFlow, renderedContrast } from "./helpers";

test.beforeEach(async ({ context }) => isolateExternalData(context));

async function serviceWorkerReady(page: Page) {
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) throw new Error("Service Worker unavailable");
    await navigator.serviceWorker.ready;
  });
}

test("offline relaunch keeps the SQLite ledger and avoids duplicate writes", async ({ page, context }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await addMarketExpense(page, "Çevrimdışı kalıcılık", "210,50");
  await page.goto("/helix/");
  await expect(page.getByText(/-.*₺210,50/).first()).toBeVisible();

  await serviceWorkerReady(page);
  // One online reload lets the worker cache every hashed asset before the offline cold reload.
  await page.reload();
  await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();
  await expect(page.getByText(/-.*₺210,50/).first()).toBeVisible();
  await context.setOffline(false);

  await openCashFlow(page);
  await page.getByRole("radio", { name: "Tek ay" }).click();
  await expect(page.getByText(/-.*₺210,50/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("a navigated static asset cannot poison the offline app shell", async ({ page, context }) => {
  await page.goto("/helix/");
  await serviceWorkerReady(page);
  // Reload so the worker controls this document and caches the good shell first.
  await page.reload();
  const entry = await page.locator('script[src*="/_expo/static/js/web/entry-"]').getAttribute("src");
  expect(entry).toBeTruthy();

  // Any site can link to the public JS URL; the worker must not store it under index.html.
  await page.goto(entry!);
  await context.setOffline(true);
  await page.goto("/helix/");
  // Served statically, so a crawler that runs no JavaScript still gets the title.
  await expect(page).toHaveTitle("Helix: Bütçe, Abonelikler ve Yatırımlar");
  await expect(page.locator("#root")).toBeVisible();
  await context.setOffline(false);
});

// The OPFS access handle is exclusive, so a second tab fails; the owning tab must keep every row.
// wa-sqlite leaves the failed document in "Invalid VFS state", so only a reload recovers,
// and the waiting tab does it unasked once the owner closes.
test("a second tab fails safely and its retry really recovers", async ({ page, context }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await addMarketExpense(page, "Tek sekme sahipliği", "410,00");

  const second = await context.newPage();
  // Dark: the static export prerenders the light background and hydration kept it under light text.
  await second.emulateMedia({ colorScheme: "dark" });
  await second.goto("/helix/");
  await expect(second.getByText("Helix başka bir sekmede açık")).toBeVisible();
  expect(await renderedContrast(second.getByText("Helix başka bir sekmede açık"), "text")).toBeGreaterThanOrEqual(4.5);
  // A status, not a disabled button: disabled dimming rendered this line at 2.07:1.
  await expect(second.getByText("Diğer sekmenin kapanması bekleniyor")).toBeVisible();
  await expect(second.getByRole("button", { name: "Diğer sekmenin kapanması bekleniyor" })).toHaveCount(0);
  const legible = await renderedContrast(second.getByText("Diğer sekmenin kapanması bekleniyor"), "text");
  expect(legible, "the only line explaining the screen has to be readable").toBeGreaterThanOrEqual(4.5);

  // The owning tab is untouched by the blocked one.
  await page.bringToFront();
  await page.goto(`/helix/cash-flow/${currentMonthKey()}`);
  await expect(page.getByRole("button", { name: /Market.*410,00/ })).toBeVisible();

  // No click: the waiting tab asks who holds the database, hears nothing, and reloads itself.
  await page.close();
  await second.bringToFront();
  await expect(second.getByRole("tab", { name: "Durum", selected: true })).toBeVisible({ timeout: 20_000 });
  await second.goto(`/helix/cash-flow/${currentMonthKey()}`);
  await expect(second.getByRole("button", { name: /Market.*410,00/ })).toBeVisible();
  await second.close();

  expect(errors).toEqual([]);
});

test("protected and modal deep links keep deterministic navigation @cross-browser", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  const routes: [string, string][] = [
    ["/helix/upcoming", "Yaklaşan Takvimi"],
    ["/helix/cash-flow/analytics", "Analiz"],
    ["/helix/settings/budgets", "Aylık Harcama Limiti"],
    ["/helix/transaction", "Yeni İşlem"],
  ];
  for (const [route, heading] of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    await expect(page.getByText("Beklenmeyen bir sorun oluştu.")).toHaveCount(0);
  }
  // Local-only builds hide the cloud-security route and its actions.
  await page.goto("/helix/account-security");
  await expect(page).toHaveURL(/\/helix\/settings$/);
  await expect(page.getByRole("heading", { name: "Ayarlar", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Hesap Güvenliği/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Hesabı Dondur/ })).toHaveCount(0);
  await page.goto("/helix/transaction");
  const back = page.getByRole("button", { name: "Geri", exact: true });
  await expect(back).toBeVisible();
  expect(await back.boundingBox()).toMatchObject({ width: 44, height: 44 });
  await back.click();
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

// The month range helpers THROW on a malformed key; a stale link must recover, not white-screen.
test("hostile route parameters recover instead of white-screening", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);

  const hostile = [
    "/helix/cash-flow/garbage",
    "/helix/cash-flow/2026-13",
    "/helix/cash-flow/2026-99",
    "/helix/cell-editor?month=garbage&categoryId=x",
    "/helix/cell-editor",
  ];
  for (const route of hostile) {
    await page.goto(route);
    await expect(page.getByText("Beklenmeyen bir sorun oluştu.")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();
  }

  // A well-formed month still opens its own detail, so the guard is not a blanket redirect.
  const month = currentMonthKey();
  await page.goto(`/helix/cash-flow/${month}`);
  await expect(page.getByText("Beklenmeyen bir sorun oluştu.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("budget summary keeps its forecast, charts and cash-flow tab route", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);
  await addMarketExpense(page, "Aylık grafik", "820,00");

  await page.getByRole("tab", { name: "Durum" }).click();
  const forecastToggle = page.getByRole("button", { name: /Ay sonu tahmini/ }).first();
  await expect(forecastToggle).toBeVisible();
  await expect(forecastToggle).toHaveAttribute("aria-label", /^Ay sonu tahmini .*\d.*(yükseliyor|düşüyor)$/u);
  // A label nearer its top border than its bottom reads as a mistake.
  const forecastPadding = await forecastToggle.evaluate((element) => {
    const style = getComputedStyle(element);
    return { top: style.paddingTop, bottom: style.paddingBottom };
  });
  expect(forecastPadding.bottom).toBe(forecastPadding.top);
  // "Güncel bakiye" exists only in the expanded panel; the toggle and result row share a name.
  const forecastDetails = page.getByText("Güncel bakiye", { exact: true });
  await expect(forecastDetails).toHaveCount(0);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await forecastToggle.click();
    await expect(forecastDetails).toBeVisible();
    await forecastToggle.click();
    await expect(forecastDetails).toHaveCount(0);
  }
  await forecastToggle.click();
  await expect(forecastDetails).toBeVisible();
  await expect(page.getByRole("img", { name: /Halka grafik/ })).toBeVisible();
  await page.getByRole("radio", { name: "Sütun", exact: true }).click();
  await expect(page.getByRole("img", { name: /Sütun grafik/ })).toBeVisible();

  await page.getByRole("tab", { name: "Mali Tablo" }).click();
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("follow-up controls stay understandable on a narrow phone", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await onboard(page);

  await page.goto("/helix/settings/payment-sources");
  await page.getByRole("textbox", { name: "Yöntem adı" }).fill("Günlük Hesap");
  await page.getByRole("radio", { name: "Nakit", exact: true }).click();
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Günlük Hesap", { exact: true })).toBeVisible();

  await page.goto("/helix/cash-flow/analytics");
  const typeLabels = ["Tümü", "Gider", "Gelir", "Yatırım"];
  for (const label of typeLabels) {
    await expect(page.getByRole("radio", { name: label, exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole("radio", { name: "Transfer", exact: true })).toHaveCount(0);
  const typeBoxes = await Promise.all(
    typeLabels.map((label) => page.getByRole("radio", { name: label, exact: true }).first().boundingBox()),
  );
  expect(typeBoxes.every((box) => box != null && box.height === typeBoxes[0]?.height && box.y === typeBoxes[0]?.y)).toBe(true);

  // The period field is usable from the start and independent of the payment method.
  const searchFilters = page.getByRole("button", { name: "Arama filtreleri", exact: true });
  await expect(searchFilters).toHaveAttribute("aria-expanded", "false");
  await searchFilters.click();
  await expect(page.getByRole("button", { name: "Filtreleri gizle", exact: true })).toHaveAttribute("aria-expanded", "true");
  const period = page.getByRole("button", { name: "Arama dönemi", exact: true });
  await expect(period).toBeEnabled();
  await page.getByRole("button", { name: "Ödeme yöntemi", exact: true }).click();
  await page.getByRole("radio", { name: "Günlük Hesap", exact: true }).click();
  await expect(period).toBeEnabled();
  await period.click();
  await page.getByRole("radio", { name: "Tüm zamanlar", exact: true }).click();
  await period.click();
  await expect(page.getByRole("radio", { name: "Tüm zamanlar", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  // Over all time, the window controls above stop accepting input.
  await expect(page.getByRole("radio", { name: "Yıl", exact: true })).toBeDisabled();

  await page.goto("/helix/settings/incomes");
  await page.getByRole("textbox", { name: "Başlık" }).fill("Uzun Açıklamalı Aylık Düzenli Maaş Geliri");
  await page.getByRole("textbox", { name: "Varsayılan tutar" }).fill("42.500,00");
  const monthEnd = page.getByRole("radio", { name: "Ödeme günü · Ayın son günü", exact: true });
  await monthEnd.click();
  await expect(monthEnd).toHaveAttribute("aria-checked", "true");
  // Inside the dashboard's three-day preview window; month-end recurrence is a domain test.
  await page.getByRole("textbox", { name: "Ödeme günü", exact: true }).fill("20");
  await page.getByRole("button", { name: "Gelir Kuralı Ekle", exact: true }).click();
  await expect(page.getByText("Uzun Açıklamalı Aylık Düzenli Maaş Geliri", { exact: true })).toBeVisible();

  await page.goto("/helix/");
  await expect(page.getByRole("button", { name: /Ay sonu tahmini/ })).toBeVisible();
  // A monthly income may produce several rows in the 31-day horizon depending on today's day,
  // so assert the layout on every row, not one.
  const upcomingTitles = page.getByText("Uzun Açıklamalı Aylık Düzenli Maaş Geliri", { exact: true });
  const receivedActions = page.getByRole("button", { name: "Alındı · Uzun Açıklamalı Aylık Düzenli Maaş Geliri", exact: true });
  await expect(upcomingTitles.first()).toBeVisible();
  const rowCount = await upcomingTitles.count();
  expect(rowCount).toBeGreaterThan(0);
  expect(await receivedActions.count()).toBe(rowCount);
  for (let row = 0; row < rowCount; row++) {
    const [titleBox, actionBox] = await Promise.all([
      upcomingTitles.nth(row).boundingBox(),
      receivedActions.nth(row).boundingBox(),
    ]);
    expect(titleBox && actionBox && actionBox.x > titleBox.x, `row ${row}: action left of title`).toBeTruthy();
  }

  await page.goto("/helix/cash-flow/analytics");
  await page.getByRole("textbox", { name: "Ara", exact: true }).fill("Arşivde olmayan işlem");
  await expect(page.getByText("Eşleşen işlem yok.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Tüm Zamanlarda Ara", exact: true }).click();
  await expect(page.getByRole("button", { name: "Filtreleri gizle", exact: true })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Arama dönemi", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Tüm zamanlar", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");

  await page.goto("/helix/settings");
  await expect(page.getByText(/Tanılama|senkron sağlığı/i)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a direct link to a settings screen falls back to Ayarlar", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);

  // A direct link has no history, and a hostile query string must not change the fallback parent.
  for (const url of [
    "/helix/settings/payment-sources",
    "/helix/settings/payment-sources?from=__proto__",
    "/helix/settings/budgets?from=constructor",
    "/helix/settings/incomes?from=nonsense",
  ]) {
    await page.goto(url);
    await expect(page.getByText("Beklenmeyen bir sorun oluştu.")).toHaveCount(0);
    await page.getByRole("button", { name: "Geri", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Ayarlar" })).toBeVisible();
  }

  expect(errors).toEqual([]);
});

// `root-lifecycle` calls refreshRates directly on boot while the converter uses the throttled wrapper;
// both must share one throttle, or the tools screen fetches twice.
test("the FX provider is called once per session, not once per entry point", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const fxCalls: string[] = [];
  await onboard(page);
  await page.route("https://open.er-api.com/v6/latest/TRY", async (route) => {
    fxCalls.push(route.request().url());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        result: "success",
        time_last_update_unix: 1_784_970_000,
        rates: { USD: 0.025, EUR: 0.02 },
      }),
    });
  });

  // A `goto` is a full page load, so one load is one app session.
  fxCalls.length = 0;
  await page.goto("/helix/settings/tools");
  await expect(page.getByRole("heading", { name: "Hesap Makinesi", exact: true })).toBeVisible();
  await expect.poll(
    () => fxCalls.length,
    { message: `FX provider was not called exactly once: ${fxCalls.join(", ")}` },
  ).toBe(1);

  // Client-side navigation away and back must not add another inside the window.
  await page.getByRole("tab", { name: "Durum" }).click();
  await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();
  await page.getByRole("tab", { name: "Ayarlar" }).click();
  // On the web the settings stack keeps its child on blur (see (tabs)/_layout.tsx), so returning is itself the repeat visit.
  await expect(page.getByRole("heading", { name: "Hesap Makinesi", exact: true })).toBeVisible();
  const repeatVisitObservationStartedAt = Date.now();
  await expect.poll(
    () => Date.now() - repeatVisitObservationStartedAt >= 1_000 ? fxCalls.length : null,
    {
      timeout: 2_000,
      intervals: [50],
      message: "a repeat visit refetched inside the 60 s throttle",
    },
  ).toBe(1);

  expect(errors).toEqual([]);
});
