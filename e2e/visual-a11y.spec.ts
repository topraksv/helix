import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  addMarketExpense,
  collectRuntimeErrors,
  currentMonthKey,
  isolateExternalData,
  offscreenControls,
  onboard,
  openRouteForAudit,
  renderedContrast,
  routeRedirectProblem,
} from "./helpers";

// Directly checkable risks stand in for pixel baselines: no sideways scroll, no control
// outside the viewport, figures on one line, contrast kept.
async function assertNoSidewaysScroll(page: Page, tag: string): Promise<void> {
  const sideways = await page.evaluate(
    () => document.body.scrollWidth > document.body.clientWidth + 1,
  );
  expect(sideways, `${tag} scrolls horizontally`).toBe(false);
}

test.beforeEach(async ({ context }) => isolateExternalData(context));

test("main routes have no WCAG A/AA violations @cross-browser", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  const routes = ["/helix/", "/helix/cash-flow", "/helix/subscriptions", "/helix/investments", "/helix/settings", "/helix/transaction"];
  for (const route of routes) {
    await openRouteForAudit(page, route);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(result.violations, `${route}\n${JSON.stringify(result.violations, null, 2)}`).toEqual([]);
    // A walk that only proves `#root` rendered clears routes it never opened once one gains a guard.
    expect(routeRedirectProblem(page, route)).toBeNull();
  }
  expect(errors).toEqual([]);
});

// The 6-route check runs on a near-empty workspace; several violations only appeared with data
// (matrix cells, reorder grips, a faded section, a scroll region), so this walks EVERY
// reachable route with real data and adds the WCAG 2.2 target size axe 2.1 does not cover.
const LOCAL_STATIC_ROUTES = [
  "/helix/", "/helix/cash-flow", "/helix/cash-flow/analytics", "/helix/cash-flow/installments",
  "/helix/subscriptions", "/helix/investments", "/helix/investments/setup", "/helix/settings", "/helix/settings/tools", "/helix/settings/categories",
  "/helix/settings/computed-columns", "/helix/settings/payment-sources", "/helix/settings/persons",
  "/helix/settings/incomes", "/helix/settings/budgets", "/helix/settings/opening-balance",
  "/helix/transaction", "/helix/installment-new", "/helix/subscription-form", "/helix/bulk-entry",
  "/helix/columns-editor", "/helix/import-wizard", "/helix/opening-balance",
  "/helix/upcoming", "/helix/workspace-template",
  // A route list is a claim about what has been checked; /helix/privacy's scroll region once failed unseen.
  "/helix/privacy", "/helix/feedback", "/helix/attention", "/helix/sync-issues",
  "/helix/statement-import",
  // Without a code it is the "unknown instrument" card, which nobody reaches; the feed is refused
  // in browser tests, so this audits the real layout's empty state.
  "/helix/market-detail?code=ALTIN",
];

// Both guard on `isSupabaseConfigured` and browser builds export with it blank, so listing them
// above audited Settings twice under their names. The test below turns the exclusion into an
// assertion that goes red the day either guard changes.
const CLOUD_ONLY_ROUTES = ["/helix/account-security", "/helix/data-reset"];

/**
 * WCAG 2.2 SC 2.5.8 (AA): 24x24 CSS px, minus the Inline exception for a target in a sentence
 * (`/helix/feedback`'s notice link, 172x19 in a 23px line box). The exception is narrow on purpose:
 * height only; the height must fit the parent's line box (RNW sets `display: inline` on every
 * Text, so inline alone buys nothing); the parent must carry direct text nodes.
 * `assertTargetSizeDetectorIsLive` proves all three before the sweep trusts them.
 */
async function undersizedTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>("[role]"))) {
      const role = element.getAttribute("role");
      if (!role || !["button", "link", "tab", "radio", "switch", "checkbox"].includes(role)) continue;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const parent = element.parentElement;
      const lineHeight = parent ? Number.parseFloat(getComputedStyle(parent).lineHeight) : Number.NaN;
      const inSentence = parent != null && Array.from(parent.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim().length > 0,
      );
      const constrainedByLineHeight = style.display === "inline"
        && inSentence
        && Number.isFinite(lineHeight)
        && box.height <= lineHeight + 1;
      if (box.width < 24 || (box.height < 24 && !constrainedByLineHeight)) {
        found.push(`${role} "${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 30)}" ${Math.round(box.width)}x${Math.round(box.height)}`);
      }
    }
    return [...new Set(found)];
  });
}

