import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { composeWorkbook, WORKBOOK_MIME } from "../src/services/workbook-export";
import {
  addMarketExpense,
  addSubscription,
  collectRuntimeErrors,
  currentIstanbulDay,
  currentMonthKey,
  isolateExternalData,
  onboard,
  openCashFlow,
  pickOption,
  renderedContrast,
} from "./helpers";

test.beforeEach(async ({ context }) => isolateExternalData(context));

async function downloadBackup(page: Page) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Yedek Oluştur/ }).click();
  return downloadPromise;
}

test("onboarding → add → edit → delete/undo → backup protects the core ledger flow @cross-browser", async ({ page }) => {
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
  const undo = page.getByRole("button", { name: "Geri Al" });
  // The snackbar inverts the page; role queries stayed green while its label was 1.27:1.
  expect(await renderedContrast(undo.getByText("Geri Al"), "text")).toBeGreaterThanOrEqual(4.5);
  await undo.click();
  await expect(page.getByText("E2E düzenlendi", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Ayarlar" }).click();
  await expect(page.getByRole("heading", { name: "Ayarlar", exact: true })).toBeVisible();
  const download = await downloadBackup(page);
  expect(download.suggestedFilename()).toMatch(/^helix-yedek-\d{4}-\d{2}-\d{2}\.json$/);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const backup = JSON.parse(await readFile(downloadPath!, "utf8")) as {
    tables: { transactions: { note?: string | null; deleted_at?: string | null }[] };
  };
  expect(backup.tables.transactions).toEqual(
    expect.arrayContaining([expect.objectContaining({ note: "E2E düzenlendi", deleted_at: null })]),
  );

  expect(errors).toEqual([]);
});

test("two rows of one day name the row each of their actions belongs to", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await addMarketExpense(page, "Migros", "10,00");
  await addMarketExpense(page, "Şok", "20,00");

  await page.goto(`/helix/cash-flow/${currentMonthKey()}`);
  await page.getByRole("button", { name: /Market.*30,00/ }).click();
  for (const verb of ["Düzenle", "Sil"]) {
    const labels = await page
      .getByRole("button", { name: new RegExp(`^${verb} · `) })
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
    // The date follows the name: it tells two rows of one merchant apart.
    expect(labels).toEqual(expect.arrayContaining([
      expect.stringMatching(new RegExp(`^${verb} · Migros · \\d`, "u")),
      expect.stringMatching(new RegExp(`^${verb} · Şok · \\d`, "u")),
    ]));
  }
  expect(errors).toEqual([]);
});

test("an edit that moves a foreign-currency row to another day prices it at that day's rate", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  // The feed is dated by publication time: 40 TRY today, then 50 TRY on the 15th of last month.
  const [year, month] = currentMonthKey().split("-").map(Number) as [number, number];
  const earlier = new Date(Date.UTC(year, month - 2, 15, 9));
  let feed = { unix: Math.floor(Date.now() / 1000), usd: 0.025 };
  await page.route("https://open.er-api.com/v6/latest/TRY", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ result: "success", time_last_update_unix: feed.unix, rates: { USD: feed.usd, EUR: 0.02 } }),
  }));

  await page.goto("/helix/cash-flow");
  await page.getByRole("button", { name: "İşlem Ekle" }).click();
  await page.getByRole("textbox", { name: "Tutar · TRY" }).fill("10,00");
  await pickOption(page, "Kategori", /Market/);
  await page.getByRole("textbox", { name: "Not" }).fill("Kur");
  await page.getByRole("button", { name: /döviz · TRY/ }).click();
  await page.getByRole("button", { name: /· Değiştir$/ }).click();
  await page.getByRole("radio", { name: /Dolar/ }).click();
  await expect(page.getByText(/^≈ .*400/)).toBeVisible();
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();

  feed = { unix: earlier.getTime() / 1000, usd: 0.02 };
  await page.goto(`/helix/cash-flow/${currentMonthKey()}`);
  await page.getByRole("button", { name: /Market/ }).first().click();
  await page.getByRole("button", { name: "Düzenle · Kur" }).click();
  await expect(page.getByText(/^≈ .*400/)).toBeVisible();
  await page.getByRole("button", { name: "Ödeme günü" }).click();
  await page.getByRole("button", { name: "Önceki", exact: true }).click();
  const day = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(earlier);
  await page.getByRole("button", { name: day, exact: true }).click();
  await expect(page.getByText(/^≈ .*500/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("a clean browser restores a backup and a relationally invalid file writes nothing @cross-browser", async ({ browser, page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await addMarketExpense(page, "Atomik geri yükleme kanıtı", "345,67");
  await page.getByRole("tab", { name: "Ayarlar" }).click();
  const download = await downloadBackup(page);
  const backupPath = await download.path();
  if (!backupPath) throw new Error("Backup download did not produce a local path");

  const restoreContext = await browser.newContext();
  await isolateExternalData(restoreContext);
  const restorePage = await restoreContext.newPage();
  const restoreErrors = collectRuntimeErrors(restorePage);
  await restorePage.goto("/helix/");
  const chooserPromise = restorePage.waitForEvent("filechooser");
  await restorePage.getByRole("button", { name: /Yedek \(JSON\) içe aktar/ }).click();
  await (await chooserPromise).setFiles(backupPath);
  await expect(restorePage.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();
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
  await writeFile(invalidPath, JSON.stringify(invalid));

  const invalidContext = await browser.newContext();
  await isolateExternalData(invalidContext);
  const invalidPage = await invalidContext.newPage();
  await invalidPage.goto("/helix/");
  const invalidChooser = invalidPage.waitForEvent("filechooser");
  await invalidPage.getByRole("button", { name: /Yedek \(JSON\) içe aktar/ }).click();
  await (await invalidChooser).setFiles(invalidPath);
  // The refusal must say where, not just that it happened.
  await expect(invalidPage.getByText(/Geçersiz yedek dosyası\./)).toBeVisible();
  await expect(invalidPage.getByText(/bölümündeki \d+\. kayıt alınamadı/)).toBeVisible();
  await expect(invalidPage.getByText(/bağlı olduğu kayıt dosyada yok/)).toBeVisible();
  await invalidPage.getByRole("button", { name: "Tamam" }).click();
  await invalidPage.getByRole("button", { name: "Hemen Kullanmaya Başla" }).click();
  // Nothing was written, so guarded /transaction lands back on setup. Asserting
  // the redirect matters: a count on /transaction alone was zero whatever the import did.
  await invalidPage.goto("/helix/transaction");
  await expect(invalidPage).toHaveURL(/\/helix\/setup$/);
  await expect(invalidPage.getByText("POISON_CATEGORY")).toHaveCount(0);
  await invalidContext.close();

  expect(errors).toEqual([]);
});

test("the subscription cost summary reports the price history it stores", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 430, height: 932 });
  await onboard(page);

  await addSubscription(page, "Netflix", "229,99", "5");

  const summary = page.getByTestId("subscription-cost-summary");
  await expect(summary).toBeVisible();
  // One monthly rule: the annual figure is twelve of it, not a second model.
  await expect(summary).toContainText("₺229,99");
  await expect(summary).toContainText("₺2.759,88");
  await expect(summary).toContainText("Fiyat değişikliği kaydedilmedi.");

  await page.getByRole("button", { name: /Düzenle · Netflix/ }).first().click();
  await expect(page).toHaveURL(/subscription-form\?id=/);
  await page.getByRole("textbox", { name: "Tutar · TRY", exact: true }).fill("299,99");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page).toHaveURL(/subscriptions/);

  await expect(summary).toContainText("₺299,99");
  await expect(summary).toContainText("₺3.599,88");
  // The change is spoken as well as drawn: direction never rides on colour.
  await expect(summary.getByLabel(/Netflix zamlandı: ₺229,99 yerine ₺299,99/u)).toBeVisible();

  expect(errors).toEqual([]);
});

