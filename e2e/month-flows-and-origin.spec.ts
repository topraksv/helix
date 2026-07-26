/**
 * Three regressions that only a real render proves:
 *
 * - a future month's card showed a carried balance above three zeros while the
 *   table cell beside it already listed the planned amount;
 * - the transfer classification was repeated as a live switch under every
 *   single expense column;
 * - a screen's recorded origin did not survive a round trip through another
 *   screen, so its back control quietly reverted to the stack's own parent.
 */

import { expect, test, type Page } from "@playwright/test";
import { addMonthsToKey } from "../src/domain/dates";
import { currentMonthKey, isolateExternalData, onboard, pickOption } from "./helpers";

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

test("a future month card states the planned flows behind its own total", async ({ page }) => {
  await onboard(page);
  await addPlannedExpense(page, 2, "5.000,00");
  const planned = addMonthsToKey(currentMonthKey(), 2);

  // The month detail card and the entries listed under it are one statement.
  await page.goto(`/helix/cash-flow/${planned}`);
  const expenseRow = page.getByText("Gider", { exact: true }).locator("..");
  await expect(expenseRow).toContainText("5.000,00");
  await expect(expenseRow).not.toContainText("-₺0,00");
  await expect(page.getByRole("button", { name: /Market.*5\.000,00/ })).toBeVisible();

  // …and so is the "Ay odaklı" card for the same month.
  await page.getByRole("tab", { name: "Mali Tablo" }).click();
  await page.getByRole("radio", { name: "Ay odaklı" }).click();
  const card = page.getByRole("button").filter({ hasText: /5\.000,00/ }).first();
  await expect(card).toBeVisible();
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

test("the transfer classification appears once, in the row being edited", async ({ page }) => {
  await onboard(page);
  await page.goto("/helix/columns-editor");
  const transferSwitches = page.getByRole("switch", { name: /Yatırım kategorisi/ });

  // Exactly one: the new-category form. Never one under every column.
  await expect(transferSwitches).toHaveCount(1);

  // A transfer column still says so on the collapsed row — read-only, and only
  // where it is true. The seeded "Yatırım" column is the one such column.
  const marker = page.getByText("Yatırım", { exact: true });
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

test("Analysis returns to Summary even after a detour through Budgets", async ({ page }) => {
  await onboard(page);
  // Opened from another tab, so it is the ROOT route: what sits under it is
  // Summary itself. Nothing records an origin any more, and there is no query
  // parameter to lose on the way back.
  await page.getByRole("button", { name: /Net değişim/ }).click();
  await expect(page.getByRole("heading", { name: "Analiz", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/helix\/analytics$/);

  await page.getByRole("button", { name: /Aylık harcama limitini belirle/ }).click();
  await expect(page).toHaveURL(/\/helix\/budgets$/);

  await page.getByRole("button", { name: "Geri" }).click();
  await expect(page).toHaveURL(/\/helix\/analytics$/);

  // …so the next back reaches Summary, not the Financial Table.
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
  // A hand-typed origin must never widen the target; it degrades to the parent.
  await page.goto("/helix/cash-flow/analytics?from=https://evil.example");
  await expect(page.getByRole("heading", { name: "Analiz", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Geri" }).click();
  await expect(page).toHaveURL(/\/helix\/cash-flow$/);
});
