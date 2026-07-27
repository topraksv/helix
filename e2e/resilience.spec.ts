import { expect, test } from "@playwright/test";
import {
  addMarketExpense,
  assertNoRuntimeErrors,
  collectRuntimeErrors,
  currentMonthKey,
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
  await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();
  await expect(page.getByText(/-₺210,50/).first()).toBeVisible();
  await context.setOffline(false);

  await openCashFlow(page);
  await page.getByRole("radio", { name: "Ay odaklı" }).click();
  await expect(page.getByText(/-₺210,50/).first()).toBeVisible();
  await assertNoRuntimeErrors(errors, testInfo);
});

/**
 * Only one document may hold the local database.
 *
 * On web the workspace lives in a single OPFS file whose access handle is
 * exclusive, so opening the app in a second tab necessarily fails — that part is
 * the platform, and the important half is that it fails safely: the tab that
 * already had the database keeps working and keeps every row.
 *
 * What was broken is the recovery. wa-sqlite leaves the FAILED document in an
 * "Invalid VFS state" for as long as it lives, so re-running the migration in
 * the same page returned the identical error forever — "Tekrar dene" looked like
 * an action and was incapable of ever succeeding, while a plain browser refresh
 * recovered instantly. The button now reloads on web, which is the only thing
 * that actually works, so the remedy is not something the user has to guess.
 */
test("a second tab fails safely and its retry really recovers", async ({ page, context }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await addMarketExpense(page, "Tek sekme sahipliği", "410,00");

  const second = await context.newPage();
  await second.goto("/helix/");
  await expect(second.getByText("Veritabanı hatası")).toBeVisible();

  // The owning tab is untouched by the blocked one.
  await page.bringToFront();
  await page.goto(`/helix/cash-flow/${currentMonthKey()}`);
  await expect(page.getByRole("button", { name: /Market.*410,00/ })).toBeVisible();

  await page.close();
  await second.bringToFront();
  await second.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(second.getByRole("tab", { name: "Durum", selected: true })).toBeVisible({ timeout: 20_000 });
  await second.goto(`/helix/cash-flow/${currentMonthKey()}`);
  await expect(second.getByRole("button", { name: /Market.*410,00/ })).toBeVisible();
  await second.close();

  await assertNoRuntimeErrors(errors, testInfo);
});

