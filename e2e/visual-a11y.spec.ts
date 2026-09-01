import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  addMarketExpense,
  assertNoRuntimeErrors,
  collectRuntimeErrors,
  currentMonthKey,
  isolateExternalData,
  onboard,
  renderedContrast,
} from "./helpers";

/**
 * What the committed pixel baselines used to do, stated as measurements.
 *
 * A whole-page image caught real regressions, but it could only say "something
 * moved": every glyph rasterizer difference, every rotating placeholder and
 * every clock reading had to be masked or budgeted away before it agreed with
 * itself across two platforms. The risks it actually stood for are each
 * checkable directly — the page must not scroll sideways, a control must not
 * leave the viewport, a figure must stay on one line, a surface must keep its
 * contrast — so they are checked directly here instead.
 */
async function assertNoSidewaysScroll(page: Page, tag: string): Promise<void> {
  const sideways = await page.evaluate(
    () => document.body.scrollWidth > document.body.clientWidth + 1,
  );
  expect(sideways, `${tag} scrolls horizontally`).toBe(false);
}

/** Every interactive control's box lies inside the viewport it was laid out in. */
async function offscreenControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const width = document.documentElement.clientWidth;
    const belongsToHorizontalScroller = (element: HTMLElement) => {
      if (element.closest('[data-testid="table-horizontal-header"],[data-testid="table-horizontal-body"]')) {
        return true;
      }
      let ancestor = element.parentElement;
      while (ancestor && ancestor !== document.body) {
        const style = getComputedStyle(ancestor);
        if (
          (style.overflowX === "auto" || style.overflowX === "scroll") &&
          ancestor.scrollWidth > ancestor.clientWidth + 1
        ) {
          return true;
        }
        ancestor = ancestor.parentElement;
      }
      return false;
    };
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>('[role="button"],[role="tab"],[role="switch"],[role="link"]'),
    )) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if ((box.left < -1 || box.right > width + 1) && !belongsToHorizontalScroller(el)) {
        found.push(
          `${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)} @${Math.round(box.left)}..${Math.round(box.right)} of ${width}`,
        );
      }
    }
    return [...new Set(found)];
  });
}

test.beforeEach(async ({ context }) => isolateExternalData(context));

test("main routes have no WCAG A/AA violations @smoke @cross-browser", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  const routes = ["/helix/", "/helix/cash-flow", "/helix/subscriptions", "/helix/investments", "/helix/settings", "/helix/transaction"];
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
const LOCAL_STATIC_ROUTES = [
  "/helix/", "/helix/cash-flow", "/helix/cash-flow/analytics", "/helix/cash-flow/installments",
  "/helix/subscriptions", "/helix/investments", "/helix/investments/setup", "/helix/settings", "/helix/settings/tools", "/helix/settings/categories",
  "/helix/settings/computed-columns", "/helix/settings/payment-sources", "/helix/settings/persons",
  "/helix/settings/incomes", "/helix/settings/budgets", "/helix/settings/opening-balance",
  "/helix/transaction", "/helix/installment-new", "/helix/subscription-form", "/helix/bulk-entry",
  "/helix/columns-editor", "/helix/import-wizard", "/helix/opening-balance",
  "/helix/reconciliation", "/helix/upcoming", "/helix/workspace-template", "/helix/account-security",
  // Carries its instrument in the query string: without one it is the "unknown
  // instrument" card, which audits a screen nobody reaches. The feed is refused
  // for every browser test, so this is the empty state of the real layout — the
  // quote card, the range switch and the offer to fetch the history again.
  "/helix/market-detail?code=ALTIN",
];

async function localReachableRoutes(page: Page): Promise<string[]> {
  await page.goto("/helix/cash-flow");
  const realCell = page.locator('[role="button"][aria-label*=", Market,"]').first();
  await expect(realCell).toBeVisible();
  await realCell.click();
  await expect(page).toHaveURL(/\/helix\/cell-editor\?/);
  const cellEditor = new URL(page.url());
  return [
    ...LOCAL_STATIC_ROUTES,
    `/helix/cash-flow/${currentMonthKey()}`,
    `${cellEditor.pathname}${cellEditor.search}`,
  ];
}

test("every local-mode reachable route stays accessible with real data", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await addMarketExpense(page, "A11y taraması");
  const routes = await localReachableRoutes(page);
  const problems: string[] = [];
  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator("#root")).toBeVisible();
    if (route === "/helix/cash-flow") {
      // The app shell is visible before the async ledger bundle and measured
      // matrix viewport are ready. Audit the real populated table, not whichever
      // loading frame happened to win the race.
      await expect(page.getByRole("button", { name: /kolonunu sabitle/ }).first()).toBeVisible();
    }
    if (route === "/helix/settings/computed-columns") {
      await expect(page.getByRole("radio", { name: /^Toplam/ })).toBeVisible();
    }
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
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    for (const violation of result.violations) {
      problems.push(`${route} axe ${violation.id} (${violation.nodes.length}): ${violation.nodes[0]?.html.slice(0, 140)}`);
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
  await assertNoRuntimeErrors(errors, testInfo);
});

