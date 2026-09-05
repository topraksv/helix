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

test("canonical interactive primitives retain visible keyboard focus @cross-browser", async ({ page }, testInfo) => {
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

test("form fields expose a programmatic label and announce their errors @cross-browser", async ({ page }, testInfo) => {
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
  //
  // The hiding is checked on the element OR any ancestor, which is what ARIA
  // actually specifies — `aria-hidden` removes a whole subtree. It also has to
  // be checked that way here: `expo-image` renders its own web `<img>` and
  // forwards only `alt`, `src` and `style`, so an image component physically
  // cannot carry the attribute itself and a wrapper is the only place it fits.
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

  // A loading data screen exposes a polite live region and a NAMED spinner:
  // an unnamed ActivityIndicator is an anonymous "busy" node to a screen reader.
  await page.goto("/helix/cash-flow");
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();
  const liveRegions = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[aria-live]")).map((el) => el.getAttribute("aria-live")));
  expect(liveRegions.every((v) => v === "polite" || v === "assertive"), `unexpected aria-live values: ${liveRegions}`).toBe(true);

  await assertNoRuntimeErrors(errors, testInfo);
});

test("an open dialog is a real modal that owns focus @smoke @cross-browser", async ({ page }, testInfo) => {
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

  // Bulk entry has one way out — the back control. It used to carry a "Tamam"
  // button beside it that did exactly the same thing, which is one more way to
  // leave than there are ways to leave.
  await page.goto("/helix/bulk-entry");
  const bulkAmount = page.getByRole("textbox").first();
  await bulkAmount.fill("750");
  const back = page.getByRole("button", { name: "Geri", exact: true });
  await back.click();
  await expect(dialogTitle).toBeVisible();
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(page).toHaveURL(/\/helix\/bulk-entry$/);
  await expect(bulkAmount).toHaveValue("750");
  // Clearing the field puts the form back where it started, so leaving is no
  // longer a discard at all — the guard must not ask, and must never trap.
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

/**
 * A screen that is only text states its own keyboard affordance.
 *
 * The honest version of this test, after the first one was written against a
 * measurement that did not hold. `/helix/privacy` holds 3594px of KVKK text
 * with nothing focusable in it, and current Chromium and Firefox make such a
 * container focusable by themselves — so a test that tabs to the region and
 * presses End passes with this app's fix removed, which makes it worth
 * nothing. It was written, it passed against a build with the fix reverted,
 * and it is not in this file for that reason.
 *
 * What the app actually decides is whether the affordance is its own or
 * borrowed. `visual-a11y.spec.ts` is what fails when it is borrowed: axe's
 * `scrollable-region-focusable` fires on this route, and that route is in the
 * sweep now. This test states the other half — that the notice is reachable
 * and readable in the browsers the suite drives — so a regression that breaks
 * the reading rather than the attribute is still caught.
 */
test("the legal notice can be read to the end with a keyboard @cross-browser", async ({ page }, testInfo) => {
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
  // A floor: if the notice ever stopped overflowing, everything below would
  // pass while proving nothing about a keyboard.
  expect(geometry, "the notice must have a scroll region to test").not.toBeNull();
  expect(geometry!.total, "the notice must be taller than one screen").toBeGreaterThan(geometry!.visible * 2);
  // The app's own affordance, not the engine's. This is the assertion that
  // fails when the conditional tab stop is removed.
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

  await assertNoRuntimeErrors(errors, testInfo);
});

/**
 * And the stop is only where it is needed.
 *
 * A focusable scroll region is a tab stop, so handing one to every screen
 * would put an unexplained stop in front of every form. These four all have
 * focusable content of their own and must therefore have gained nothing.
 */
test("screens with their own controls gain no extra tab stop", async ({ page }) => {
  await onboard(page);
  for (const route of ["/helix/", "/helix/settings", "/helix/transaction", "/helix/feedback"]) {
    await page.goto(route);
    await expect(page.locator("#root")).toBeVisible();
    await expect(page.locator("[data-helix-scroll-focus]"), route).toHaveCount(0);
  }
});
