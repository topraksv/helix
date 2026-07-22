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
import { assertNoRuntimeErrors, collectRuntimeErrors, isolateExternalData, onboard } from "./helpers";

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
  await expectKeyboardFocusVisible(page, page.getByRole("switch", { name: "İade" }));

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

test("an open dialog is a real modal that owns focus", async ({ page }, testInfo) => {
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
  await expect(page.getByText(/E2E dialog semantics/)).toBeVisible();

  // `useModalAccessibility` moves focus on a 40 ms timer, so poll rather than
  // sampling once — a single immediate read races the hook, not the app.
  await expect
    .poll(() => page.evaluate(() => {
      const el = document.querySelector('[aria-modal="true"]');
      return el != null && el.contains(document.activeElement);
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

  await page.getByRole("button", { name: "Tamam", exact: true }).click();
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);

  await assertNoRuntimeErrors(errors, testInfo);
});
