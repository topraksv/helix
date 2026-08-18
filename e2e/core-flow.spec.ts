import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  addMarketExpense,
  assertNoRuntimeErrors,
  collectRuntimeErrors,
  currentMonthKey,
  isolateExternalData,
  onboard,
  pickOption,
  renderedContrastRatio,
} from "./helpers";

test.beforeEach(async ({ context }) => isolateExternalData(context));

test("onboarding → add → edit → delete/undo → backup protects the core ledger flow @smoke @cross-browser", async ({ page }, testInfo) => {
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
  // The snackbar inverts the page, so its label needs an inverted ink. Role
  // queries match the accessible name and stayed green while the label was
  // rendering at 1.27:1 — measure what the browser actually painted.
  expect(await renderedContrastRatio(undo.getByText("Geri Al"))).toBeGreaterThanOrEqual(4.5);
  await undo.click();
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

  // A failing backup used to reject into a bare `void export()` and show the
  // user nothing at all, which is indistinguishable from one still running.
  // It must still report the failure — but in the app's own words: the
  // exception here stands in for a storage, permission or share-sheet error
  // whose text was written for a developer, not for the person exporting.
  await page.evaluate(() => {
    URL.createObjectURL = () => {
      throw new Error("E2E dışa aktarma hatası");
    };
  });
  await page.getByRole("button", { name: /Yedek Oluştur/ }).click();
  await expect(page.getByText(/İşlem tamamlanamadı/)).toBeVisible();
  await expect(page.getByText(/E2E dışa aktarma hatası/)).toHaveCount(0);
  await page.getByRole("button", { name: "Tamam", exact: true }).click();

  await assertNoRuntimeErrors(errors, testInfo);
});

test("a clean browser restores a backup and a relationally invalid file writes nothing @smoke @cross-browser", async ({ browser, page }, testInfo) => {
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
  // The rejected file must have written nothing, so this browser still has no
  // workspace — /transaction is guarded and lands back on setup.
  //
  // This replaces an assertion that could not fail: it asked whether a
  // "POISON_CATEGORY" radio existed on /transaction, and /transaction had
  // always redirected here, so the count was zero no matter what the import
  // did. Assert the redirect and the absence of the name anywhere instead.
  await invalidPage.goto("/helix/transaction");
  await expect(invalidPage).toHaveURL(/\/helix\/setup$/);
  await expect(invalidPage.getByText("POISON_CATEGORY")).toHaveCount(0);
  await invalidContext.close();

  await assertNoRuntimeErrors(errors, testInfo);
});

/**
 * `price_history` was written on every price edit and read by nothing, so a
 * subscription's cost over time was recorded and invisible. This walks the
 * whole loop the summary depends on: create a rule, raise its price, and read
 * the stored change back on the screen.
 */
test("the subscription cost summary reports the price history it stores", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 430, height: 932 });
  await onboard(page);

  await page.getByRole("tab", { name: "Abonelikler" }).click();
  await page.getByRole("button", { name: "Abonelik Ekle", exact: true }).click();
  await expect(page).toHaveURL(/subscription-form/);
  await page.getByRole("textbox", { name: "Ad", exact: true }).fill("Netflix");
  await page.getByRole("textbox", { name: "Tutar · TRY", exact: true }).fill("229,99");
  await page.getByRole("textbox", { name: "Ödeme günü", exact: true }).fill("5");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  const categoryOffer = page.getByRole("button", { name: "Oluştur ve Kaydet", exact: true });
  if (await categoryOffer.count()) await categoryOffer.click();
  await expect(page).toHaveURL(/subscriptions/);

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

  await assertNoRuntimeErrors(errors, testInfo);
});

/**
 * A save says what it DID, without taking the screen over.
 *
 * "Kaydedildi" left two questions the owner had to answer by going and
 * looking: what changed, and what it did to the balance. The confirmation
 * answers both in the bar that already reports outcomes — and must remain a
 * bar: no dialog, no route remount, no reload behind it.
 */
