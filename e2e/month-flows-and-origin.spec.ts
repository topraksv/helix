import { expect, test, type Page } from "@playwright/test";
import { addMonthsToKey } from "../src/domain/dates";
import { addMarketExpense, addSubscription, currentMonthKey, isolateExternalData, onboard, openCashFlow, pickOption } from "./helpers";
import { monthLabel } from "../src/i18n/tr";

test.beforeEach(async ({ context }) => isolateExternalData(context));

/** A future-dated expense: month mode, `months` steps forward from today. */
async function addPlannedExpense(page: Page, months: number, amount: string): Promise<void> {
  await page.getByRole("tab", { name: "Mali Tablo" }).click();
  await page.getByRole("button", { name: "İşlem Ekle" }).first().click();
  await expect(page.getByRole("heading", { name: "Yeni İşlem" })).toBeVisible();
  await page.getByRole("textbox", { name: "Tutar · TRY" }).fill(amount);
  await pickOption(page, "Kategori", /Market/);
  await page.getByRole("radio", { name: "Sadece ay" }).click();
  for (let step = 0; step < months; step++) await page.getByRole("button", { name: "Sonraki" }).click();
  const save = page.getByRole("button", { name: "Kaydet", exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("heading", { name: "Yeni İşlem" })).toBeHidden();
}

test("a future month focus states the planned flows behind its own total", async ({ page }) => {
  await onboard(page);
  await addPlannedExpense(page, 2, "5.000,00");
  const planned = addMonthsToKey(currentMonthKey(), 2);

  // The month detail card and the entries listed under it are one statement.
  await page.goto(`/helix/cash-flow/${planned}`);
  const expenseRow = page.getByText("Gider", { exact: true }).locator("..");
  await expect(expenseRow).toContainText("5.000,00");
  await expect(expenseRow).not.toContainText("-₺0,00");
  await expect(page.getByRole("button", { name: /Market.*5\.000,00/ })).toBeVisible();

  // …and so is the month-focused statement for the same month.
  await page.getByRole("tab", { name: "Mali Tablo" }).click();
  await page.getByRole("radio", { name: "Ay odaklı" }).click();
  for (let step = 1; step <= 2; step++) {
    await page.getByRole("button", { name: monthLabel(addMonthsToKey(currentMonthKey(), step)), exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: monthLabel(planned), exact: true })).toBeVisible();
  await expect(page.getByText("Gider", { exact: true })).toBeVisible();
  await expect(page.getByText("₺5.000,00", { exact: true })).toHaveCount(2);
  // The card and the grid's "Güncel Bakiye" column both state the total: scope to the card, then name the cell.
  await expect(page.getByTestId("month-focus-card").getByText(/^-.*₺5\.000,00$/)).toBeVisible();
  await expect(
    page.getByRole("group", { name: new RegExp(`${monthLabel(planned)}, Güncel Bakiye, -.*₺5\\.000,00`) }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Market.*5\.000,00/ })).toBeVisible();
});

test("the table closes this month on the Summary card's month-end forecast", async ({ page }) => {
  await onboard(page);
  // Billed today and not yet confirmed: an obligation, not a movement.
  await addSubscription(page, "Netflix", "229,99");

  await page.getByRole("tab", { name: "Durum" }).click();
  const forecast = page.getByTestId("dashboard-forecast-toggle");
  // The forecast has to carry the subscription, or two zeros would agree.
  await expect(forecast).toHaveAttribute("aria-label", /229,99/u);
  const figure = /^Ay sonu tahmini (.+), (?:yükseliyor|düşüyor)$/u.exec((await forecast.getAttribute("aria-label")) ?? "")?.[1];
  expect(figure).toBeDefined();

  await openCashFlow(page);
  const month = currentMonthKey();
  await expect(page.getByRole("group", { name: `${monthLabel(month)}, Güncel Bakiye, ${figure}`, exact: true })).toBeVisible();

  // The month's own list shows what its total counts.
  await page.goto(`/helix/cash-flow/${month}`);
  await page.getByRole("button", { name: /229,99/u }).first().click();
  await expect(page.getByText("Netflix", { exact: true })).toBeVisible();
  await expect(page.getByText(/Beklenen ödeme/u)).toBeVisible();
});