/**
 * The layout rules this project calls non-negotiable, checked from computed style
 * rather than by eye: text is never truncated, toggles share one size, and the
 * page never scrolls sideways. (Status chip width is fixed by `STATUS_W` in the
 * component itself, so it needs no runtime check.)
 *
 * `text-overflow: ellipsis` alone proves nothing — React Native Web sets it on
 * every Text node, so only an element whose content actually exceeds its box is
 * a real truncation. Because that makes a passing run indistinguishable from a
 * broken detector, the scan first injects deliberately clipped, clamped and
 * wrapped controls and asserts it finds all three.
 */
test("layout non-negotiables hold on every route in both widths", async ({ page, context }, testInfo) => {
  test.setTimeout(180_000);
  await isolateExternalData(context);
  // This audit owns settled geometry; entrance-motion behavior has a separate
  // regression test. Waiting for fonts plus two paint frames prevents the app
  // shell from being mistaken for the final Amount fit under full-suite load.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await addMarketExpense(page, "Yerleşim taraması");
  const routes = await localReachableRoutes(page);

  const waitForSettledLayout = () => page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });

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
        const wrappedMoney = document.createElement("div");
        wrappedMoney.textContent = "₺123.456,78";
        wrappedMoney.style.cssText =
          "width:30px;overflow-wrap:anywhere;position:fixed;top:40px";
        document.body.appendChild(wrappedMoney);
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
        if (
          el.children.length === 0 &&
          style.overflowY !== "visible" &&
          style.overflowY !== "auto" &&
          style.overflowY !== "scroll" &&
          el.scrollHeight > el.clientHeight + 1
        ) {
          truncated.push(`vertical-clip ${el.scrollHeight}>${el.clientHeight}: ${text}`);
        }
        // Financial figures are atomic scan targets. Ordinary prose should
        // wrap, but splitting the final digit of ₺12.500,00 onto another line
        // changes the number's visual meaning and made the matrix unreadable.
        if (/^-?[₺$€£¥][\d.,]+$/.test(text)) {
          const visualLines = new Set<number>();
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent?.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const rect of Array.from(range.getClientRects())) {
              visualLines.add(Math.round(rect.top));
            }
          }
          // Selecting the element itself also returns the boxes of nested SVGs,
          // buttons and wrappers. Only text-node rects represent painted lines.
          if (visualLines.size > 1) truncated.push(`money-wrap(${visualLines.size}): ${text}`);
        }
        const deliberateTableClamp =
          (el.dataset.testid === "table-column-label" || el.dataset.testid === "table-row-label") &&
          style.webkitLineClamp === "2" &&
          Boolean(el.getAttribute("aria-label"));
        if (
          style.webkitLineClamp !== "none" &&
          el.scrollHeight > el.clientHeight + 1 &&
          !deliberateTableClamp
        ) {
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
  await waitForSettledLayout();
  const control = await scan(true);
  expect(control.truncated.filter((t) => t.includes("Bu satır")), "ellipsis detector is live").toHaveLength(1);
  expect(control.truncated.filter((t) => t.includes("line-clamp")), "line-clamp detector is live").toHaveLength(1);
  expect(
    control.truncated.filter((t) => t.includes("money-wrap") && t.includes("₺123.456,78")),
    "money-wrap detector is live",
  ).toHaveLength(1);

  const problems: string[] = [];
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator("#root")).toBeVisible();
      await waitForSettledLayout();
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