test("saving reports its balance effect without refreshing the screen", async ({ page }, testInfo) => {
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
  // The derived effect, stated in money rather than left to be discovered.
  await expect(bar).toContainText(/Güncel bakiyen .*250,00 değişti\./u);
  // Both immediate actions are offered.
  await expect(bar.getByRole("button", { name: "Düzenle", exact: true })).toBeVisible();

  // Non-blocking: the dashboard behind it is interactive and already updated.
  await expect(page.getByTestId("dashboard-current-balance")).toContainText("250,00");
  expect(await page.locator("#remount-probe").count(), "the route must not remount").toBe(1);

  // The edit action opens that exact row rather than a blank form.
  await bar.getByRole("button", { name: "Düzenle", exact: true }).click();
  await expect(page).toHaveURL(/\/transaction\?id=/u);

  await assertNoRuntimeErrors(errors, testInfo);
});

/**
 * Provenance, duplicate review and expected-to-actual matching.
 *
 * Together these answer "where did this row come from" and "is this the same
 * money twice". Both answers exist so a person can act on them, so both are
 * checked as rendered text, and the duplicate review is checked for what it
 * does NOT do: it never resolves anything by itself.
 */
test("a ledger row carries its origin, and repeats are offered for review not merged", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await onboard(page);

  // The same amount and category twice on one day: a suspicion, not a fact.
  for (const _ of [0, 1]) {
    await page.getByRole("button", { name: /İşlem Ekle/u }).first().click();
    await page.getByRole("textbox", { name: "Tutar · TRY", exact: true }).fill("120");
    await pickOption(page, "Kategori", "Market");
    await page.getByRole("button", { name: "Kaydet", exact: true }).click();
    await expect(page.getByTestId("dashboard-current-balance")).toBeVisible();
  }

  await page.goto("/helix/reconciliation");
  const review = page.getByText("Olası tekrar kayıtlar", { exact: true });
  await expect(review).toBeVisible();
  // The reason is stated, so the owner can disagree with something specific.
  await expect(page.getByText("Tutar ve kalem aynı, tarihler yakın", { exact: true })).toBeVisible();
  // A hand-entered row says so.
  await expect(page.getByText(/aynı gün · Elle girildi/u)).toBeVisible();
  // Nothing was merged or deleted, and the panel says so.
  await expect(page.getByText(/Helix hiçbirini kendiliğinden silmez/u)).toBeVisible();

  // Opening the flagged row says nothing about its origin, because there is
  // nothing to say: a hand-entered row is the ordinary case, and labelling it
  // would bury the two origins that actually matter.
  await page.getByRole("button", { name: "İşlemi Aç", exact: true }).first().click();
  await expect(page).toHaveURL(/\/transaction\?id=/u);
  await expect(page.getByTestId("transaction-provenance")).toHaveCount(0);

  await assertNoRuntimeErrors(errors, testInfo);
});

/**
 * The attention inbox.
 *
 * It is derived, so the test creates a real obligation and then checks the
 * three things that make an inbox trustworthy: it groups by the decision to be
 * made, it says what is new in words, and a deferral or a dismissal actually
 * takes the row away — with the deferral still being undoable, because a defer
 * is not a decision.
 */
test("the attention inbox groups what is waiting and lets it be deferred or finished", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await onboard(page);

  // A subscription billed today produces one pending obligation.
  await page.getByRole("tab", { name: "Abonelikler" }).click();
  await page.getByRole("button", { name: "Abonelik Ekle", exact: true }).click();
  await page.getByRole("textbox", { name: "Ad", exact: true }).fill("Netflix");
  await page.getByRole("textbox", { name: "Tutar · TRY", exact: true }).fill("229,99");
  await page.getByRole("textbox", { name: "Ödeme günü", exact: true }).fill(String(new Date().getDate()));
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  const categoryOffer = page.getByRole("button", { name: "Oluştur ve Kaydet", exact: true });
  if (await categoryOffer.count()) await categoryOffer.click();
  await expect(page).toHaveURL(/subscriptions/u);

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

  await assertNoRuntimeErrors(errors, testInfo);
});