// Three injected controls, one per narrowing: the sentence link exempt, the narrow one in the same
// sentence not (width), the inline one outside a sentence not. Removed before the real sweep.
async function assertTargetSizeDetectorIsLive(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sentence = document.createElement("div");
    sentence.id = "__targetprobe";
    sentence.style.cssText = "position:fixed;top:0;left:0;width:420px;line-height:23px;font-size:14px";
    sentence.append("Bir cümlenin ortasında duran ");
    const exempt = document.createElement("span");
    exempt.setAttribute("role", "link");
    exempt.setAttribute("aria-label", "probe-exempt");
    exempt.textContent = "yeterince uzun bir bağlantı metni";
    const narrow = document.createElement("span");
    narrow.setAttribute("role", "link");
    narrow.setAttribute("aria-label", "probe-narrow");
    narrow.style.fontSize = "2px";
    narrow.textContent = "x";
    sentence.append(exempt, " ve ", narrow, " olan.");
    const alone = document.createElement("div");
    alone.id = "__targetprobe-alone";
    alone.style.cssText = "position:fixed;top:60px;left:0;line-height:23px;font-size:14px";
    const lonely = document.createElement("span");
    lonely.setAttribute("role", "button");
    lonely.setAttribute("aria-label", "probe-alone");
    lonely.textContent = "Tek başına duran kontrol";
    alone.append(lonely);
    document.body.append(sentence, alone);
  });
  const found = await undersizedTargets(page);
  await page.evaluate(() => {
    for (const id of ["__targetprobe", "__targetprobe-alone"]) document.getElementById(id)?.remove();
  });
  const flagged = (label: string) => found.some((entry) => entry.includes(label));
  expect(flagged("probe-exempt"), `the Inline exception is not exempting anything:\n${found.join("\n")}`).toBe(false);
  expect(flagged("probe-narrow"), "the exception is swallowing the width check").toBe(true);
  expect(flagged("probe-alone"), "the exception is covering controls outside a sentence").toBe(true);
}

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

test("every local-mode reachable route stays accessible with real data", async ({ page }) => {
  // The budget follows the route count, or the tail races the clock and fails as a timeout.
  test.setTimeout(300_000);
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await addMarketExpense(page, "A11y taraması");
  const routes = await localReachableRoutes(page);
  await assertTargetSizeDetectorIsLive(page);
  const problems: string[] = [];
  for (const route of routes) {
    await openRouteForAudit(page, route);
    if (route === "/helix/cash-flow") {
      // The shell shows before the async ledger bundle: audit the populated table, not a loading frame.
      await expect(page.getByRole("button", { name: /kolonunu sabitle/ }).first()).toBeVisible();
    }
    if (route === "/helix/settings/computed-columns") {
      await expect(page.getByRole("radio", { name: /^Toplam/ })).toBeVisible();
    }
    const undersized = await undersizedTargets(page);
    if (undersized.length > 0) problems.push(`${route} target size: ${undersized.join(", ")}`);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    for (const violation of result.violations) {
      problems.push(`${route} axe ${violation.id} (${violation.nodes.length}): ${violation.nodes[0]?.html.slice(0, 140)}`);
    }
    // Last: the axe run has given any guard longer than a redirect takes.
    const redirected = routeRedirectProblem(page, route);
    if (redirected) problems.push(redirected);
  }
  expect(problems, problems.join("\n")).toEqual([]);
  expect(errors).toEqual([]);
});

test("the cloud-only routes are excluded because they redirect, not because they were forgotten", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  for (const route of CLOUD_ONLY_ROUTES) {
    await openRouteForAudit(page, route);
    // Red means the screen is reachable in a browser build now and owes the sweep an entry.
    await expect(page, `${route} no longer redirects; it belongs in the route sweep`)
      .toHaveURL(/\/helix\/settings$/);
  }
  expect(errors).toEqual([]);
});

// `text-overflow: ellipsis` alone proves nothing (RNW sets it on every Text), so only content that
// exceeds its box counts; the scan first injects clipped, clamped and wrapped controls and must find all three.
test("layout non-negotiables hold on every route in both widths", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await addMarketExpense(page, "Yerleşim taraması");
  const routes = await localReachableRoutes(page);

  // Fonts plus two frames, or the shell is mistaken for the final Amount fit under suite load.
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
        // Figures are atomic: a wrapped final digit of ₺12.500,00 changes its meaning.
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
          // Element rects include nested SVGs and wrappers; only text-node rects are painted lines.
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
      await openRouteForAudit(page, route);
      await waitForSettledLayout();
      const found = await scan(false);
      const tag = `${width}px ${route}`;
      for (const t of found.truncated) problems.push(`${tag} truncated: ${t}`);
      if (found.toggles.length > 1) problems.push(`${tag} toggle sizes differ: ${found.toggles.join(", ")}`);
      const sideways = await page.evaluate(() => document.body.scrollWidth > document.body.clientWidth + 1);
      if (sideways) problems.push(`${tag} scrolls horizontally`);
      const redirected = routeRedirectProblem(page, route);
      if (redirected) problems.push(`${width}px ${redirected}`);
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
  expect(errors).toEqual([]);
});

