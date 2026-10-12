// Drives the real DOM React Native Web produces: a vitest file that reads `src/ui/components.tsx`
// as text passes on a comment and never proves the attribute reached an element.
// Only static invariants (no truncation props, no font-scaling opt-out) stay there.
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  collectRuntimeErrors,
  isolateExternalData,
  onboard,
  openRouteForAudit,
  pickOption,
  routeRedirectProblem,
} from "./helpers";

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

test("canonical interactive primitives retain visible keyboard focus @cross-browser", async ({ page }) => {
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

  expect(errors).toEqual([]);
});

test("form fields expose a programmatic label and announce their errors @cross-browser", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await page.goto("/helix/transaction");
  await expect(page.getByRole("heading", { name: "Yeni İşlem" })).toBeVisible();

  // aria-labelledby must name an existing id with label text. Hydration can expose aria-label before
  // aria-labelledby, so wait on the contract itself.
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

  // An amount over the ceiling renders an assertive live region, announced without moving focus.
  await page.getByRole("textbox", { name: "Tutar · TRY" }).fill("9999999999999");
  const alert = page.locator('[role="alert"]').first();
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("aria-live", "assertive");

  expect(errors).toEqual([]);
});

test("busy controls, spinners and decorative art are correctly exposed", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);

  // Decorative art must be aria-hidden on the element or an ancestor (ARIA hides the subtree);
  // `expo-image` forwards only `alt`, `src` and `style`, so a wrapper is the only place it fits.
  await page.goto("/helix/settings");
  await expect(page.getByRole("heading", { name: "Ayarlar", exact: true })).toBeVisible();
  const decorative = await page.evaluate(() => {
    const hides = (el: HTMLElement) =>
      el.getAttribute("aria-hidden") === "true"
      || el.getAttribute("role") === "none"
      || el.getAttribute("role") === "presentation";
    const out: { tag: string; hidden: boolean; role: string | null; alt: string | null }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("img"))) {
      const alt = el.getAttribute("alt");
      if (alt !== "") continue; // only the deliberately decorative ones
      let node: HTMLElement | null = el;
      let hidden = false;
      while (node && !hidden) {
        hidden = hides(node);
        node = node.parentElement;
      }
      out.push({ tag: el.tagName, hidden, role: el.getAttribute("role"), alt });
    }
    return out;
  });
  for (const art of decorative) {
    expect(art.hidden, `decorative ${art.tag} (role=${art.role}) is exposed to the a11y tree`).toBe(true);
  }

  // Live regions must be polite or assertive.
  await page.goto("/helix/cash-flow");
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();
  const liveRegions = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[aria-live]")).map((el) => el.getAttribute("aria-live")));
  expect(liveRegions.every((v) => v === "polite" || v === "assertive"), `unexpected aria-live values: ${liveRegions}`).toBe(true);

  expect(errors).toEqual([]);
});

test("an open dialog is a real modal that owns focus @cross-browser", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await page.goto("/helix/settings");

  // The export failure path opens the shared dialog host.
  await page.evaluate(() => {
    URL.createObjectURL = () => {
      throw new Error("E2E dialog semantics");
    };
  });
  await page.getByRole("button", { name: /Yedek Oluştur/ }).click();
  // A platform exception's text is developer material and must not reach the screen.
  await expect(page.getByText(/İşlem tamamlanamadı/)).toBeVisible();
  await expect(page.getByText(/E2E dialog semantics/)).toHaveCount(0);

  // Wait for the heading itself: browser autofocus inside the modal can be sampled, then stolen by a delayed heading focus.
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

  // The heading is focusable but not a Tab stop; Tab enters the action row and cycles inside the modal.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Tamam", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => {
    const el = document.querySelector('[aria-modal="true"]');
    return el != null && el.contains(document.activeElement);
  })).toBe(true);

  await page.getByRole("button", { name: "Tamam", exact: true }).click();
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("a dirty-exit dialog isolates the form's Enter shortcut", async ({ page }) => {
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

  // Enter belongs to the overlay: it must not reach the form's window-level submit and orphan the dialog.
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/helix\/transaction$/);
  await expect(dialogTitle).toBeVisible();

  // Shift+Tab from the heading wraps to the final dialog action.
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Değişiklikleri sil", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(dialogTitle).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Tutar · TRY" })).toHaveValue("125,00");

  expect(errors).toEqual([]);
});