test("an untouched month still reads zero rather than a borrowed number", async ({ page }) => {
  await onboard(page);
  await addPlannedExpense(page, 2, "5.000,00");
  const quiet = addMonthsToKey(currentMonthKey(), 1);
  await page.goto(`/helix/cash-flow/${quiet}`);
  const expenseRow = page.getByText("Gider", { exact: true }).locator("..");
  await expect(expenseRow).toContainText("₺0,00");
  await expect(expenseRow).not.toContainText("5.000,00");
  // A signed zero is a formatting bug, not an amount.
  await expect(expenseRow).not.toContainText("-₺0,00");
});

test("month balance transition stays between its amounts, on a shared baseline, on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await onboard(page);
  await page.goto(`/helix/cash-flow/${currentMonthKey()}`);

  const transition = page.getByTestId("month-balance-transition");
  await expect(transition).toBeVisible();
  const geometry = await transition.evaluate((element) => {
    const box = (selector: string) => {
      const node = element.parentElement?.parentElement?.querySelector<HTMLElement>(selector);
      if (!node) throw new Error(`Missing month balance geometry: ${selector}`);
      return node.getBoundingClientRect().toJSON() as DOMRect;
    };
    return {
      bridge: element.getBoundingClientRect().toJSON() as DOMRect,
      opening: box('[data-testid="month-opening-amount"]'),
      closing: box('[data-testid="month-closing-amount"]'),
    };
  });

  expect(geometry.bridge.left).toBeGreaterThanOrEqual(geometry.opening.right - 1);
  expect(geometry.bridge.right).toBeLessThanOrEqual(geometry.closing.left + 1);
  expect(geometry.bridge.top).toBeLessThan(geometry.opening.bottom);
  expect(geometry.bridge.bottom).toBeGreaterThan(geometry.opening.top);
  expect(Math.abs(geometry.opening.bottom - geometry.closing.bottom)).toBeLessThanOrEqual(1);
});

test("a large cell total stays inside its row after a narrow resize", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await onboard(page);
  await addMarketExpense(page, "Büyük hücre toplamı", "987.654.321,00");
  const month = currentMonthKey();
  await page.getByRole("button", { name: new RegExp(`^${monthLabel(month)}, Market`) }).click();
  await expect(page.getByTestId("cell-total-row")).toBeVisible();

  await page.setViewportSize({ width: 320, height: 844 });
  const row = page.getByTestId("cell-total-row");
  // The resize commits through a layout observer; wait for the amount fit pass to settle.
  await expect.poll(() => row.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const geometry = await row.evaluate((row) => {
    const amount = row.querySelector<HTMLElement>('[data-testid="cell-total-amount"]');
    if (!amount) throw new Error("Missing cell total amount");
    const rowBox = row.getBoundingClientRect();
    const amountBox = amount.getBoundingClientRect();
    return {
      rowLeft: rowBox.left,
      rowRight: rowBox.right,
      rowScrollWidth: row.scrollWidth,
      rowClientWidth: row.clientWidth,
      amountLeft: amountBox.left,
      amountRight: amountBox.right,
      amountTop: amountBox.top,
      amountBottom: amountBox.bottom,
      rowTop: rowBox.top,
      rowBottom: rowBox.bottom,
      ariaLabel: amount.getAttribute("aria-label"),
    };
  });
  expect(geometry.rowScrollWidth).toBeLessThanOrEqual(geometry.rowClientWidth + 1);
  expect(geometry.amountLeft).toBeGreaterThanOrEqual(geometry.rowLeft - 1);
  expect(geometry.amountRight).toBeLessThanOrEqual(geometry.rowRight + 1);
  expect(geometry.amountTop).toBeGreaterThanOrEqual(geometry.rowTop - 1);
  expect(geometry.amountBottom).toBeLessThanOrEqual(geometry.rowBottom + 1);
  expect(geometry.ariaLabel).toMatch(/^-.*₺987\.654\s+Mn$/u);
});