// The confirmation must stay a bar: no dialog, no route remount, no reload behind it.
test("saving reports its balance effect without refreshing the screen", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 430, height: 932 });
  await onboard(page);

  // A marker on the live dashboard: if the route remounted, it is gone.
  await page.evaluate(() => {
    const mark = document.createElement("div");
    mark.id = "remount-probe";
    document.body.append(mark);
  });

  await page.getByRole("button", { name: /İşlem Ekle/ }).first().click();
  await page.getByRole("textbox", { name: "Tutar · TRY", exact: true }).fill("250");
  await pickOption(page, "Kategori", "Market");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();

  const bar = page.getByRole("alert").first();
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("İşlem kaydedildi.");
  await expect(bar).toContainText(/Güncel bakiyen .*250,00 değişti\./u);
  await expect(bar.getByRole("button", { name: "Düzenle", exact: true })).toBeVisible();

  // Non-blocking: the dashboard behind it is interactive and already updated.
  await expect(page.getByTestId("dashboard-current-balance")).toContainText("250,00");
  expect(await page.locator("#remount-probe").count(), "the route must not remount").toBe(1);

  expect(errors).toEqual([]);
});

test("a hand-entered ledger row claims no origin it cannot prove", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await onboard(page);
  await addMarketExpense(page, "E2E köken");

  await page.goto(`/helix/cash-flow/${currentMonthKey()}`);
  await page.getByRole("button", { name: /Market/ }).first().click();
  await page.getByRole("button", { name: /^Düzenle/ }).first().click();
  await expect(page).toHaveURL(/\/transaction\?id=/u);
  await expect(page.getByTestId("transaction-provenance")).toHaveCount(0);

  // The removed duplicate review and expectation matching stay gone.
  await page.goto("/helix/reconciliation");
  await expect(page.getByText("Olası tekrar kayıtlar")).toHaveCount(0);
  await expect(page.getByText("Mevcut İşlemle Eşleştir")).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("the attention inbox groups what is waiting and lets it be deferred or finished", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await onboard(page);

  // A subscription billed today produces one pending obligation.
  await addSubscription(page, "Netflix", "229,99");

  await page.goto("/helix/attention");
  // Grouped by decision, and "new" is a word rather than a coloured dot.
  await expect(page.getByText("Bugün", { exact: true })).toBeVisible();
  await expect(page.getByText("Bugün ödenecek", { exact: true })).toBeVisible();
  await expect(page.getByText("1 yeni", { exact: true })).toBeVisible();
  const item = page.locator('[data-testid^="attention-item-expected:"]').first();
  await expect(item).toBeVisible();
  await expect(item).toContainText("Netflix");
  await expect(item).toContainText("₺229,99");

  // Deferring removes the row and stays undoable: a defer is not a decision.
  await item.getByRole("button", { name: "Sonra", exact: true }).click();
  await expect(page.locator('[data-testid^="attention-item-expected:"]')).toHaveCount(0);
  const bar = page.getByRole("alert").first();
  await expect(bar).toContainText("Bir hafta sonra yeniden hatırlatılacak.");
  await bar.getByRole("button", { name: "Geri Al", exact: true }).click();
  await expect(page.locator('[data-testid^="attention-item-expected:"]').first()).toBeVisible();

  // Finishing removes it too, and the inbox is then honestly empty.
  await page.locator('[data-testid^="attention-item-expected:"]').first()
    .getByRole("button", { name: "Bitti", exact: true }).click();
  await expect(page.getByText("Bekleyen bir şey yok.", { exact: true })).toBeVisible();

  expect(errors).toEqual([]);
});