test("large compact negative amounts keep their sign and unit on one visual line", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await addMarketExpense(page, "Büyük tutar yerleşim kontrolü", "9876543,21");
  // Amount glues the minus to the currency glyph with an invisible word joiner; match the painted text.
  const formatted = /^-.*₺9\.877\s+Mn$/u;
  const maxVisualLines = (text: RegExp) => page.getByText(text).evaluateAll((nodes) => Math.max(...nodes.map((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size;
  })));
  const minRenderedFontSize = (text: RegExp) => page.getByText(text).evaluateAll((nodes) =>
    Math.min(...nodes.map((node) => Number.parseFloat(getComputedStyle(node).fontSize))),
  );

  for (const surface of [
    { tag: "dashboard 320 light", width: 320, height: 720, route: "/helix/", scheme: "light" },
    { tag: `month 390 light`, width: 390, height: 844, route: `/helix/cash-flow/${currentMonthKey()}`, scheme: "light" },
    { tag: "dashboard 320 dark", width: 320, height: 720, route: "/helix/", scheme: "dark" },
  ] as const) {
    await page.emulateMedia({ colorScheme: surface.scheme });
    await page.setViewportSize({ width: surface.width, height: surface.height });
    await page.goto(surface.route);
    await expect(page.locator("#root")).toBeVisible();
    await expect.poll(() => maxVisualLines(formatted)).toBe(1);
    // A dropped sign reads as income; the compact unit must also be painted.
    const painted = await page
      .getByText(formatted)
      .evaluateAll((nodes) => nodes.filter((node) => node.getClientRects().length > 0).length);
    expect(painted, `${surface.tag} paints the signed amount`).toBeGreaterThan(0);
    expect(await minRenderedFontSize(formatted), `${surface.tag} font size`).toBeGreaterThanOrEqual(11);
    await assertNoSidewaysScroll(page, surface.tag);
    expect(await offscreenControls(page), `${surface.tag} controls outside viewport`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light" });

  // The largest accepted entry must still fit without changing the input cap.
  await addMarketExpense(page, "Azami tutar yerleşim kontrolü", "999999999999,99");
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/helix/");
  const maximumFormatted = /^-.*₺1\s+Tr$/u;
  await expect.poll(() => maxVisualLines(maximumFormatted)).toBe(1);
  await expect.poll(() => minRenderedFontSize(maximumFormatted)).toBeGreaterThanOrEqual(11);
  expect(errors).toEqual([]);
});

test("dashboard reflows intact across the viewport and theme matrix", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  const viewports = [
    { name: "phone-320", width: 320, height: 720 },
    { name: "phone-390", width: 390, height: 844 },
    { name: "tablet-768", width: 768, height: 1024 },
    { name: "desktop-1440", width: 1440, height: 1000 },
  ];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/helix/");
      await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();
      const tag = `dashboard ${viewport.name} ${scheme}`;
      // A tab label is whole or absent: at 320px "Abonelikler" (60px) cannot clear a 58px column,
      // so the bar drops labels and keeps five icon targets. Names stay accessible at every width.
      const names = ["Durum", "Mali Tablo", "Abonelikler", "Yatırımlar", "Ayarlar"];
      for (const name of names) {
        await expect(page.getByRole("tab", { name, exact: true }), `${tag} ${name}`).toBeVisible();
      }
      const visibleLabels = (await page.getByRole("tab").allTextContents()).filter(Boolean);
      expect(visibleLabels.join(""), tag).not.toContain("…");
      if (visibleLabels.length > 0) {
        expect(visibleLabels, `${tag} labels are whole or absent`).toEqual(names);
      }
      await expect(page.getByText("Güncel Bakiye", { exact: true }).first(), tag).toBeVisible();
      await assertNoSidewaysScroll(page, tag);
      expect(await offscreenControls(page), `${tag} controls outside viewport`).toEqual([]);
    }
  }
  expect(errors).toEqual([]);
});

test("every primary tab lands on its own screen and fits the phone width @cross-browser", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);
  const tabs = [
    { name: "cash-flow", route: "/helix/cash-flow", heading: "Mali Tablo" },
    { name: "subscriptions", route: "/helix/subscriptions", heading: "Abonelikler" },
    { name: "investments", route: "/helix/investments", heading: "Yatırımlar" },
    { name: "settings", route: "/helix/settings", heading: "Ayarlar" },
  ] as const;
  for (const { name, route, heading } of tabs) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: "Durum" })).toBeVisible();
    const sideways = await page.evaluate(
      () => document.body.scrollWidth > document.body.clientWidth + 1,
    );
    expect.soft(sideways, `tab ${name} scrolls horizontally`).toBe(false);
    expect.soft(await offscreenControls(page), `tab ${name} controls outside viewport`).toEqual([]);
  }
  expect(errors).toEqual([]);
});