/**
 * Importing a card statement PDF.
 *
 * The fixture is generated in-process and never written to the repository: a
 * real statement is the most sensitive document the owner has. What this
 * proves is the part a unit test cannot — that the file is read locally, that
 * NOTHING reaches the ledger until a person presses the button, and that a
 * file the parser cannot read is refused with a reason rather than guessed at.
 */
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

async function choosePdf(page: import("@playwright/test").Page, name: string, buffer: Buffer): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("statement-pick").click();
  await (await chooser).setFiles({ name, mimeType: "application/pdf", buffer });
}

test("a card statement is read locally, reviewed, and only then written", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await onboard(page);
  await page.goto("/helix/statement-import");

  // The promise the screen makes before anything is picked.
  await expect(page.getByText(/hiçbir yere yüklenmez/u)).toBeVisible();

  await choosePdf(page, "ekstre.pdf", syntheticStatementPdf([
    "HESAP OZETI",
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
  // Nothing is in the ledger yet.
  await expect(page.getByTestId("statement-commit")).toBeVisible();

  await page.getByTestId("statement-clear-selection").click();
  await expect(page.getByTestId("statement-commit")).toBeDisabled();
  await page.getByTestId("statement-select-new").click();
  await page.getByTestId("statement-commit").click();

  // Written, and reported as written.
  await expect(page.getByRole("alert").first()).toContainText("2 işlem aktarıldı.");

  // Importing the same statement again recognises every row it already wrote,
  // which is what the stored identity is FOR: re-downloading a statement and
  // importing it a second time must not double the ledger.
  await page.goto("/helix/statement-import");
  await choosePdf(page, "ekstre.pdf", syntheticStatementPdf([
    "12.08.2026 MIGROS MARKET 1.234,56",
    "03.08.2026 TEKNOSA 3/9 500,00",
  ]));
  await expect(page.getByText("Bu satır zaten aktarılmış").first()).toBeVisible();
  // And nothing is pre-selected, so accepting the defaults writes nothing.
  await expect(page.getByTestId("statement-commit")).toBeDisabled();

  await assertNoRuntimeErrors(errors, testInfo);
});

test("an unreadable statement is refused with a reason instead of guessed at", async ({ page }, testInfo) => {
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

  await assertNoRuntimeErrors(errors, testInfo);
});

/**
 * Attaching a document, on the platform the owner is actually using.
 *
 * The bytes stay on this device either way — the app sandbox on a phone, the
 * browser's own private storage here — and the row that describes them is the
 * only part that syncs. What this proves is that the web is a first-class
 * place to do it, not a read-only view of what a phone did.
 */
test("a receipt can be attached, opened and removed on the web", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await onboard(page);

  await page.getByRole("button", { name: /İşlem Ekle/u }).first().click();
  await page.getByRole("textbox", { name: "Tutar · TRY", exact: true }).fill("120");
  await pickOption(page, "Kategori", "Market");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await page.getByRole("alert").first().getByRole("button", { name: "Düzenle", exact: true }).click();
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
  // Held on this device, so it offers to open it rather than explaining why it cannot.
  await expect(panel.getByRole("button", { name: "Aç", exact: true })).toBeVisible();
  await expect(page.getByTestId("attachment-empty")).toHaveCount(0);

  // Removing is undoable, because a receipt is not recoverable once gone.
  await panel.getByRole("button", { name: "Sil", exact: true }).click();
  await expect(page.getByTestId("attachment-empty")).toBeVisible();
  await page.getByRole("alert").first().getByRole("button", { name: "Geri Al", exact: true }).click();
  await expect(panel).toContainText("fatura.pdf");

  await assertNoRuntimeErrors(errors, testInfo);
});