// Generated in-process: a real statement is the most sensitive document the owner has.
function syntheticStatementPdf(lines: string[]): Buffer {
  const content = ["BT /F1 10 Tf 40 800 Td"]
    .concat(lines.map((line, index) =>
      `${index === 0 ? "" : "0 -14 Td "}(${line.replace(/([()\\])/g, "\\$1")}) Tj`))
    .concat(["ET"])
    .join("\n");
  const body = Buffer.from(content, "latin1");
  const parts: Buffer[] = [];
  const push = (value: string | Buffer) =>
    parts.push(Buffer.isBuffer(value) ? value : Buffer.from(value, "latin1"));
  push("%PDF-1.4\n");
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  push("3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n");
  push(`4 0 obj\n<< /Length ${body.length} >>\nstream\n`);
  push(body);
  push("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
  return Buffer.concat(parts);
}

async function choosePdf(page: Page, name: string, buffer: Buffer): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("statement-pick").click();
  await (await chooser).setFiles({ name, mimeType: "application/pdf", buffer });
}

test("a card statement is read locally, reviewed, and only then written", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await onboard(page);
  await page.goto("/helix/statement-import");

  // The promise the screen makes before anything is picked.
  await expect(page.getByText(/hiçbir yere yüklenmez/u)).toBeVisible();

  await choosePdf(page, "ekstre.pdf", syntheticStatementPdf([
    "HESAP OZETI",
    // Last period's settlement prints like a refund; it must not become a candidate.
    "01.08.2026 HESAPTAN YAPILAN ODEME -24.381,40",
    "12.08.2026 MIGROS MARKET 1.234,56",
    "03.08.2026 TEKNOSA 3/9 500,00",
    "31.02.2026 BOZUK SATIR 10,00",
    "Toplam 1.734,56",
  ]));

  // Both kinds are recognised, and the instalment is labelled as one.
  await expect(page.getByText("MIGROS MARKET", { exact: true })).toBeVisible();
  await expect(page.getByText("TEKNOSA", { exact: true })).toBeVisible();
  await expect(page.getByText("3/9. taksit", { exact: true })).toBeVisible();
  // A line it could not read is surfaced, not silently dropped.
  await expect(page.getByText("Tarih geçersiz", { exact: true })).toBeVisible();
  // The card's own settlement is left out but said, so totals reconcile with the paper.
  await expect(page.getByText("Bilerek alınmayanlar", { exact: true })).toBeVisible();
  await expect(page.getByText(/HESAPTAN YAPILAN ODEME/u)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /HESAPTAN YAPILAN ODEME/u })).toHaveCount(0);
  // Nothing is in the ledger yet.
  await expect(page.getByTestId("statement-commit")).toBeVisible();

  // The period is the one month this import may reach, shown before anything is written.
  await expect(page.getByTestId("statement-period")).toContainText("Ağustos 2026");
  await expect(page.getByTestId("statement-period")).toContainText("Ödeme günü: 31 Ağustos 2026");

  await page.getByTestId("statement-clear-selection").click();
  await expect(page.getByTestId("statement-commit")).toBeDisabled();
  await page.getByTestId("statement-select-new").click();
  await page.getByTestId("statement-commit").click();

  // The instalment line is one payment of a plan, so it becomes the plan, not a charge.
  await expect(page.getByRole("alert").first()).toContainText("1 işlem aktarıldı.");
  await expect(page.getByRole("alert").first()).toContainText("1 taksit planı oluşturuldu.");

  await page.goto("/helix/cash-flow/installments");
  await expect(page.getByText("TEKNOSA", { exact: true })).toBeVisible();

  // Re-importing the same statement must not double the ledger.
  await page.goto("/helix/statement-import");
  await choosePdf(page, "ekstre.pdf", syntheticStatementPdf([
    "12.08.2026 MIGROS MARKET 1.234,56",
    "03.08.2026 TEKNOSA 3/9 500,00",
  ]));
  await expect(page.getByText("Bu satır zaten aktarılmış").first()).toBeVisible();
  // Next month's statement must join this plan, not open a rival.
  await expect(page.getByText(/TEKNOSA taksit planı bu ödemeyi zaten oluşturuyor/u)).toBeVisible();
  // And nothing is pre-selected, so accepting the defaults writes nothing.
  await expect(page.getByTestId("statement-commit")).toBeDisabled();

  expect(errors).toEqual([]);
});

