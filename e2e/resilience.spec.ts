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
  const back = page.getByRole("button", { name: "Geri", exact: true });
  await expect(back).toBeVisible();
  expect(await back.boundingBox()).toMatchObject({ width: 44, height: 44 });
  await back.click();
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();
  await assertNoRuntimeErrors(errors, testInfo);
});

// A dynamic segment accepts anything the URL carries, and the month range
// helpers THROW on a malformed key. Both screens that build a SQLite range from
// a month param used to do it during render, so a hand-typed or stale link was
// a white screen rather than a recoverable navigation.
test("hostile route parameters recover instead of white-screening", async ({ page }, testInfo) => {
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
    // The error boundary must never appear, and the user must land somewhere
    // they can act from — the cash-flow table, not a dead screen.
    await expect(page.getByText("Beklenmeyen bir sorun oluştu.")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();
  }

  // A well-formed month still opens its own detail screen, so the guard did not
  // simply blanket-redirect every deep link.
  const month = new Date().toISOString().slice(0, 7);
  await page.goto(`/helix/cash-flow/${month}`);
  await expect(page.getByText("Beklenmeyen bir sorun oluştu.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toHaveCount(0);

  await assertNoRuntimeErrors(errors, testInfo);
});

// Analysis lives in the Cash Flow stack but Summary can open it too. A
// cross-tab push must be anchored, which mounts the Financial Table underneath
// it — so plain history sends a user who came from Summary to a screen they
// never visited. Both entry paths are asserted because fixing one by
// hard-coding a single global back target silently breaks the other.
test("Analysis goes back to whichever screen opened it", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);

  await page.getByRole("tab", { name: "Bütçe Özeti" }).click();
  await page.getByRole("button", { name: /Net değişim/ }).click();
  await expect(page.getByRole("heading", { name: "Analiz", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Geri", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Bütçe Özeti", selected: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "Mali Tablo" }).click();
  await page.getByRole("button", { name: "Analiz", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Analiz", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Geri", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();

  // A direct link has no source at all and must still land somewhere real.
  await page.goto("/helix/cash-flow/analytics");
  await expect(page.getByRole("heading", { name: "Analiz", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Geri", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();

  await assertNoRuntimeErrors(errors, testInfo);
});

test("budget summary keeps its forecast, charts and cash-flow tab route", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);
  await addMarketExpense(page, "Aylık grafik", "820,00");

  await page.getByRole("tab", { name: "Bütçe Özeti" }).click();
  await expect(page.getByRole("button", { name: /Ay sonu tahmini/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /Halka grafik/ })).toBeVisible();
  await page.getByRole("radio", { name: "Sütun", exact: true }).click();
  await expect(page.getByRole("img", { name: /Sütun grafik/ })).toBeVisible();

  await page.getByRole("button", { name: /Net değişim/ }).click();
  await expect(page.getByRole("heading", { name: "Analiz", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Bütçe Özeti" }).click();
  await page.getByRole("tab", { name: "Mali Tablo" }).click();
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
  await expect(page.getByRole("button", { name: /Ay sonu tahmini/ })).toBeVisible();
  // A monthly income legitimately produces MORE THAN ONE row inside the
  // dashboard's 31-day horizon — this month's occurrence and next month's — and
  // which of them exist depends on today's day-of-month against the pay day.
  // The original single-element locator therefore passed only while today was
  // past the 20th and hit a strict-mode violation on every earlier day. Assert
  // the layout property on EVERY rendered row instead: that is both calendar
  // independent and stricter than checking one row.
  const upcomingTitles = page.getByText("Uzun Açıklamalı Aylık Düzenli Maaş Geliri", { exact: true });
  const receivedActions = page.getByRole("button", { name: "Alındı", exact: true });
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

  await page.goto("/helix/settings");
  await expect(page.getByText(/Tanılama|senkron sağlığı/i)).toHaveCount(0);
  await assertNoRuntimeErrors(errors, testInfo);
});

/**
 * Settings screens reachable from more than one place must return to the screen
 * that opened them.
 *
 * Payment sources, budgets and income rules are pushed from OUTSIDE the settings
 * tab with `{ withAnchor: true }`. The anchor is required — without it the stack
 * mounts with only the pushed route and `popToTopOnBlur` becomes a no-op — but
 * it also mounts `settings/index` UNDERNEATH, so plain history sent the user
 * back to a hub they never visited. Each pusher now records `from`, and
 * `resolveBackTarget` validates it against a fixed map before use.
 */
test("multi-entry settings screens return to whoever opened them", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);

  // Entry 1: Analysis → Budgets → back must land on Analysis, not the hub.
  await page.goto("/helix/cash-flow/analytics?from=summary");
  await expect(page.getByRole("heading", { name: "Analiz", exact: true })).toBeVisible();
  await page.goto("/helix/settings/budgets?from=analysis");
  await expect(page.getByRole("heading", { name: "Aylık Bütçeler", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Geri", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Analiz", exact: true })).toBeVisible();

  // Entry 2: Upcoming → Income rules → back must land on Upcoming.
  await page.goto("/helix/settings/incomes?from=upcoming");
  await expect(page.getByRole("heading", { name: "Düzenli Gelirler", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Geri", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Yaklaşan Takvimi", exact: true })).toBeVisible();

  // Entry 3: the transaction form → Payment sources → back to the form.
  await page.goto("/helix/settings/payment-sources?from=transaction");
  await expect(page.getByRole("heading", { name: "Ödeme Yöntemleri", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Geri", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Yeni İşlem" }).first()).toBeVisible();

  // A deep link with NO recorded source, and one with a hostile value, must both
  // fall back to the settings hub instead of guessing or crashing.
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

  await assertNoRuntimeErrors(errors, testInfo);
});