test("protected and modal deep links keep deterministic navigation", async ({ page }, testInfo) => {
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
  // Local-only builds cannot keep the account in the cloud or end a cloud
  // session, so the cloud-security route and its misleading action stay hidden.
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
  const month = currentMonthKey();
  await page.goto(`/helix/cash-flow/${month}`);
  await expect(page.getByText("Beklenmeyen bir sorun oluştu.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toHaveCount(0);

  await assertNoRuntimeErrors(errors, testInfo);
});

// Analysis lives in the Cash Flow stack but Summary can open it too, so it has
// a root-level route for the cross-tab entry. Both paths are asserted because
// they resolve differently by design: from Summary the screen underneath is
// Summary, from the Financial Table it is the table. Serving one of them with a
// single hard-coded back target is exactly what breaks the other.
test("Analysis goes back to whichever screen opened it", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);

  await page.getByRole("tab", { name: "Durum" }).click();
  await page.getByRole("button", { name: /Net değişim/ }).click();
  await expect(page.getByRole("heading", { name: "Analiz", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Geri", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();
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

  await page.getByRole("tab", { name: "Durum" }).click();
  await expect(page.getByRole("button", { name: /Ay sonu tahmini/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /Halka grafik/ })).toBeVisible();
  await page.getByRole("radio", { name: "Sütun", exact: true }).click();
  await expect(page.getByRole("img", { name: /Sütun grafik/ })).toBeVisible();

  // Opened from Summary, Analysis is a root-level screen and covers the tabs —
  // the same shape as Upcoming, which this card sits next to. Back returns to
  // Summary, and the tab route still works from there.
  await page.getByRole("button", { name: /Net değişim/ }).click();
  await expect(page.getByRole("heading", { name: "Analiz", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Geri", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();
  await page.getByRole("tab", { name: "Mali Tablo" }).click();
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();
  await assertNoRuntimeErrors(errors, testInfo);
});

test("follow-up controls stay understandable on a narrow phone", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await onboard(page);

  // One real persisted payment source, so the source filter is exercised
  // against an actual option rather than mocked component state.
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

  // Choosing WHEN to search never depended on choosing a payment method: the
  // period field is usable from the start, and picking a source or clearing it
  // back to "Tümü" leaves it alone.
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
  // …and once the search covers all time, the window controls above it stop
  // accepting input, because nothing they set applies to it any more.
  await expect(page.getByRole("radio", { name: "Yıl", exact: true })).toBeDisabled();

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

  // Driven by clicking, not by a synthesised `?from=`: the guarantee is now
  // structural — a cross-tab push goes to the screen's root route, so what sits
  // underneath IS the screen the user came from. Simulating the entry by URL
  // would prove nothing about the thing that makes it work.

  // Entry 1: Summary → Analysis → Budgets → back → Analysis → back → Summary.
  await page.getByRole("button", { name: /Net değişim/ }).click();
  await expect(page.getByRole("heading", { name: "Analiz", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Aylık harcama limitini belirle/ }).click();
  await expect(page.getByRole("heading", { name: "Aylık Harcama Limiti", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Geri", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Analiz", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Geri", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();

  // Only one end-to-end path is driven here, and on purpose. The rule is
  // structural — a cross-tab push goes to the screen's root route — so what
  // needs proving in a browser is that the structure produces the right
  // journey, not that it does so from every entry point. The other entries
  // need their own fixtures (a credit card with no statement cycle, an income
  // rule due soon) and would test those fixtures more than this rule;
  // `tests/navigation.test.ts` covers the mechanism for all of them by
  // asserting the root routes exist and that nothing pushes with an anchor.

  // A direct link has no history at all, and a hostile query string must not
  // change that: every one of these falls back to its own deterministic parent.
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

/**
 * One rate fetch per app session, whichever entry point starts it.
 *
 * `root-lifecycle.ts` calls `refreshRates` DIRECTLY on boot (it awaits it inside
 * the session task), while the currency converter goes through the throttled
 * `ensureFreshRates`. The throttle timestamp used to be armed only by the
 * wrapper, so the boot fetch left it at 0 and the converter — mounting on the
 * calculator screen within the next minute — issued a second request for the
 * same rates. Measured before the fix: every route made one Frankfurter request,
 * the calculator made two.
 */
test("the FX provider is called once per session, not once per entry point", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  const fxCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("frankfurter")) fxCalls.push(request.url());
  });

  await onboard(page);

  // Every `goto` in this suite is a full page load, so one load == one app
  // session. Count exactly one load: the calculator, where BOTH callers run —
  // the boot refresh and the converter's focus refresh.
  fxCalls.length = 0;
  await page.goto("/helix/calculator");
  await expect(page.getByRole("heading", { name: "Hesap Makinesi", exact: true })).toBeVisible();
  await page.waitForTimeout(1500);

  expect(fxCalls.length, `FX provider called ${fxCalls.length}× in one session: ${fxCalls.join(", ")}`)
    .toBeLessThanOrEqual(1);

  // Client-side navigation away and back must not add another inside the window.
  await page.getByRole("tab", { name: "Durum" }).click();
  await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();
  await page.getByRole("tab", { name: "Araçlar" }).click();
  await expect(page.getByRole("heading", { name: "Hesap Makinesi", exact: true })).toBeVisible();
  await page.waitForTimeout(1200);
  expect(fxCalls.length, "a repeat visit refetched inside the 60 s throttle").toBeLessThanOrEqual(1);

  await assertNoRuntimeErrors(errors, testInfo);
});
