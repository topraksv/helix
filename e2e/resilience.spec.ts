import { expect, test } from "@playwright/test";
import {
  addMarketExpense,
  assertNoRuntimeErrors,
  collectRuntimeErrors,
  isolateExternalData,
  onboard,
  openCashFlow,
} from "./helpers";

test.beforeEach(async ({ context }) => isolateExternalData(context));

test("offline relaunch keeps the SQLite ledger and avoids duplicate writes", async ({ page, context }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await addMarketExpense(page, "Çevrimdışı kalıcılık", "210,50");
  await page.goto("/helix/");
  await expect(page.getByText(/-₺210,50/).first()).toBeVisible();

  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) throw new Error("Service Worker unavailable");
    await navigator.serviceWorker.ready;
  });
  // One controlled online navigation lets the active worker cache every
  // content-hashed asset before the true offline cold reload.
  await page.reload();
  await expect(page.getByRole("tab", { name: "Bütçe Özeti", selected: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("tab", { name: "Bütçe Özeti", selected: true })).toBeVisible();
  await expect(page.getByText(/-₺210,50/).first()).toBeVisible();
  await context.setOffline(false);

  await openCashFlow(page);
  await page.getByRole("radio", { name: "Ay odaklı" }).click();
  await expect(page.getByText(/-₺210,50/).first()).toBeVisible();
  await assertNoRuntimeErrors(errors, testInfo);
});

test("protected and modal deep links keep deterministic navigation", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  const routes: [string, string][] = [
    ["/helix/upcoming", "Yaklaşan Takvimi"],
    ["/helix/cash-flow/analytics", "Analiz"],
    ["/helix/settings/budgets", "Aylık Bütçeler"],
    ["/helix/diagnostics", "Tanılama ve Senkron Sağlığı"],
    ["/helix/account-security", "Hesap Güvenliği"],
    ["/helix/transaction", "Yeni İşlem"],
  ];
  for (const [route, heading] of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    await expect(page.getByText("Beklenmeyen bir sorun oluştu.")).toHaveCount(0);
  }
  await assertNoRuntimeErrors(errors, testInfo);
});
