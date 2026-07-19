import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  addMarketExpense,
  assertNoRuntimeErrors,
  collectRuntimeErrors,
  isolateExternalData,
  onboard,
} from "./helpers";

// The committed baselines are rendered on macOS. Chromium on Ubuntu lays out
// the same font files identically but rasterizes glyph edges differently; the
// CI failure artifact proved the remaining 2–3% diff was confined to text
// antialiasing. Keep the local budget strict and cap Linux at 4%, while the
// semantic assertions below continue to guard exact labels and structure.
const maxVisualDiffPixelRatio = process.platform === "linux" ? 0.04 : 0.01;

test.beforeEach(async ({ context }) => isolateExternalData(context));

test("main routes have no WCAG A/AA violations", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  const routes = ["/helix/", "/helix/cash-flow", "/helix/subscriptions", "/helix/calculator", "/helix/settings", "/helix/transaction"];
  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator("#root")).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(result.violations, `${route}\n${JSON.stringify(result.violations, null, 2)}`).toEqual([]);
  }
  await assertNoRuntimeErrors(errors, testInfo);
});

/**
 * The 6-route check above runs on a freshly onboarded, near-empty workspace.
 * Every violation this audit found lived outside that set or only appeared once
 * the workspace had data: `aria-prohibited-attr` on populated matrix cells,
 * `aria-required-attr` on the reorder grips, `color-contrast` under a faded
 * section, and a scroll region no keyboard could reach. This sweep therefore
 * walks EVERY reachable route with real data, and also asserts the WCAG 2.2
 * target size that axe's 2.1 ruleset does not cover.
 */
const ALL_ROUTES = [
  "/helix/", "/helix/cash-flow", "/helix/cash-flow/analytics", "/helix/cash-flow/installments",
  "/helix/subscriptions", "/helix/calculator", "/helix/settings", "/helix/settings/categories",
  "/helix/settings/computed-columns", "/helix/settings/payment-sources", "/helix/settings/persons",
  "/helix/settings/incomes", "/helix/settings/budgets", "/helix/settings/opening-balance",
  "/helix/transaction", "/helix/installment-new", "/helix/subscription-form", "/helix/bulk-entry",
  "/helix/cell-editor", "/helix/columns-editor", "/helix/import-wizard", "/helix/opening-balance",
  "/helix/account-security", "/helix/reconciliation", "/helix/upcoming", "/helix/workspace-template",
];

test("every reachable route stays accessible with real data", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await addMarketExpense(page, "A11y taraması");
  const problems: string[] = [];
  for (const route of ALL_ROUTES) {
    await page.goto(route);
    await expect(page.locator("#root")).toBeVisible();
    const undersized = await page.evaluate(() => {
      const found: string[] = [];
      for (const element of Array.from(document.querySelectorAll<HTMLElement>("[role]"))) {
        const role = element.getAttribute("role");
        if (!role || !["button", "link", "tab", "radio", "switch", "checkbox"].includes(role)) continue;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        // WCAG 2.2 SC 2.5.8 (AA) — 24x24 CSS px minimum.
        if (box.width < 24 || box.height < 24) {
          found.push(`${role} "${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 30)}" ${Math.round(box.width)}x${Math.round(box.height)}`);
        }
      }
      return [...new Set(found)];
    });
    if (undersized.length > 0) problems.push(`${route} target size: ${undersized.join(", ")}`);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    for (const violation of result.violations) {
      problems.push(`${route} axe ${violation.id} (${violation.nodes.length}): ${violation.nodes[0]?.html.slice(0, 140)}`);
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
  await assertNoRuntimeErrors(errors, testInfo);
});

/**
 * The layout rules AGENTS.md calls non-negotiable, checked from computed style
 * rather than by eye: text is never truncated, toggles share one size, and the
 * page never scrolls sideways. (Status chip width is fixed by `STATUS_W` in the
 * component itself, so it needs no runtime check.)
 *
 * `text-overflow: ellipsis` alone proves nothing — React Native Web sets it on
 * every Text node, so only an element whose content actually exceeds its box is
 * a real truncation. Because that makes a passing run indistinguishable from a
 * broken detector, the scan first injects two deliberately truncated elements
 * and asserts it finds them.
 */
test("layout non-negotiables hold on every route in both widths", async ({ page, context }, testInfo) => {
  test.setTimeout(180_000);
  await isolateExternalData(context);
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await addMarketExpense(page, "Yerleşim taraması");

  const scan = (withControl: boolean) =>
    page.evaluate((injectControl: boolean) => {
      if (injectControl) {
        const clipped = document.createElement("div");
        clipped.textContent = "Bu satır kesinlikle taşacak kadar uzun bir metin içerir";
        clipped.style.cssText = "width:40px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;position:fixed;top:0";
        document.body.appendChild(clipped);
        const clamped = document.createElement("div");
        clamped.textContent = "satır bir satır iki satır üç satır dört satır beş";
        clamped.style.cssText =
          "width:60px;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;position:fixed;top:20px";
        document.body.appendChild(clamped);
      }
      const truncated: string[] = [];
      const toggles = new Set<string>();
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
        if (el.id.startsWith("__control")) continue;
        const style = getComputedStyle(el);
        const text = (el.textContent ?? "").trim().slice(0, 45);
        const visible = el.clientWidth > 0 && el.clientHeight > 0;
        if (!text || !visible) continue;
        const scrollable = style.overflowX === "visible" || style.overflowX === "auto" || style.overflowX === "scroll";
        if (el.children.length === 0 && !scrollable && el.scrollWidth > el.clientWidth + 1) {
          truncated.push(`${style.textOverflow === "ellipsis" ? "ellipsis" : "clip"} ${el.scrollWidth}>${el.clientWidth}: ${text}`);
        }
        if (style.webkitLineClamp !== "none" && el.scrollHeight > el.clientHeight + 1) {
          truncated.push(`line-clamp(${style.webkitLineClamp}): ${text}`);
        }
        const box = el.getBoundingClientRect();
        if (el.getAttribute("role") === "switch") toggles.add(`${Math.round(box.width)}x${Math.round(box.height)}`);
      }
      return { truncated: [...new Set(truncated)], toggles: [...toggles] };
    }, withControl);

  // Detector self-check, once, before the real sweep.
  await page.goto("/helix/");
  await expect(page.locator("#root")).toBeVisible();
  const control = await scan(true);
  expect(control.truncated.filter((t) => t.includes("Bu satır")), "ellipsis detector is live").toHaveLength(1);
  expect(control.truncated.filter((t) => t.includes("line-clamp")), "line-clamp detector is live").toHaveLength(1);

  const problems: string[] = [];
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ALL_ROUTES) {
      await page.goto(route);
      await expect(page.locator("#root")).toBeVisible();
      const found = await scan(false);
      const tag = `${width}px ${route}`;
      for (const t of found.truncated) problems.push(`${tag} truncated: ${t}`);
      if (found.toggles.length > 1) problems.push(`${tag} toggle sizes differ: ${found.toggles.join(", ")}`);
      const sideways = await page.evaluate(() => document.body.scrollWidth > document.body.clientWidth + 1);
      if (sideways) problems.push(`${tag} scrolls horizontally`);
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
  await assertNoRuntimeErrors(errors, testInfo);
});

