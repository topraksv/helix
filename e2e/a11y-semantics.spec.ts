/**
 * Rendered accessibility semantics.
 *
 * These properties used to be "verified" by `tests/accessibility-contract.test.ts`,
 * which read `src/ui/components.tsx` as TEXT and asserted `toContain(...)` on the
 * prop names. That passes when the string sits in a comment and fails when a prop
 * is renamed, and it never proves the attribute reached an element — the whole
 * point of an accessibility contract. Each assertion below drives the real DOM
 * that React Native Web produces, so a prop that is applied to the wrong node,
 * dropped by a refactor, or shadowed by a spread is caught.
 *
 * Only genuinely STATIC invariants (no truncation props, no font-scaling opt-out)
 * stay in the vitest file, where they belong.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { assertNoRuntimeErrors, collectRuntimeErrors, isolateExternalData, onboard, pickOption } from "./helpers";

test.beforeEach(async ({ context }) => isolateExternalData(context));

async function expectKeyboardFocusVisible(page: Page, target: Locator): Promise<void> {
  await target.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
  const focus = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      visible: element.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focus.visible, "keyboard focus must match :focus-visible").toBe(true);
  expect(focus.outlineStyle, "keyboard focus must not suppress its outline").not.toBe("none");
  expect(focus.outlineWidth, "keyboard focus outline must have measurable width").toBeGreaterThan(0);
}

test("canonical interactive primitives retain visible keyboard focus", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);

  await expectKeyboardFocusVisible(page, page.getByRole("button", { name: /İşlem Ekle/ }).first());

  await page.goto("/helix/transaction");
  await expect(page.getByRole("heading", { name: "Yeni İşlem" })).toBeVisible();
  await expectKeyboardFocusVisible(page, page.getByRole("textbox", { name: "Tutar · TRY" }));
  await expectKeyboardFocusVisible(page, page.getByRole("radio", { name: "Gider", exact: true }));
  const amountOptions = page.getByRole("button", { name: "Gider iadesi veya döviz · TRY", exact: true });
  await expect(amountOptions).toHaveAttribute("aria-expanded", "false");
  await expectKeyboardFocusVisible(page, amountOptions);
  await page.keyboard.press("Enter");
  const refund = page.getByRole("switch", { name: "Gider iadesi" });
  await expect(refund).toBeVisible();
  await expectKeyboardFocusVisible(page, refund);
  await page.getByRole("radio", { name: "Yatırım", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Gider iadesi" })).toHaveCount(0);

  await assertNoRuntimeErrors(errors, testInfo);
});

test("form fields expose a programmatic label and announce their errors", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await page.goto("/helix/transaction");
  await expect(page.getByRole("heading", { name: "Yeni İşlem" })).toBeVisible();

  // `accessibilityLabelledBy` → aria-labelledby, and the id it names must exist
  // and carry the visible label text. Hydration can expose the labelled input's
  // aria-label a few milliseconds before aria-labelledby, so wait on the exact
  // contract this probe measures instead of sampling that transition.
  const labelledFields = page.locator("input[aria-labelledby], textarea[aria-labelledby]");
  await expect(labelledFields.first()).toBeVisible();
  const labelled = await labelledFields.evaluateAll((fields) =>
    fields.map((el) => {
      const id = el.getAttribute("aria-labelledby")!;
      const target = document.getElementById(id);
      return { id, resolved: target != null, text: (target?.textContent ?? "").trim() };
    }));
  expect(labelled.length, "no aria-labelledby field rendered — the probe is dead").toBeGreaterThan(0);
  for (const field of labelled) {
    expect(field.resolved, `aria-labelledby="${field.id}" points at nothing`).toBe(true);
    expect(field.text.length, `label ${field.id} is empty`).toBeGreaterThan(0);
  }

  // Amount over the ceiling renders the inline error, which must be an assertive
  // live region so a screen reader announces it without moving focus.
  await page.getByRole("textbox", { name: "Tutar · TRY" }).fill("9999999999999");
  const alert = page.locator('[role="alert"]').first();
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("aria-live", "assertive");

  await assertNoRuntimeErrors(errors, testInfo);
});

test("busy controls, spinners and decorative art are correctly exposed", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);

  // Decorative brand art must be OUT of the accessibility tree: an empty
  // accessible name on a visible img is an axe violation, so the element has to
  // be hidden rather than merely unlabelled.
  await page.goto("/helix/settings");
  await expect(page.getByRole("heading", { name: "Ayarlar", exact: true })).toBeVisible();
  const decorative = await page.evaluate(() => {
    const out: { tag: string; hidden: boolean; role: string | null; alt: string | null }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("img"))) {
      const alt = el.getAttribute("alt");
      if (alt !== "") continue; // only the deliberately decorative ones
      out.push({
        tag: el.tagName,
        hidden: el.getAttribute("aria-hidden") === "true" || el.getAttribute("role") === "none" || el.getAttribute("role") === "presentation",
        role: el.getAttribute("role"),
        alt,
      });
    }
    return out;
  });
  for (const art of decorative) {
    expect(art.hidden, `decorative ${art.tag} (role=${art.role}) is exposed to the a11y tree`).toBe(true);
  }

  // A loading data screen exposes a polite live region and a NAMED spinner:
  // an unnamed ActivityIndicator is an anonymous "busy" node to a screen reader.
  await page.goto("/helix/cash-flow");
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();
  const liveRegions = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[aria-live]")).map((el) => el.getAttribute("aria-live")));
  expect(liveRegions.every((v) => v === "polite" || v === "assertive"), `unexpected aria-live values: ${liveRegions}`).toBe(true);

  await assertNoRuntimeErrors(errors, testInfo);
});

test("an open dialog is a real modal that owns focus @smoke", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await page.goto("/helix/settings");

  // Force the export failure path, which opens the shared dialog host.
  await page.evaluate(() => {
    URL.createObjectURL = () => {
      throw new Error("E2E dialog semantics");
    };
  });
  await page.getByRole("button", { name: /Yedek Oluştur/ }).click();
  // The dialog reports the outcome in the user's own language. A platform
  // exception's text is developer material and must never reach the screen —
  // this assertion is what previously proved the opposite.
  await expect(page.getByText(/İşlem tamamlanamadı/)).toBeVisible();
  await expect(page.getByText(/E2E dialog semantics/)).toHaveCount(0);

  // Wait for the shared modal owner to focus the heading itself. Merely
  // observing focus somewhere inside the modal can sample the browser's
  // temporary autofocus and let a delayed heading focus steal the next Tab.
  await expect
    .poll(() => page.evaluate(() => {
      const el = document.querySelector('[aria-modal="true"]');
      const heading = el?.querySelector('[role="heading"], h1, h2, h3');
      return heading != null && document.activeElement === heading;
    }), { timeout: 5_000 })
    .toBe(true);

  const modal = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[aria-modal="true"]');
    if (!el) return null;
    const heading = el.querySelector<HTMLElement>('[role="heading"], h1, h2, h3');
    return {
      present: true,
      headingText: (heading?.textContent ?? "").trim(),
      focusInside: el.contains(document.activeElement),
    };
  });
  expect(modal, "no aria-modal element while a dialog is open").not.toBeNull();
  expect(modal!.headingText.length, "modal has no heading to focus").toBeGreaterThan(0);
  expect(modal!.focusInside, "focus is outside the open modal").toBe(true);

  // The heading is intentionally programmatically focusable but not a Tab
  // stop. Tab enters the action row, then cycles inside the modal instead of
  // exposing the Settings controls behind the scrim.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Tamam", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => {
    const el = document.querySelector('[aria-modal="true"]');
    return el != null && el.contains(document.activeElement);
  })).toBe(true);

  await page.getByRole("button", { name: "Tamam", exact: true }).click();
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);

  await assertNoRuntimeErrors(errors, testInfo);
});

test("a dirty-exit dialog isolates the form's Enter shortcut", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await page.goto("/helix/transaction");
  await expect(page.getByRole("heading", { name: "Yeni İşlem" })).toBeVisible();
  await page.getByRole("textbox", { name: "Tutar · TRY" }).fill("125,00");
  await pickOption(page, "Kategori", /Market/);

  await page.getByRole("button", { name: "Geri", exact: true }).click();
  const dialogTitle = page.getByRole("heading", { name: "Kaydedilmemiş değişiklikler var" });
  await expect(dialogTitle).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    (document.activeElement?.textContent ?? "").trim(),
  )).toBe("Kaydedilmemiş değişiklikler var");

  // Enter belongs to the visible overlay. It must not reach the valid form's
  // window-level submit shortcut, save a transaction, change route, and leave
  // the discard dialog orphaned over the next screen.
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/helix\/transaction$/);
  await expect(dialogTitle).toBeVisible();

  // Shift+Tab from the heading wraps to the final dialog action, never to the
  // header/back button or a field behind the scrim.
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Değişiklikleri sil", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(dialogTitle).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Tutar · TRY" })).toHaveValue("125,00");

  await assertNoRuntimeErrors(errors, testInfo);
});

test("dirty drafts guard browser unload and same-screen context changes", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);

  await page.goto("/helix/transaction");
  await page.getByRole("textbox", { name: "Tutar · TRY" }).fill("125,00");
  const blockedUnload = await page.evaluate(() => {
    const event = new Event("beforeunload", { bubbles: false, cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(blockedUnload, "a dirty web form must warn before reload or tab close").toBe(true);

  await page.goto("/helix/settings/budgets");
  const amount = page.getByRole("textbox", { name: "Aylık limit" });
  await amount.fill("2.500");
  const monthHeading = page.getByRole("heading").filter({ hasText: /\b20\d{2}\b/ });
  const monthBefore = await monthHeading.textContent();
  await page.getByRole("button", { name: "Sonraki" }).click();
  const dialogTitle = page.getByRole("heading", { name: "Kaydedilmemiş değişiklikler var" });
  await expect(dialogTitle).toBeVisible();
  await expect(amount).toHaveValue("2.500");
  await expect(monthHeading).toHaveText(monthBefore ?? "");

  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(dialogTitle).toHaveCount(0);
  await expect(amount).toHaveValue("2.500");

  await page.getByRole("button", { name: "Sonraki" }).click();
  await expect(dialogTitle).toBeVisible();
  await page.getByRole("button", { name: "Değişiklikleri sil", exact: true }).click();
  await expect(dialogTitle).toHaveCount(0);
  await expect(amount).toHaveValue("");
  await expect(monthHeading).not.toHaveText(monthBefore ?? "");

  await page.goto("/helix/bulk-entry");
  const bulkAmount = page.getByRole("textbox").first();
  await bulkAmount.fill("750");
  await page.getByRole("button", { name: "Tamam", exact: true }).click();
  await expect(dialogTitle).toBeVisible();
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(page).toHaveURL(/\/helix\/bulk-entry$/);
  await expect(bulkAmount).toHaveValue("750");
  await page.getByRole("button", { name: "Tamam", exact: true }).click();
  await page.getByRole("button", { name: "Değişiklikleri sil", exact: true }).click();

  await page.goto("/helix/settings/categories");
  const newCategory = page.getByRole("textbox", { name: "Kategori Ekle" });
  await newCategory.fill("Yeni taslak");
  await page.getByRole("button", { name: "Düzenle · Market", exact: true }).click();
  await expect(dialogTitle).toHaveCount(0);
  await expect(newCategory).toHaveValue("Yeni taslak");
  await expect(page.getByRole("textbox", { name: "Düzenle · Market" })).toBeVisible();

  await assertNoRuntimeErrors(errors, testInfo);
});

test("Enter belongs to the focused control, not the form's primary save", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await page.goto("/helix/transaction");
  await expect(page.getByRole("heading", { name: "Yeni İşlem" })).toBeVisible();

  const amount = page.getByRole("textbox", { name: "Tutar · TRY" });
  await amount.fill("250,00");
  await pickOption(page, "Kategori", /Market/);

  // 1 · The secondary action. Enter used to run the primary Save from here, so
  // the entry was written AND the screen closed — the opposite of what the
  // focused "save and add another" button promises.
  await page.getByRole("button", { name: "Kaydet ve Yeni Ekle", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/helix\/transaction$/);
  const notice = page.getByText("İşlem kaydedildi.");
  await expect(notice).toBeVisible();
  await expect(amount).toHaveValue("");
  // A cleared field alone reads as "my input was discarded", and a screen
  // reader sees nothing at all — the confirmation has to be announced.
  await expect(
    notice.locator("xpath=ancestor-or-self::*[@aria-live][1]"),
  ).toHaveAttribute("aria-live", "polite");

  // 2 · A switch flips instead of committing the entry.
  await amount.fill("120,00");
  await page.getByRole("button", { name: "Gider iadesi veya döviz · TRY", exact: true }).click();
  const refund = page.getByRole("switch", { name: "Gider iadesi" }).first();
  const before = await refund.getAttribute("aria-checked");
  await refund.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/helix\/transaction$/);
  await expect(refund).not.toHaveAttribute("aria-checked", before ?? "false");

  // 3 · A chip selects instead of saving whatever was selected before it.
  const income = page.getByRole("radio", { name: "Gelir", exact: true });
  await income.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/helix\/transaction$/);
  await expect(income).toHaveAttribute("aria-checked", "true");

  // 4 · The documented shortcut still works from a single-line field.
  await page.getByRole("radio", { name: "Gider", exact: true }).click();
  await pickOption(page, "Kategori", /Market/);
  await amount.fill("99,00");
  await amount.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/helix\/cash-flow$/);

  await assertNoRuntimeErrors(errors, testInfo);
});