test("an unreadable statement is refused with a reason instead of guessed at", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await onboard(page);
  await page.goto("/helix/statement-import");

  // A PDF with no text layer is a scan; the app must say so.
  await choosePdf(page, "tarama.pdf", syntheticStatementPdf([]));
  await expect(page.getByTestId("statement-failure")).toContainText("taranmış bir görüntü");

  // A file that is not a PDF at all is a different problem with a different fix.
  await choosePdf(page, "not-a-pdf.pdf", Buffer.from("bu bir pdf degil", "latin1"));
  await expect(page.getByTestId("statement-failure")).toContainText("bir PDF değil");

  expect(errors).toEqual([]);
});

test("a receipt can be attached, opened and removed on the web", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await onboard(page);

  await addMarketExpense(page, "Makbuz", "120", "Market");

  await page.goto(`/helix/cash-flow/${currentMonthKey()}`);
  await page.getByRole("button", { name: /Market/ }).first().click();
  await page.getByRole("button", { name: /^Düzenle/ }).first().click();
  await expect(page).toHaveURL(/\/transaction\?id=/u);

  const panel = page.getByTestId("attachment-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("attachment-empty")).toBeVisible();

  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("attachment-add").click();
  await (await chooser).setFiles({
    name: "fatura.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test", "latin1"),
  });

  await expect(panel).toContainText("fatura.pdf");
  // The tile itself is the open control; a separate "Aç" button was removed.
  await expect(panel.getByRole("button", { name: /^Aç · fatura\.pdf/u })).toBeVisible();
  await expect(page.getByTestId("attachment-empty")).toHaveCount(0);

  // The list row says it has a document without opening anything.
  await page.goto(`/helix/cash-flow/${currentMonthKey()}`);
  await page.getByRole("button", { name: /Market/ }).first().click();
  await expect(page.getByText("Belge var", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /^Düzenle/ }).first().click();
  await expect(panel).toContainText("fatura.pdf");

  // Removal is undoable: a receipt is not recoverable once gone.
  await panel.getByRole("button", { name: /^Sil · fatura\.pdf$/u }).click();
  await expect(page.getByTestId("attachment-empty")).toBeVisible();
  await page.getByRole("alert").first().getByRole("button", { name: "Geri Al", exact: true }).click();
  await expect(panel).toContainText("fatura.pdf");

  expect(errors).toEqual([]);
});