test("the transfer classification appears once, in the row being edited", async ({ page }) => {
  await onboard(page);
  await page.goto("/helix/columns-editor");
  const transferSwitches = page.getByRole("switch", { name: /Yatırım kategorisi/ });

  // Exactly one: the new-category form. Never one under every column.
  await expect(transferSwitches).toHaveCount(1);

  // By test id, not text: the marker and the seeded "Yatırım" category name read the same.
  const marker = page.getByTestId("category-transfer-marker");
  await expect(marker).toHaveCount(1);

  // Editing a column reveals its own classification, and only its own.
  await page.getByRole("button", { name: "Düzenle · Market" }).click();
  await expect(transferSwitches).toHaveCount(2);
  const rowSwitch = page.getByRole("switch", { name: "Market · Yatırım kategorisi" });
  await expect(rowSwitch).toHaveAttribute("aria-checked", "false");

  // It reads and writes the edited category, saved together with the name.
  await rowSwitch.click();
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(transferSwitches).toHaveCount(1);
  await expect(marker).toHaveCount(2);

  // Re-opening the row reads the persisted value back.
  await page.getByRole("button", { name: "Düzenle · Market" }).click();
  await expect(page.getByRole("switch", { name: "Market · Yatırım kategorisi" })).toHaveAttribute("aria-checked", "true");
});

test("Analysis returns to Summary even after a detour through Budgets @cross-browser", async ({ page }) => {
  await onboard(page);
  // Opened from another tab, so it is the ROOT route: what sits under it is Summary itself.
  await page.getByRole("button", { name: /Net değişim/ }).click();
  await expect(page.getByRole("heading", { name: "Analiz", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/helix\/analytics$/);

  await page.getByRole("button", { name: /Aylık harcama limitini belirle/ }).click();
  await expect(page).toHaveURL(/\/helix\/budgets$/);

  await page.getByRole("button", { name: "Geri" }).click();
  await expect(page).toHaveURL(/\/helix\/analytics$/);

  await page.getByRole("button", { name: "Geri" }).click();
  await expect(page).toHaveURL(/\/helix\/$/);
  await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();
});

test("Analysis opened from the Financial Table still goes back to it", async ({ page }) => {
  await onboard(page);
  await page.getByRole("tab", { name: "Mali Tablo" }).click();
  await page.getByRole("button", { name: "Analiz", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Analiz", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Geri" }).click();
  await expect(page).toHaveURL(/\/helix\/cash-flow$/);
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();
});

test("a direct link to Analysis falls back to its own parent", async ({ page }) => {
  await onboard(page);
  // A hand-typed origin must never widen the target.
  await page.goto("/helix/cash-flow/analytics?from=https://evil.example");
  await expect(page.getByRole("heading", { name: "Analiz", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Geri" }).click();
  await expect(page).toHaveURL(/\/helix\/cash-flow$/);
});

// The discard replaced the root-stack form with a second copy of the tabs holding
// Taksitler alone, so its Back fell through to the tab router's first route (Durum).
test("Installments goes back to the Financial Table after a dirty form is discarded", async ({ page }) => {
  await onboard(page);
  await page.getByRole("tab", { name: "Mali Tablo" }).click();
  await page.getByRole("button", { name: "Taksitler", exact: true }).first().click();
  await expect(page).toHaveURL(/\/helix\/cash-flow\/installments$/);

  await page.getByRole("button", { name: "Taksit veya Kredi Ekle" }).first().click();
  await page.getByRole("textbox", { name: "Başlık", exact: true }).fill("Kaydedilmeyecek plan");
  await page.getByRole("button", { name: "Geri", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Değişiklikleri sil", exact: true }).click();
  await expect(page).toHaveURL(/\/helix\/cash-flow\/installments$/);

  await page.getByRole("button", { name: "Geri", exact: true }).click();
  await expect(page).toHaveURL(/\/helix\/cash-flow$/);
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();
});