test("large compact negative amounts keep their sign and unit on one visual line", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await onboard(page);
  await addMarketExpense(page, "Büyük tutar yerleşim kontrolü", "9876543,21");
  // Amount keeps an ASCII minus glued to its currency glyph with an invisible
  // word joiner; match the painted text without making that layout character
  // part of the test contract.
  const formatted = /^-.*₺9\.877\s+Mn$/u;
  const maxVisualLines = (text: RegExp) => page.getByText(text).evaluateAll((nodes) => Math.max(...nodes.map((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size;
  })));
  const minRenderedFontSize = (text: RegExp) => page.getByText(text).evaluateAll((nodes) =>
    Math.min(...nodes.map((node) => Number.parseFloat(getComputedStyle(node).fontSize))),
  );

  // A large signed compact figure is the layout's worst case: the sign and
  // unit must stay attached while the value remains inside its cell.
  for (const surface of [
    { tag: "dashboard 320 light", width: 320, height: 720, route: "/helix/", scheme: "light" },
    { tag: `month 390 light`, width: 390, height: 844, route: `/helix/cash-flow/${currentMonthKey()}`, scheme: "light" },
    { tag: "dashboard 320 dark", width: 320, height: 720, route: "/helix/", scheme: "dark" },
  ] as const) {
    await page.emulateMedia({ colorScheme: surface.scheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: surface.width, height: surface.height });
    await page.goto(surface.route);
    await expect(page.locator("#root")).toBeVisible();
    await expect.poll(() => maxVisualLines(formatted)).toBe(1);
    // The sign is part of the number: dropping it reads as income on a screen
    // that is about to owe money. The compact unit must also be painted.
    const painted = await page
      .getByText(formatted)
      .evaluateAll((nodes) => nodes.filter((node) => node.getClientRects().length > 0).length);
    expect(painted, `${surface.tag} paints the signed amount`).toBeGreaterThan(0);
    expect(await minRenderedFontSize(formatted), `${surface.tag} font size`).toBeGreaterThanOrEqual(11);
    await assertNoSidewaysScroll(page, surface.tag);
    expect(await offscreenControls(page), `${surface.tag} controls outside viewport`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });

  // The largest accepted single entry promotes through the same global scale;
  // it must still fit without changing the input cap.
  await addMarketExpense(page, "Azami tutar yerleşim kontrolü", "999999999999,99");
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/helix/");
  const maximumFormatted = /^-.*₺1\s+Tr$/u;
  await expect.poll(() => maxVisualLines(maximumFormatted)).toBe(1);
  await expect.poll(() => minRenderedFontSize(maximumFormatted)).toBeGreaterThanOrEqual(11);
  await assertNoRuntimeErrors(errors, testInfo);
});

test("dashboard reflows intact across the viewport and theme matrix", async ({ page }, testInfo) => {
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
      await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();
      const tag = `dashboard ${viewport.name} ${scheme}`;
      // A tab shows its label WHOLE or not at all — never truncated, and never
      // so crowded that two words read as one. At 320px the widest label
      // ("Abonelikler", 60px) cannot clear a 58px column, so the bar drops
      // every label and keeps five icon targets; measured before this rule
      // could fire, "Mali Tablo" and "Abonelikler" sat 1px apart. From 360px
      // up the labels are back with room between them.
      //
      // The names never go anywhere: they are the tabs' accessible names at
      // every width, which is what a screen reader and this assertion read.
      const names = ["Durum", "Mali Tablo", "Abonelikler", "Yatırımlar", "Ayarlar"];
      for (const name of names) {
        await expect(page.getByRole("tab", { name, exact: true }), `${tag} ${name}`).toBeVisible();
      }
      const visibleLabels = (await page.getByRole("tab").allTextContents()).filter(Boolean);
      expect(visibleLabels.join(""), tag).not.toContain("…");
      if (visibleLabels.length > 0) {
        expect(visibleLabels, `${tag} labels are whole or absent`).toEqual(names);
      }
      // The dashboard's reason to exist is the balance block; a reflow that
      // drops it off the layout is the regression the baseline really guarded.
      await expect(page.getByText("Güncel Bakiye", { exact: true }).first(), tag).toBeVisible();
      await assertNoSidewaysScroll(page, tag);
      expect(await offscreenControls(page), `${tag} controls outside viewport`).toEqual([]);
    }
  }
  await assertNoRuntimeErrors(errors, testInfo);
});

