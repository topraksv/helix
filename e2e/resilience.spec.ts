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
    ["/helix/account-security", "Hesap Güvenliği"],
    ["/helix/transaction", "Yeni İşlem"],
  ];
  for (const [route, heading] of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    await expect(page.getByText("Beklenmeyen bir sorun oluştu.")).toHaveCount(0);
  }
  await page.goto("/helix/transaction");
  await page.getByRole("button", { name: "Geri", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();
  await assertNoRuntimeErrors(errors, testInfo);
});

test("follow-up controls stay understandable on a narrow phone", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await onboard(page);

  // Create one payment source so Analytics can prove the source → period
  // dependency with a real persisted option, not a mocked component state.
  await page.goto("/helix/settings/payment-sources");
  await page.getByRole("textbox", { name: "Yöntem Ekle" }).fill("Günlük Hesap");
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

  const period = page.getByRole("button", { name: "Arama dönemi", exact: true });
  await expect(period).toBeDisabled();
  await page.getByRole("button", { name: "Ödeme yöntemi", exact: true }).click();
  await page.getByRole("radio", { name: "Günlük Hesap", exact: true }).click();
  await expect(period).toBeEnabled();
  await period.click();
  await page.getByRole("radio", { name: "Tüm zamanlar", exact: true }).click();
  await period.click();
  await expect(page.getByRole("radio", { name: "Tüm zamanlar", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");

  await page.goto("/helix/settings/incomes");
  await page.getByRole("textbox", { name: "Başlık" }).fill("Uzun Açıklamalı Aylık Düzenli Maaş Geliri");
  await page.getByRole("textbox", { name: "Varsayılan Tutar" }).fill("42.500,00");
  const monthEnd = page.getByRole("radio", { name: "Ayın sonu", exact: true });
  await monthEnd.click();
  await expect(monthEnd).toHaveAttribute("aria-checked", "true");
  // Keep the layout fixture inside the dashboard's three-day preview window;
  // month-end recurrence itself is covered by the domain leap/short-month test.
  await page.getByRole("textbox", { name: "Ödeme Günü", exact: true }).fill("20");
  await page.getByRole("button", { name: "Gelir Kuralı Ekle", exact: true }).click();
  await expect(page.getByText("Uzun Açıklamalı Aylık Düzenli Maaş Geliri", { exact: true })).toBeVisible();

  await page.goto("/helix/");
  const upcomingTitle = page.getByText("Uzun Açıklamalı Aylık Düzenli Maaş Geliri", { exact: true });
  const received = page.getByRole("button", { name: "Alındı", exact: true });
  await expect(upcomingTitle).toBeVisible();
  await expect(received).toBeVisible();
  const [titleBox, actionBox] = await Promise.all([upcomingTitle.boundingBox(), received.boundingBox()]);
  expect(titleBox && actionBox && actionBox.x > titleBox.x).toBeTruthy();

  await page.goto("/helix/settings");
  await expect(page.getByText(/Tanılama|senkron sağlığı/i)).toHaveCount(0);
  await assertNoRuntimeErrors(errors, testInfo);
});