// The click must fire the moment the control EXISTS: Playwright's wait-for-stable
// waits out the window of the race this test guards (a stale `updatedAt` across
// an id change made the screen redirect to the list).
test("the save confirmation opens the row it just saved, even when taken at once", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);

  await page.getByRole("button", { name: /İşlem Ekle/u }).first().click();
  await page.getByRole("textbox", { name: "Tutar · TRY", exact: true }).fill("321");
  await pickOption(page, "Kategori", "Market");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();

  const fired = await page.evaluate(async () => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const node = [...document.querySelectorAll('[role="alert"] [role="button"], [role="alert"] button')]
        .find((element) => (element.textContent ?? "").trim() === "Düzenle");
      if (node instanceof HTMLElement) {
        node.click();
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
    return false;
  });
  expect(fired, "the confirmation never offered its shortcut").toBe(true);

  await expect(page).toHaveURL(/\/transaction\?id=/u);
  await expect(page.getByRole("heading", { name: "İşlemi Düzenle" })).toBeVisible();
  // The saved row, not a blank form: the amount comes back formatted from what
  // was stored, which is what proves the screen resolved the id it was given.
  await expect(page.getByRole("textbox", { name: "Tutar · TRY", exact: true })).toHaveValue("321,00");

  expect(errors).toEqual([]);
});

// A hand-typed id writes nothing, so no change event comes: waiting for one would hang.
test("an id that names no row still answers, instead of waiting for ever", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);

  await page.goto("/helix/transaction?id=01a06b2c-0000-7000-8000-000000000000");
  await expect(page).toHaveURL(/\/cash-flow/u, { timeout: 10_000 });

  expect(errors).toEqual([]);
});

test("records a refund against an instalment purchase and shows it on the plan", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);

  await page.goto("/helix/installment-new");
  await page.getByRole("radio", { name: "Kredi" }).click();
  await page.getByRole("textbox", { name: "Başlık", exact: true }).fill("Çamaşır makinesi");
  await page.getByRole("textbox", { name: "Aylık Taksit", exact: true }).fill("1.000,00");
  const savePlan = page.getByRole("button", { name: "Kaydet", exact: true });
  await expect(savePlan).toBeEnabled();
  await savePlan.click();

  const addRefund = page.getByRole("button", { name: "İade Ekle" });
  await expect(addRefund).toBeVisible();
  await addRefund.click();
  await expect(page.getByText("Hangi alışverişi iade ettin?")).toBeVisible();
  await page.getByRole("button", { name: /Çamaşır makinesi/ }).click();
  await page.getByRole("textbox", { name: "İade tutarı", exact: true }).fill("300,00");
  await page.getByRole("radio", { name: "Tek Seferde" }).click();
  const saveRefund = page.getByRole("button", { name: "İadeyi Kaydet" });
  await expect(saveRefund).toBeEnabled();
  await saveRefund.click();

  // Back on the list, the purchase carries its refund.
  await expect(page.getByText(/^İade .*300/)).toBeVisible();
  await page.getByRole("button", { name: /Çamaşır makinesi/ }).click();
  await expect(page.getByText("İadeler", { exact: true })).toBeVisible();
  await expect(page.getByText("Güncel Tutar", { exact: true })).toBeVisible();

  // Both deletes here are tombstones, so both come back from the undo bar.
  const refundRow = page.getByRole("button", { name: /^Sil · .*300/ });
  await refundRow.click();
  await page.getByRole("dialog").getByRole("button", { name: "Sil", exact: true }).click();
  await expect(refundRow).toHaveCount(0);
  await page.getByRole("button", { name: "Geri Al", exact: true }).click();
  await expect(refundRow).toBeVisible();

  await page.getByRole("button", { name: "Bu planı sil" }).click();
  await expect(page.getByRole("dialog")).not.toContainText("Geri alınamaz");
  await page.getByRole("dialog").getByRole("button", { name: "Sil", exact: true }).click();
  await expect(page.getByText(/^İade .*300/)).toHaveCount(0);
  await page.getByRole("button", { name: "Geri Al", exact: true }).click();
  await expect(page.getByText(/^İade .*300/)).toBeVisible();

  expect(errors).toEqual([]);
});