test("dashboard remains visually stable across viewport and theme matrix", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  const viewports = [
    { name: "phone-320", width: 320, height: 720 },
    { name: "phone-390", width: 390, height: 844 },
    { name: "tablet-768", width: 768, height: 1024 },
    { name: "desktop-1440", width: 1440, height: 1000 },
  ];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/helix/");
      await expect(page.getByRole("tab", { name: "Bütçe Özeti", selected: true })).toBeVisible();
      if (viewport.width === 320) {
        const visibleLabels = await page.getByRole("tab").allTextContents();
        expect(visibleLabels).toEqual(["Özet", "Tablo", "Abonelik", "Hesap", "Ayarlar"]);
        expect(visibleLabels.join("")).not.toContain("…");
      }
      await expect(page).toHaveScreenshot(`dashboard-${viewport.name}-${scheme}.png`, {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: maxVisualDiffPixelRatio,
      });
    }
  }
  await assertNoRuntimeErrors(errors, testInfo);
});

test("every primary tab has a permanent mobile visual baseline", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await onboard(page);
  const tabs = [
    { name: "cash-flow", route: "/helix/cash-flow", heading: "Mali Tablo" },
    { name: "subscriptions", route: "/helix/subscriptions", heading: "Abonelikler" },
    { name: "calculator", route: "/helix/calculator", heading: "Hesap Makinesi" },
    { name: "settings", route: "/helix/settings", heading: "Ayarlar" },
  ] as const;
  for (const { name, route, heading } of tabs) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    await expect(page).toHaveScreenshot(`tab-${name}-phone-390-light.png`, {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: maxVisualDiffPixelRatio,
    });
  }
  await assertNoRuntimeErrors(errors, testInfo);
});

test("follow-up forms keep the quiet control system in both themes", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);
  const routes = [
    { name: "transaction", route: "/helix/transaction", heading: "Yeni İşlem" },
    { name: "analytics", route: "/helix/cash-flow/analytics", heading: "Analiz" },
    { name: "payment-sources", route: "/helix/settings/payment-sources", heading: "Ödeme Yöntemleri" },
    { name: "opening-balance", route: "/helix/opening-balance", heading: "Bakiye Düzeltme" },
  ];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const { name, route, heading } of routes) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
      await expect(page).toHaveScreenshot(`follow-up-${name}-phone-390-${scheme}.png`, {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: maxVisualDiffPixelRatio,
      });
    }
  }
  await assertNoRuntimeErrors(errors, testInfo);
});