test("every primary tab lands on its own screen and fits the phone width @smoke @cross-browser", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await onboard(page);
  const tabs = [
    { name: "cash-flow", route: "/helix/cash-flow", heading: "Mali Tablo" },
    { name: "subscriptions", route: "/helix/subscriptions", heading: "Abonelikler" },
    { name: "investments", route: "/helix/investments", heading: "Yatırımlar" },
    { name: "settings", route: "/helix/settings", heading: "Ayarlar" },
  ] as const;
  for (const { name, route, heading } of tabs) {
    await page.goto(route);
    // The route resolves to its own screen — not a shared shell, not the
    // dashboard fallback — and the tab bar it was reached through stays put.
    await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: "Durum" })).toBeVisible();
    // Soft, so one failing tab still reports the state of the other three.
    await expect
      .soft(page.locator("#root"), `tab ${name}`)
      .toBeVisible();
    const sideways = await page.evaluate(
      () => document.body.scrollWidth > document.body.clientWidth + 1,
    );
    expect.soft(sideways, `tab ${name} scrolls horizontally`).toBe(false);
    expect.soft(await offscreenControls(page), `tab ${name} controls outside viewport`).toEqual([]);
  }
  await assertNoRuntimeErrors(errors, testInfo);
});

// The refund switch turned invisible when it was on: the row painted itself in
// `primarySoft`, which is the switch's own active track colour, so the control
// and its background became the same pixel value (1.00:1). Both toggle fills are
// low-contrast warm neutrals, so the boundary is what makes a switch visible at
// all — assert it in both states, both themes, for the shared control itself.
test("switches stay visible in both states and both themes", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto("/helix/transaction");
    await page.getByRole("button", { name: /Gider iadesi veya döviz/ }).click();
    const refund = page.getByRole("switch", { name: "Gider iadesi" });
    await expect(refund).toBeVisible();
    const track = refund.locator("div").first();

    for (const state of ["off", "on"] as const) {
      if (state === "on") await refund.click();
      await expect(refund).toHaveAttribute("aria-checked", state === "on" ? "true" : "false");
      // WCAG 1.4.11 for a non-text UI component boundary.
      expect(
        await renderedContrast(track, "boundary"),
        `refund switch ${state} in ${scheme}`,
      ).toBeGreaterThanOrEqual(3);
    }
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
      const tag = `follow-up ${name} ${scheme}`;
      // Type real content first: an empty field paints placeholder ink, and the
      // colour that has to survive a theme change is the value's.
      if (name === "transaction") {
        const note = page.getByRole("textbox", { name: "Not", exact: true });
        await note.fill("Görsel kontrol");
        await note.evaluate((element) => (element as HTMLElement).blur());
      } else if (name === "payment-sources") {
        const sourceName = page.getByRole("textbox", { name: "Yöntem adı", exact: true });
        await sourceName.fill("Görsel yöntem");
        await sourceName.evaluate((element) => (element as HTMLElement).blur());
      }
      // What the baseline stood for on these four forms was the quiet control
      // system staying legible when the palette flips: heading ink against the
      // surface behind it, and the control boundary that is the only thing
      // making a low-contrast neutral field visible at all. Both are measured
      // from what the browser actually painted, in both schemes. Soft, so one
      // failing form still reports the other seven combinations.
      const title = page.getByRole("heading", { name: heading, exact: true }).first();
      expect.soft(await renderedContrast(title, "text"), `${tag} heading contrast`).toBeGreaterThanOrEqual(4.5);
      const field = page.getByRole("textbox").first();
      if (await field.count()) {
        expect.soft(await renderedContrast(field, "boundary"), `${tag} field boundary`).toBeGreaterThanOrEqual(3);
      }
      const sideways = await page.evaluate(
        () => document.body.scrollWidth > document.body.clientWidth + 1,
      );
      expect.soft(sideways, `${tag} scrolls horizontally`).toBe(false);
      expect.soft(await offscreenControls(page), `${tag} controls outside viewport`).toEqual([]);
    }
  }
  await assertNoRuntimeErrors(errors, testInfo);
});