// Opened at the root, not pushed into the Mali Tablo stack, which stayed stuck on it.
test("a card statement opens from Durum, takes a partial payment, and Back returns to Durum", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);

  // Closes today (at most the 27th) so the statement is inside Durum's 31-day window.
  const statementDay = Math.min(Number(currentIstanbulDay()), 27);
  await page.goto("/helix/settings/payment-sources");
  await page.getByRole("radio", { name: "Kredi Kartı" }).click();
  await page.getByRole("textbox", { name: "Yöntem adı" }).fill("Deneme Kart");
  await page.getByRole("textbox", { name: "Ekstre kesim günü" }).fill(String(statementDay));
  await page.getByRole("textbox", { name: "Son ödeme günü" }).fill(String(statementDay + 1));
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Deneme Kart").first()).toBeVisible();

  await page.goto("/helix/");
  await openCashFlow(page);
  await page.getByRole("button", { name: "İşlem Ekle" }).click();
  await page.getByRole("textbox", { name: "Tutar · TRY" }).fill("1.000,00");
  await pickOption(page, "Kategori", /Market/);
  await pickOption(page, "Ödeme Yöntemi", /Deneme Kart/);
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();

  // Fresh launch: the Mali Tablo tab must not have mounted its own stack.
  await page.goto("/helix/");
  await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();
  await page.getByRole("button", { name: /Deneme Kart/ }).locator("visible=true").first().click();
  await expect(page.getByText(/Deneme Kart · .* ekstresi/u)).toBeVisible();

  await page.getByRole("radio", { name: /Kısmi Ödeme/u }).click();
  await page.getByRole("textbox", { name: "Ödenen tutar", exact: true }).fill("400,00");
  const pay = page.getByRole("button", { name: "Ödemeyi Kaydet" });
  await expect(pay).toBeEnabled();
  await pay.click();
  await expect(page.getByText("Kısmen ödendi", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Geri", exact: true }).locator("visible=true").first().click();
  await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();
  // The row now owes what is left, and says what was paid.
  await expect(page.getByText(/400,00 ödendi/u).first()).toBeVisible();

  await page.getByRole("tab", { name: "Mali Tablo" }).click();
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();

  expect(errors).toEqual([]);
});

test("the subscription sheet of an exported workbook comes back through the import wizard", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await onboard(page);
  const row = {
    name: "E2E Müzik", amountMinor: 5999, currency: "TRY", amountMode: "fixed", cycle: "monthly", intervalMonths: 1,
    billingDay: 12, nextDueDate: `${currentMonthKey()}-12`, trialEndDate: "", category: "", source: "", person: "",
    autoPay: false, isActive: true, websiteDomain: "", monthlyLoadMinor: 5999,
  };
  const bytes = await composeWorkbook({ years: [], subscriptions: [row, { ...row, name: "E2E Başkası", person: "Tanımadığım Kişi" }], investments: [] });

  await page.goto("/helix/import-wizard");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Dosyayı Seç" }).click();
  await (await chooser).setFiles({ name: "helix.xlsx", mimeType: WORKBOOK_MIME, buffer: Buffer.from(bytes) });

  await expect(page.getByText("Abonelik: 1 yeni, 0 güncellenecek, 0 aynı", { exact: true })).toBeVisible();
  await expect(page.getByText("Abonelikler, 3. satır: Kişi okunamadı", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Abonelik ve Yatırımları Aktar" }).click();
  await expect(page.getByText("1 abonelik ve 0 yatırım işlemi eklendi ya da güncellendi.", { exact: true })).toBeVisible();
  // Nothing of the ledger was written, so its summary is not claimed.
  await expect(page.getByRole("heading", { name: "Abonelikler ve yatırımlar", exact: true })).toBeVisible();
  await expect(page.getByText(/kayıt geldi|Toplamlar tek tek ayrıldı/u)).toHaveCount(0);

  // The wizard is a page over the tabs; leaving it is what brings them back.
  await page.getByRole("button", { name: "Tamam", exact: true }).click();
  await page.getByRole("tab", { name: "Abonelikler" }).click();
  await expect(page.getByText("E2E Müzik", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("E2E Başkası", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