test("dirty drafts guard browser unload and same-screen context changes", async ({ page }) => {
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

  // Bulk entry has one way out, the back control (a duplicate "Tamam" was removed).
  await page.goto("/helix/bulk-entry");
  const bulkAmount = page.getByRole("textbox").first();
  await bulkAmount.fill("750");
  const back = page.getByRole("button", { name: "Geri", exact: true });
  await back.click();
  await expect(dialogTitle).toBeVisible();
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(page).toHaveURL(/\/helix\/bulk-entry$/);
  await expect(bulkAmount).toHaveValue("750");
  // A cleared field is no longer a discard: the guard must not ask, and must never trap.
  await bulkAmount.fill("");
  await back.click();
  await expect(dialogTitle).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/helix\/bulk-entry$/);

  await page.goto("/helix/settings/categories");
  const newCategory = page.getByRole("textbox", { name: "Kategori adı" });
  await newCategory.fill("Yeni taslak");
  await page.getByRole("button", { name: "Düzenle · Market", exact: true }).click();
  await expect(dialogTitle).toHaveCount(0);
  await expect(newCategory).toHaveValue("Yeni taslak");
  await expect(page.getByRole("textbox", { name: "Düzenle · Market" })).toBeVisible();

  expect(errors).toEqual([]);
});

test("Enter belongs to the focused control, not the form's primary save", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await page.goto("/helix/transaction");
  await expect(page.getByRole("heading", { name: "Yeni İşlem" })).toBeVisible();

  const amount = page.getByRole("textbox", { name: "Tutar · TRY" });
  await amount.fill("250,00");
  await pickOption(page, "Kategori", /Market/);

  // 1 · The secondary action: Enter must not also run the primary Save and close the screen.
  await page.getByRole("button", { name: "Kaydet ve Yeni Ekle", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/helix\/transaction$/);
  const notice = page.getByText("İşlem kaydedildi.");
  await expect(notice).toBeVisible();
  await expect(amount).toHaveValue("");
  // A cleared field alone reads as discarded input: the confirmation must be announced.
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

  expect(errors).toEqual([]);
});

// A test that tabs to the region and presses End passes with the app's fix removed, because Chromium and
// Firefox make a text-only scroller focusable themselves; `visual-a11y.spec.ts` (axe
// `scrollable-region-focusable`) fails when the affordance is borrowed. This states the other half:
// the notice is reachable and readable in the browsers the suite drives.
test("the legal notice can be read to the end with a keyboard @cross-browser", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await page.goto("/helix/privacy");
  await expect(page.getByRole("heading", { name: "Aydınlatma Metni" })).toBeVisible();

  const geometry = await page.evaluate(() => {
    const region = [...document.querySelectorAll<HTMLElement>("div")].find(
      (element) => element.scrollHeight > element.clientHeight + 50
        && ["auto", "scroll"].includes(getComputedStyle(element).overflowY),
    );
    (window as unknown as { __region?: HTMLElement }).__region = region;
    return region
      ? { visible: region.clientHeight, total: region.scrollHeight, tabIndex: region.getAttribute("tabindex") }
      : null;
  });
  // A floor: without overflow everything below passes while proving nothing about a keyboard.
  expect(geometry, "the notice must have a scroll region to test").not.toBeNull();
  expect(geometry!.total, "the notice must be taller than one screen").toBeGreaterThan(geometry!.visible * 2);
  expect(geometry!.tabIndex, "the notice's scroll region must carry its own tab stop").toBe("0");

  let focused = false;
  for (let step = 0; step < 8 && !focused; step += 1) {
    focused = await page.evaluate(() =>
      document.activeElement === (window as unknown as { __region?: HTMLElement }).__region);
    if (!focused) await page.keyboard.press("Tab");
  }
  expect(focused, "Tab never reaches the notice's scroll region").toBe(true);

  const scrollTop = () => page.evaluate(() => (window as unknown as { __region: HTMLElement }).__region.scrollTop);
  await page.keyboard.press("End");
  await expect
    .poll(scrollTop, { message: "End must reach the end of the notice" })
    .toBeGreaterThan(geometry!.total - geometry!.visible - 50);

  await page.keyboard.press("Home");
  await expect.poll(scrollTop, { message: "Home must return to the top" }).toBe(0);
  await page.keyboard.press("PageDown");
  await expect.poll(scrollTop, { message: "PageDown must advance the notice" }).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

// A focusable scroll region is a tab stop; these four have focusable content of their own and must gain none.
test("screens with their own controls gain no extra tab stop", async ({ page }) => {
  // A zero count is also what a BROKEN screen produces (`ErrorBoundary` swallows the throw and its `devError`
  // is silent in the production export), so each route asserts a heading of its own. The dashboard uses a
  // section heading because its greeting is read off the clock.
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  for (const [route, heading] of [
    ["/helix/", "Bu Ay"],
    ["/helix/settings", "Ayarlar"],
    ["/helix/transaction", "Yeni İşlem"],
    ["/helix/feedback", "Geri bildirim"],
  ] as const) {
    await openRouteForAudit(page, route);
    await expect(page.getByRole("heading", { name: heading, exact: true }).first(), route).toBeVisible();
    await expect(page.locator("[data-helix-scroll-focus]"), route).toHaveCount(0);
    expect(routeRedirectProblem(page, route), route).toBeNull();
  }
  expect(errors).toEqual([]);
});