test("modal actions stay reachable in a short landscape viewport @smoke @cross-browser", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await page.setViewportSize({ width: 844, height: 390 });

  await page.goto("/helix/settings");
  await page.getByRole("button", { name: /Tanıtım Turu/ }).click();
  const tourModal = page.locator('[aria-modal="true"]');
  await expect(tourModal).toBeVisible();
  const skip = page.getByRole("button", { name: "Geç", exact: true });
  await skip.scrollIntoViewIfNeeded();
  const skipBox = await skip.boundingBox();
  expect(skipBox && skipBox.y >= 0 && skipBox.y + skipBox.height <= 390).toBe(true);
  await skip.click();
  await expect(tourModal).toHaveCount(0);

  await page.goto("/helix/transaction");
  const calculatorTrigger = page.getByRole("button", { name: "Hesap makinesini aç", exact: true });
  await calculatorTrigger.click();
  const calculatorModal = page.locator('[aria-modal="true"]');
  await expect(calculatorModal).toBeVisible();
  const result = page.getByRole("button", { name: /Sonucu Kullan/ });
  const resultBox = await result.boundingBox();
  expect(resultBox && resultBox.y >= 0 && resultBox.y + resultBox.height <= 390).toBe(true);
  // 390px of height is where a modal stops fitting and starts hiding its own
  // controls. Every keypad key must be inside the viewport and reachable, not
  // just the confirm button — a digit pushed below the fold is a dead calculator.
  const keys = page.locator('[aria-modal="true"] [role="button"]');
  const keyCount = await keys.count();
  expect(keyCount).toBeGreaterThan(10);
  const clipped: string[] = [];
  for (let index = 0; index < keyCount; index += 1) {
    const key = keys.nth(index);
    if (!(await key.isVisible())) continue;
    const box = await key.boundingBox();
    if (!box) continue;
    if (box.y < 0 || box.y + box.height > 390 || box.x < 0 || box.x + box.width > 844) {
      clipped.push(`${(await key.getAttribute("aria-label")) ?? (await key.textContent())?.trim()}`);
    }
  }
  expect(clipped, `calculator keys outside the landscape viewport: ${clipped.join(", ")}`).toEqual([]);
  await assertNoSidewaysScroll(page, "calculator modal landscape");

  await page.keyboard.press("Escape");
  await expect(calculatorModal).toHaveCount(0);
  await expect(calculatorTrigger).toBeFocused();

  await page.goto("/helix/transaction");
  const categoryTrigger = page.getByRole("button", { name: "Kategori", exact: true });
  await categoryTrigger.scrollIntoViewIfNeeded();
  await categoryTrigger.click();
  const selectModal = page.locator('[aria-modal="true"]');
  await expect(selectModal).toBeVisible();
  const selectBox = await selectModal.boundingBox();
  expect(
    selectBox && selectBox.y >= 0 && selectBox.y + selectBox.height <= 390,
    `select modal outside the landscape viewport: ${JSON.stringify(selectBox)}`,
  ).toBe(true);
  const selectHeading = selectModal.getByRole("heading", { name: "Kategori", exact: true });
  const selectHeadingBox = await selectHeading.boundingBox();
  expect(
    selectHeadingBox && selectHeadingBox.y >= 0 && selectHeadingBox.y + selectHeadingBox.height <= 390,
    `select heading outside the landscape viewport: ${JSON.stringify(selectHeadingBox)}`,
  ).toBe(true);
  const options = selectModal.getByRole("radiogroup");
  await expect(options).toBeInViewport();
  const lastOption = options.getByRole("radio").last();
  await lastOption.scrollIntoViewIfNeeded();
  await expect(lastOption).toBeInViewport();
  const createOption = selectModal.getByRole("button", { name: "Yeni kalem ekle", exact: true });
  await createOption.scrollIntoViewIfNeeded();
  await expect(createOption).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(selectModal).toHaveCount(0);
  await expect(categoryTrigger).toBeFocused();

  await page.getByRole("radio", { name: "Belirli gün", exact: true }).click();
  const dateTrigger = page.getByRole("button", { name: "Ödeme günü", exact: true });
  await dateTrigger.scrollIntoViewIfNeeded();
  await dateTrigger.click();
  const calendarModal = page.locator('[aria-modal="true"]');
  await expect(calendarModal).toBeVisible();
  await calendarModal.getByRole("button", { name: "Sonraki", exact: true }).click();
  const calendarHeading = calendarModal.getByRole("heading");
  const calendarHeadingBox = await calendarHeading.boundingBox();
  expect(
    calendarHeadingBox && calendarHeadingBox.y >= 0 && calendarHeadingBox.y + calendarHeadingBox.height <= 390,
    `calendar heading outside the landscape viewport: ${JSON.stringify(calendarHeadingBox)}`,
  ).toBe(true);
  const calendarCancel = calendarModal.getByRole("button", { name: "Vazgeç", exact: true });
  await calendarCancel.scrollIntoViewIfNeeded();
  await expect(calendarCancel).toBeInViewport();
  await calendarCancel.click();
  await expect(calendarModal).toHaveCount(0);
  await expect(dateTrigger).toBeFocused();
  await assertNoRuntimeErrors(errors, testInfo);
});