// The refund switch painted itself in its own active track colour (1.00:1). Both toggle fills are
// low-contrast neutrals, so the boundary is what makes a switch visible: assert it in every state and theme.
test("switches stay visible in both states and both themes", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/helix/transaction");
    await page.getByRole("button", { name: /Gider iadesi veya döviz/ }).click();
    const refund = page.getByRole("switch", { name: "Gider iadesi" });
    await expect(refund).toBeVisible();
    const track = refund.locator("div").first();

    for (const state of ["off", "on"] as const) {
      if (state === "on") await refund.click();
      await expect(refund).toHaveAttribute("aria-checked", state === "on" ? "true" : "false");
      // WCAG 1.4.11.
      expect(
        await renderedContrast(track, "boundary"),
        `refund switch ${state} in ${scheme}`,
      ).toBeGreaterThanOrEqual(3);
    }
  }
  expect(errors).toEqual([]);
});

test("follow-up forms keep the quiet control system in both themes", async ({ page }) => {
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
    await page.emulateMedia({ colorScheme: scheme });
    for (const { name, route, heading } of routes) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
      const tag = `follow-up ${name} ${scheme}`;
      // Real content first: an empty field paints placeholder ink, not the value's.
      if (name === "transaction") {
        const note = page.getByRole("textbox", { name: "Not", exact: true });
        await note.fill("Görsel kontrol");
        await note.evaluate((element) => (element as HTMLElement).blur());
      } else if (name === "payment-sources") {
        const sourceName = page.getByRole("textbox", { name: "Yöntem adı", exact: true });
        await sourceName.fill("Görsel yöntem");
        await sourceName.evaluate((element) => (element as HTMLElement).blur());
      }
      // Soft, so one failing form still reports the other combinations.
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
  expect(errors).toEqual([]);
});

test("modal actions stay reachable in a short landscape viewport @cross-browser", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await onboard(page);
  await page.setViewportSize({ width: 844, height: 390 });

  await page.goto("/helix/settings");
  await page.getByRole("button", { name: /Tanıtım Turu/ }).click();
  const tourModal = page.locator('[aria-modal="true"]');
  await expect(tourModal).toBeVisible();
  const skip = page.getByRole("button", { name: "Geç", exact: true });
  await skip.scrollIntoViewIfNeeded();
  await expect(skip).toBeInViewport({ ratio: 1 });
  await skip.click();
  await expect(tourModal).toHaveCount(0);

  await page.goto("/helix/transaction");
  const calculatorTrigger = page.getByRole("button", { name: "Hesap makinesini aç", exact: true });
  await calculatorTrigger.click();
  const calculatorModal = page.locator('[aria-modal="true"]');
  await expect(calculatorModal).toBeVisible();
  const result = page.getByRole("button", { name: /Sonucu Kullan/ });
  await expect(result).toBeInViewport({ ratio: 1 });
  // Every keypad key must be reachable at 390px, not just confirm: a digit below the fold is a dead calculator.
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
  const categoryTrigger = page.getByRole("button", { name: "Kalem", exact: true });
  await categoryTrigger.scrollIntoViewIfNeeded();
  await categoryTrigger.click();
  const selectModal = page.locator('[aria-modal="true"]');
  await expect(selectModal).toBeVisible();
  await expect(selectModal).toBeInViewport({ ratio: 1 });
  const selectHeading = selectModal.getByRole("heading", { name: "Kalem", exact: true });
  await expect(selectHeading).toBeInViewport({ ratio: 1 });
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
  await expect(calendarHeading).toBeInViewport({ ratio: 1 });
  const calendarCancel = calendarModal.getByRole("button", { name: "Vazgeç", exact: true });
  await calendarCancel.scrollIntoViewIfNeeded();
  await expect(calendarCancel).toBeInViewport();
  await calendarCancel.click();
  await expect(calendarModal).toHaveCount(0);
  await expect(dateTrigger).toBeFocused();
  expect(errors).toEqual([]);
});

// RuleRow is only reachable once a rule exists, so sweeps of the empty state missed a nested
// `role="button"` (axe nested-interactive, SC 4.1.2). The press target is now the label column only.
test("RuleRow exposes three sibling controls, not nested interactives", async ({ page }) => {
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
  expect(result.violations, JSON.stringify(result.violations.map((v) => [v.id, v.nodes.map((n) => n.html)]))).toEqual([]);

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
  for (const control of [label, edit, remove]) {
    await expect(control).toHaveAttribute("tabindex", "0");
    await control.focus();
    await expect(control).toBeFocused();
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

  expect(errors).toEqual([]);
});
