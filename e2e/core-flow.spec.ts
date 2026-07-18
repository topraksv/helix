import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  addMarketExpense,
  assertNoRuntimeErrors,
  collectRuntimeErrors,
  currentMonthKey,
  isolateExternalData,
  onboard,
} from "./helpers";

test.beforeEach(async ({ context }) => isolateExternalData(context));

test("onboarding → add → edit → delete/undo → backup protects the core ledger flow", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await addMarketExpense(page, "E2E market alışverişi");

  await page.goto(`/helix/cash-flow/${currentMonthKey()}`);
  const category = page.getByRole("button", { name: /Market.*1\.234,56/ });
  await expect(category).toBeVisible();
  await category.click();
  await expect(page.getByText("E2E market alışverişi", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Düzenle" }).click();
  await expect(page.getByRole("heading", { name: "İşlemi Düzenle" })).toBeVisible();
  await page.getByRole("textbox", { name: "Not" }).fill("E2E düzenlendi");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("E2E düzenlendi", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sil" }).click();
  await expect(page.getByText("İşlem silindi", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Geri Al" }).click();
  await expect(page.getByText("E2E düzenlendi", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Ayarlar" }).click();
  await expect(page.getByRole("heading", { name: "Ayarlar", exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Yedek Oluştur/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^helix-yedek-\d{4}-\d{2}-\d{2}\.json$/);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const backup = JSON.parse(await readFile(downloadPath!, "utf8")) as {
    tables: { transactions: { note?: string | null; deleted_at?: string | null }[] };
  };
  expect(backup.tables.transactions).toEqual(
    expect.arrayContaining([expect.objectContaining({ note: "E2E düzenlendi", deleted_at: null })]),
  );
  await assertNoRuntimeErrors(errors, testInfo);
});

test("a clean browser restores a backup and a relationally invalid file writes nothing", async ({ browser, page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await addMarketExpense(page, "Atomik geri yükleme kanıtı", "345,67");
  await page.getByRole("tab", { name: "Ayarlar" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Yedek Oluştur/ }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  if (!backupPath) throw new Error("Backup download did not produce a local path");

  const restoreContext = await browser.newContext({ locale: "tr-TR", timezoneId: "Europe/Istanbul" });
  await isolateExternalData(restoreContext);
  const restorePage = await restoreContext.newPage();
  const restoreErrors = collectRuntimeErrors(restorePage);
  await restorePage.goto("/helix/");
  const chooserPromise = restorePage.waitForEvent("filechooser");
  await restorePage.getByRole("button", { name: /Yedek \(JSON\) içe aktar/ }).click();
  await (await chooserPromise).setFiles(backupPath);
  await expect(restorePage.getByRole("tab", { name: "Bütçe Özeti", selected: true })).toBeVisible();
  await restorePage.goto(`/helix/cash-flow/${currentMonthKey()}`);
  await restorePage.getByRole("button", { name: /Market.*345,67/ }).click();
  await expect(restorePage.getByText("Atomik geri yükleme kanıtı", { exact: true })).toBeVisible();
  expect(restoreErrors).toEqual([]);
  await restoreContext.close();

  const invalid = JSON.parse(await readFile(backupPath, "utf8")) as {
    tables: {
      categories: { name: string }[];
      transactions: { category_id: string | null }[];
    };
  };
  invalid.tables.categories[0]!.name = "POISON_CATEGORY";
  invalid.tables.transactions[0]!.category_id = "00000000-0000-7000-8000-999999999999";
  const invalidPath = testInfo.outputPath("invalid-relationship.json");
  await import("node:fs/promises").then(({ writeFile }) => writeFile(invalidPath, JSON.stringify(invalid)));

  const invalidContext = await browser.newContext({ locale: "tr-TR", timezoneId: "Europe/Istanbul" });
  await isolateExternalData(invalidContext);
  const invalidPage = await invalidContext.newPage();
  await invalidPage.goto("/helix/");
  const invalidChooser = invalidPage.waitForEvent("filechooser");
  await invalidPage.getByRole("button", { name: /Yedek \(JSON\) içe aktar/ }).click();
  await (await invalidChooser).setFiles(invalidPath);
  await expect(invalidPage.getByText("Geçersiz yedek dosyası", { exact: true })).toBeVisible();
  await invalidPage.getByRole("button", { name: "Tamam" }).click();
  await invalidPage.getByRole("button", { name: "Hemen Kullanmaya Başla" }).click();
  await invalidPage.goto("/helix/transaction");
  await expect(invalidPage.getByRole("radio", { name: "POISON_CATEGORY" })).toHaveCount(0);
  await invalidContext.close();

  await assertNoRuntimeErrors(errors, testInfo);
});