/**
 * RuleRow, isolated with real props.
 *
 * The component is only reachable once a rule exists, which is why a
 * nested-interactive defect lived in it unseen: every axe sweep hit the empty
 * state instead. An income rule is the cheapest real instance, so this test
 * creates one and then asserts the component's interaction semantics directly.
 *
 * The row used to wrap its ENTIRE content — including two IconButtons that are
 * themselves `role="button"` — in one outer `role="button"`. That is axe's
 * `nested-interactive` rule (wcag2a, SC 4.1.2). The press target is now scoped
 * to the label column, leaving three sibling controls.
 */
test("RuleRow exposes three sibling controls, not nested interactives", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);

  await page.goto("/helix/settings/incomes");
  await page.getByRole("textbox", { name: "Başlık" }).fill("Maaş");
  await page.getByRole("textbox", { name: "Varsayılan tutar" }).fill("42.500,00");
  await page.getByRole("button", { name: "Gelir Kuralı Ekle", exact: true }).click();
  const label = page.getByRole("button", { name: "Maaş", exact: true });
  await expect(label).toBeVisible();

  // 1. No nested interactive element anywhere on the route.
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const nested = result.violations.filter((v) => v.id === "nested-interactive");
  expect(nested, JSON.stringify(nested.map((v) => v.nodes.map((n) => n.html)))).toEqual([]);
  expect(result.violations.map((v) => v.id)).toEqual([]);

  // 2. Label, edit and delete are three separate controls with their own names.
  const edit = page.getByRole("button", { name: "Düzenle · Maaş", exact: true });
  const remove = page.getByRole("button", { name: "Sil · Maaş", exact: true });
  for (const control of [label, edit, remove]) await expect(control).toBeVisible();

  // 3. None of them contains another: a control's box must not enclose a sibling.
  const [labelBox, editBox, deleteBox] = await Promise.all([
    label.boundingBox(),
    edit.boundingBox(),
    remove.boundingBox(),
  ]);
  expect(labelBox && editBox && deleteBox).toBeTruthy();
  const encloses = (outer: NonNullable<typeof labelBox>, inner: NonNullable<typeof labelBox>) =>
    inner.x >= outer.x && inner.x + inner.width <= outer.x + outer.width;
  expect(encloses(labelBox!, editBox!)).toBe(false);
  expect(encloses(labelBox!, deleteBox!)).toBe(false);

  // 4. Minimum touch target is preserved on the label and both icon buttons.
  expect(labelBox!.height).toBeGreaterThanOrEqual(44);
  for (const box of [editBox!, deleteBox!]) {
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(32);
  }

  // 5. Every control is keyboard reachable and separately focusable.
  const focusables = await page.evaluate(() => {
    const names = ["Maaş", "Düzenle · Maaş", "Sil · Maaş"];
    return names.map((name) => {
      const el = Array.from(document.querySelectorAll('[role="button"]')).find(
        (node) => (node.getAttribute("aria-label") ?? node.textContent ?? "").trim() === name,
      ) as HTMLElement | undefined;
      if (!el) return { name, found: false, focusable: false, focused: false };
      el.focus();
      return {
        name,
        found: true,
        focusable: el.tabIndex >= 0,
        focused: document.activeElement === el,
      };
    });
  });
  for (const control of focusables) {
    expect(control.found, control.name).toBe(true);
    expect(control.focusable, control.name).toBe(true);
    expect(control.focused, control.name).toBe(true);
  }

  // 6. Pressing the label opens the editor…
  await label.click();
  const titleField = page.getByRole("textbox", { name: "Başlık" });
  await expect(titleField).toHaveValue("Maaş");

  // 7. …and the edit button opens the same editor, without deleting anything.
  await page.goto("/helix/settings/incomes");
  await edit.click();
  await expect(page.getByRole("textbox", { name: "Başlık" })).toHaveValue("Maaş");
  await page.goto("/helix/settings/incomes");
  await expect(page.getByRole("button", { name: "Maaş", exact: true })).toBeVisible();

  await assertNoRuntimeErrors(errors, testInfo);
});
