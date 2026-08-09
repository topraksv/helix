/**
 * Layout and feedback rules that only a real render can prove: a card's own
 * padding reading evenly, a popup staying inside the viewport, palette
 * persistence, and one stable wait indicator.
 */

import { expect, test, type Page } from "@playwright/test";
import { addMarketExpense, currentMonthKey, isolateExternalData, onboard, openCashFlow, pickOption } from "./helpers";

test.beforeEach(async ({ context }) => isolateExternalData(context));

/** Distance from a container's edge to the first/last child's own text. */
async function verticalInsets(page: Page, insideText: RegExp) {
  return page.getByRole("button", { name: insideText }).evaluate((btn) => {
    let card: HTMLElement | null = btn.parentElement;
    while (card && parseFloat(getComputedStyle(card).borderTopLeftRadius) < 14) card = card.parentElement;
    const box = card!.getBoundingClientRect();
    const kids = Array.from(card!.children) as HTMLElement[];
    const firstRow = (kids[0]!.firstElementChild as HTMLElement | null) ?? kids[0]!;
    return {
      top: +(firstRow.getBoundingClientRect().top - box.top).toFixed(1),
      bottom: +(box.bottom - btn.getBoundingClientRect().bottom).toFixed(1),
    };
  });
}

async function effectiveControlTextContrast(page: Page, label: string): Promise<number> {
  return page.getByRole("button", { name: label, exact: true }).evaluate((button, expectedLabel) => {
    const parse = (value: string): [number, number, number] => {
      const parts = value.match(/[\d.]+/g);
      if (!parts || parts.length < 3) throw new Error(`Unsupported color: ${value}`);
      return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
    };
    const blend = (over: [number, number, number], under: [number, number, number], alpha: number) =>
      over.map((channel, index) => alpha * channel + (1 - alpha) * under[index]!) as [number, number, number];
    const luminance = (rgb: [number, number, number]) =>
      rgb
        .map((channel) => channel / 255)
        .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
        .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index]!, 0);

    const text = Array.from(button.querySelectorAll<HTMLElement>("*"))
      .find((element) => element.children.length === 0 && element.textContent?.trim() === expectedLabel);
    if (!text) throw new Error(`No text node for ${expectedLabel}`);
    let surface = button.parentElement;
    while (surface && getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)") {
      surface = surface.parentElement;
    }
    if (!surface) throw new Error(`No painted surface behind ${expectedLabel}`);
    const under = parse(getComputedStyle(surface).backgroundColor);
    const opacity = Number.parseFloat(getComputedStyle(button).opacity);
    const foreground = blend(parse(getComputedStyle(text).color), under, opacity);
    const background = blend(parse(getComputedStyle(button).backgroundColor), under, opacity);
    const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (lighter! + 0.05) / (darker! + 0.05);
  }, label);
}

test("a card's trailing action leaves the same gap as its first row", async ({ page }) => {
  await onboard(page);
  // A future-dated expense gives the Upcoming card a row and its footer link.
  await page.getByRole("button", { name: "İşlem Ekle" }).first().click();
  await page.getByRole("textbox", { name: "Tutar · TRY" }).fill("750,00");
  await pickOption(page, "Kategori", /Market/);
  await page.getByRole("button", { name: "Ödeme günü" }).click();
  const days = await page.getByRole("button").evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label")).filter((l): l is string => !!l && /^\d{1,2} .+ \d{4}$/u.test(l)));
  expect(days.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: days[days.length - 1]!, exact: true }).click();
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await page.getByRole("tab", { name: "Durum" }).click();

  await expect(page.getByRole("button", { name: /Tüm Takvimi Gör/ })).toBeVisible();
  const insets = await verticalInsets(page, /Tüm Takvimi Gör/);
  // The list may grow naturally, but the action remains anchored to the card's
  // real bottom edge with the same inset as the first row at the top.
  expect(Math.abs(insets.top - insets.bottom)).toBeLessThanOrEqual(1);
});

test("palette preference repaints immediately and survives a reload", async ({ page }) => {
  await onboard(page);
  await page.goto("/helix/settings");
  // Names are the product, ids are storage: the stored value stays `ocean`
  // while the label reads "Petrol", because renaming an id would reset every
  // device that had already chosen a theme.
  const amber = page.getByRole("radio", { name: "Amber", exact: true });
  const petrol = page.getByRole("radio", { name: "Petrol", exact: true });
  await expect(amber).toHaveAttribute("aria-checked", "true");
  const amberFill = await amber.evaluate((element) => getComputedStyle(element).backgroundColor);

  await petrol.click();
  await expect(petrol).toHaveAttribute("aria-checked", "true");
  const petrolFill = await petrol.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(petrolFill).not.toBe(amberFill);
  expect(await page.evaluate(() => localStorage.getItem("helix.palette"))).toBe("ocean");

  await page.reload();
  await expect(page.getByRole("radio", { name: "Petrol", exact: true })).toHaveAttribute("aria-checked", "true");

  // A preference written by a build that shipped `sand` must not strand the
  // app on a palette it no longer has.
  await page.evaluate(() => localStorage.setItem("helix.palette", "sand"));
  await page.reload();
  await expect(page.getByRole("radio", { name: "Amber", exact: true })).toHaveAttribute("aria-checked", "true");
});

test("theme fallback begins with the palette that is leaving", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: undefined });
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await onboard(page);
  await page.goto("/helix/settings");

  await page.getByRole("radio", { name: "Petrol", exact: true }).click();
  const veil = page.getByTestId("theme-dissolve");
  await expect(veil).toBeVisible();
  // The default Amber page background must sit over the fresh Petrol paint at
  // the first frame; using the destination colour here makes a dark/light
  // change snap before the fallback has a chance to soften it.
  await expect.poll(() => veil.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(241, 237, 232)");
  await expect.poll(() => veil.evaluate((element) => getComputedStyle(element).transitionProperty)).toContain("opacity");
  await expect.poll(() => veil.evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration))).toBeGreaterThan(0);
});

test("dragging across the footer still changes tabs", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);

  const tablist = page.getByRole("tablist");
  const box = await tablist.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width * 0.1;
  const subscriptionsX = box!.x + box!.width * 0.5;
  const y = box!.y + box!.height / 2;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(subscriptionsX, y, { steps: 8 });
  await expect(page.getByRole("tab", { name: "Abonelikler", selected: true })).toBeVisible();
  await page.mouse.up();
});

test("mobile web recentres a focused form field without accumulating focus work", async ({ page }) => {
  await page.addInitScript(() => {
    type ScrollCall = boolean | ScrollIntoViewOptions | undefined;
    const target = window as Window & { __helixKeyboardScrollCalls?: ScrollCall[] };
    target.__helixKeyboardScrollCalls = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function scrollIntoView(options?: boolean | ScrollIntoViewOptions) {
      target.__helixKeyboardScrollCalls!.push(options);
      return original.call(this, options);
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);
  await page.goto("/helix/subscription-form");

  const note = page.getByRole("textbox", { name: "Not", exact: true });
  await expect(note).toBeVisible();
  // Let the single root effect attach after the route's first paint; the test
  // then measures the input focus rather than React's mount timing.
  await page.waitForTimeout(250);
  await note.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    (window as Window & { __helixKeyboardScrollCalls?: unknown[] }).__helixKeyboardScrollCalls = [];
  });
  await note.focus();
  await expect.poll(() => page.evaluate(
    () => (window as Window & { __helixKeyboardScrollCalls?: unknown[] }).__helixKeyboardScrollCalls?.length ?? 0,
  )).toBeGreaterThan(0);
  await page.waitForTimeout(280);

  const calls = await page.evaluate(() =>
    (window as Window & { __helixKeyboardScrollCalls?: Array<boolean | ScrollIntoViewOptions | undefined> }).__helixKeyboardScrollCalls ?? [],
  );
  expect(calls).toContainEqual(expect.objectContaining({ block: "center", inline: "nearest" }));
  // One immediate pass plus one after the mobile visual viewport settles. More
  // would reveal that a screen/list mount has registered duplicate listeners.
  expect(calls).toHaveLength(2);
});

test("every tab replays its screen entrance on return", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await onboard(page);

  for (const { tab, heading } of [
    { tab: "Mali Tablo", heading: "Mali Tablo" },
    { tab: "Abonelikler", heading: "Abonelikler" },
    { tab: "Ayarlar", heading: "Ayarlar" },
  ] as const) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    const entrance = page.getByTestId("screen-entrance").filter({
      has: page.getByRole("heading", { name: heading, exact: true }),
    });
    const opacity = () => entrance.evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity));
    await expect.poll(opacity).toBeGreaterThan(0.99);
    await page.getByRole("tab", { name: "Durum", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Durum", exact: true })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect.poll(opacity, { timeout: 500 }).toBeLessThan(0.99);
    await expect.poll(opacity).toBeGreaterThan(0.99);
  }
});

test("returning from an investment editor keeps the tab scaffold settled", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await onboard(page);
  await page.getByRole("tab", { name: "Yatırımlar", exact: true }).click();
  await page.getByRole("button", { name: "Yatırım Alanını Aç", exact: true }).click();
  await page.getByRole("textbox", { name: "Bugünkü serbest yatırım bakiyesi", exact: true }).fill("0");
  await page.getByRole("button", { name: "Yatırım Alanını Aç", exact: true }).click();

  const entrance = page.getByTestId("screen-entrance").filter({
    has: page.getByRole("heading", { name: "Yatırımlar", exact: true }),
  });
  const opacity = () => entrance.evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity));
  await expect.poll(opacity).toBeGreaterThan(0.99);

  await page.getByRole("button", { name: "Yeni Ürün Tanımla" }).click();
  await expect(page).toHaveURL(/investments\/product/);
  await page.getByRole("button", { name: "Geri", exact: true }).click();
  await expect(page).toHaveURL(/investments\/?$/);
  await expect(page.getByRole("tab", { name: "Yatırımlar", selected: true })).toBeVisible();

  // Back is a continuation inside this tab, not a new tab arrival. Sampling
  // consecutive frames catches an accidental full-screen fade without relying
  // on a screenshot or a timing-sensitive exact duration.
  const returnedFrames = await entrance.evaluate(async (element) => {
    const samples: number[] = [];
    for (let frame = 0; frame < 4; frame += 1) {
      samples.push(Number.parseFloat(getComputedStyle(element).opacity));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return samples;
  });
  expect(Math.min(...returnedFrames)).toBeGreaterThan(0.99);
});

test("a later expense stays before incomes in the financial table", async ({ page }) => {
  await onboard(page);
  await page.goto("/helix/columns-editor");
  await page.getByRole("textbox", { name: "Kategori adı", exact: true }).fill("Sonradan eklenen gider");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByRole("button", { name: "Düzenle · Sonradan eklenen gider", exact: true })).toBeVisible();

  await page.goto("/helix/cash-flow");
  await page.getByRole("radio", { name: "Ay odaklı", exact: true }).click();
  const labels = await page.getByTestId("table-row-label").allTextContents();
  expect(labels.indexOf("Sonradan eklenen gider")).toBeGreaterThanOrEqual(0);
  expect(labels.indexOf("Maaş")).toBeGreaterThanOrEqual(0);
  expect(labels.indexOf("Sonradan eklenen gider")).toBeLessThan(labels.indexOf("Maaş"));
});

test("the footer keeps a restrained material in both themes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);

  const readMaterial = () => page.getByRole("tablist").evaluate((element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      background: style.backgroundColor,
      backdrop: style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter"),
      bottom: box.bottom,
      viewportHeight: window.innerHeight,
    };
  });

  const light = await readMaterial();
  expect(light.background).toMatch(/^rgba\(/);
  const lightAlpha = Number(light.background.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1] ?? "1");
  expect(lightAlpha, "mobile footer keeps a solid enough reading surface").toBeGreaterThanOrEqual(0.5);
  expect(light.backdrop).toContain("blur");
  expect(light.bottom).toBeLessThanOrEqual(light.viewportHeight + 1);

  await page.goto("/helix/settings");
  await page.getByRole("radio", { name: "Koyu", exact: true }).click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
  const dark = await readMaterial();
  expect(dark.background).toMatch(/^rgba\(/);
  expect(dark.backdrop).toContain("blur");
  expect(dark.background).not.toBe(light.background);
  expect(dark.bottom).toBeLessThanOrEqual(dark.viewportHeight + 1);
});

/**
 * Navigation is one bar along the bottom at every width. A desktop rail was
 * tried and removed by the owner: it took a column out of the window, so every
 * page's content sat off centre, and the app asked its user to learn two
 * navigations. The contract is that the bar keeps its position and its bounded
 * width from a phone all the way to a wide monitor — and that its labels stay
 * fully opaque over a glass surface, which is the difference between a
 * translucent panel and a faded one.
 */
test("navigation stays a bounded bottom bar at every width", async ({ page }) => {
  await onboard(page);
  await openCashFlow(page);

  const geometry = () => page.getByRole("tablist").evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      x: box.x,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
      background: style.backgroundColor,
      backdrop: style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter"),
    };
  });

  for (const [width, height] of [[390, 844], [768, 1024], [1024, 768], [1440, 900], [1920, 1080]] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole("tab", { name: "Mali Tablo" })).toBeVisible();
    await expect.poll(async () => (await geometry()).width > 0).toBe(true);
    const bar = await geometry();
    expect(bar.width, `the bar runs across the bottom at ${width}`).toBeGreaterThan(bar.height);
    expect(bar.bottom, `the bar stays inside the viewport at ${width}`).toBeLessThanOrEqual(height + 1);
    expect(bar.width, `the bar stays bounded at ${width}`).toBeLessThanOrEqual(560);
    // Content keeps the whole window: nothing stands beside it.
    const heading = await page.getByRole("heading", { name: "Mali Tablo", exact: true }).boundingBox();
    expect(heading!.x, `content is not pushed aside at ${width}`).toBeLessThan(width / 2);
  }

  // Glass: an alpha surface under a blur, with the ink on top at full strength.
  const bar = await geometry();
  const alpha = Number(bar.background.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1] ?? "1");
  expect(alpha, "the navigation surface is translucent").toBeLessThan(0.85);
  expect(bar.backdrop).toContain("blur");
  const labelAlpha = await page.getByRole("tab").evaluateAll((tabs) =>
    tabs.flatMap((tab) =>
      Array.from(tab.querySelectorAll("*"))
        .filter((node) => node.textContent?.trim().length && node.children.length === 0)
        .map((node) => ({
          text: node.textContent!.trim(),
          color: getComputedStyle(node as HTMLElement).color,
          opacity: getComputedStyle(node as HTMLElement).opacity,
        })),
    ));
  expect(labelAlpha.length).toBeGreaterThanOrEqual(5);
  for (const label of labelAlpha) {
    expect(label.color, `"${label.text}" must be fully opaque`).not.toMatch(/rgba\([^)]*,\s*0?\.\d+\)/);
    expect(Number(label.opacity), `"${label.text}" must be fully opaque`).toBe(1);
  }

  // Clicking still routes through the library's cancellable tabPress contract.
  await page.getByRole("tab", { name: "Yatırımlar" }).click();
  await expect(page.getByRole("tab", { name: "Yatırımlar", selected: true })).toBeVisible();
});
test("bar-chart amounts stay readable and contained on phone and desktop", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await onboard(page);
  await addMarketExpense(page, "Sütun grafik tutarı", "987.654.321,00");
  const dashboardMetrics = page.getByTestId("dashboard-month-metrics");
  await expect(dashboardMetrics).toBeVisible();
  await expect.poll(() => dashboardMetrics.innerText()).toMatch(/(?:Mn|Mr|Tr)/u);
  await expect(page.getByTestId("dashboard-current-balance")).toContainText(/(?:Mn|Mr|Tr)/u);
  await page.getByRole("tab", { name: "Durum" }).click();
  await page.getByRole("radio", { name: "Sütun", exact: true }).click();

  for (const width of [320, 390, 1024]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    const labels = page.getByTestId("bar-value-label");
    await expect(labels.first()).toBeVisible();
    const axisLabels = await page.getByTestId("bar-axis-label").allTextContents();
    expect(new Set(axisLabels).size).toBeGreaterThan(2);
    expect(axisLabels.some((label) => !/^[-−]?₺?0(?:[,.]0+)?$/.test(label.trim()))).toBe(true);
    expect(axisLabels.some((label) => /(?:\u00a0|\s)(?:Mn|Mr|Tr)$/u.test(label.trim()))).toBe(true);
    const measurements = await labels.evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        const parent = element.parentElement!.getBoundingClientRect();
        return {
          fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
          contained:
            box.left >= parent.left - 1 &&
            box.right <= parent.right + 1 &&
            box.top >= parent.top - 1 &&
            box.bottom <= parent.bottom + 1 &&
            element.scrollWidth <= element.clientWidth + 1,
        };
      }),
    );
    expect(measurements.every(({ fontSize, contained }) => fontSize >= 14 && contained)).toBe(true);
    const chart = page.getByTestId("bar-chart-frame").first();
    // The frame measures its card after the viewport changes. Assert the
    // post-measurement geometry rather than racing that ResizeObserver pass.
    await expect.poll(() => chart.evaluate((element) => {
      const chartBox = element.getBoundingClientRect();
      const labels = Array.from(element.querySelectorAll<HTMLElement>('[data-testid="bar-axis-label"]'));
      return labels.length > 0 && labels.every((label) => {
        const box = label.getBoundingClientRect();
        return box.left >= chartBox.left - 1 && box.right <= chartBox.right + 1
          && box.top >= chartBox.top - 1 && box.bottom <= chartBox.bottom + 1;
      });
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});

test("clicking a table item opens its month-value bars on desktop and mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await onboard(page);
  await addMarketExpense(page, "Aylık bar görünümü", "999.999,99");

  await page.getByRole("button", { name: "Market", exact: true }).click();
  await expect(page).toHaveURL(/\/cash-flow\/item/);
  await expect(page.getByTestId("month-value-bar")).toHaveCount(12);
  await expect(page.getByTestId("month-value-amount").first()).toBeVisible();

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/helix/cash-flow");
  const matrixValues = page.getByTestId("matrix-value");
  await expect(matrixValues.first()).toBeVisible();
  const matrixGeometry = await matrixValues.evaluateAll((elements) => elements
    .filter((element) => element.textContent?.includes("999"))
    .map((element) => {
      const box = element.getBoundingClientRect();
      const parent = element.parentElement!.getBoundingClientRect();
      return {
        text: element.textContent,
        height: box.height,
        contained: box.left >= parent.left - 1 && box.right <= parent.right + 1 && box.top >= parent.top - 1 && box.bottom <= parent.bottom + 1,
        oneLine: element.scrollHeight <= element.clientHeight + 1,
      };
    }));
  expect(matrixGeometry.length).toBeGreaterThan(0);
  expect(matrixGeometry.every(({ height, contained, oneLine }) => height <= 18 && contained && oneLine)).toBe(true);
  await page.getByRole("link", { name: "Market", exact: true }).click();
  await expect(page).toHaveURL(/\/cash-flow\/item/);
  const bars = page.getByTestId("month-value-bar");
  await expect(bars).toHaveCount(12);
  const barGeometry = await bars.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  expect(barGeometry.every(({ width, height }) => width >= 32 && height >= 6)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

/**
 * A chart is the only thing on a screen that is drawn at an explicit pixel
 * width, so it is the only thing that can be wider than the box holding it.
 * Every caller used to derive that width from the window minus a guess at the
 * chrome in between; once a 220px rail and a two-column dashboard sat between
 * the two, the guess asked for 928px inside a card that had 740. The measure
 * that catches it is the container's own scroll width, at the widths where the
 * rail exists.
 */
test("charts stay inside the box they are drawn in at every desktop width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboard(page);
  await addMarketExpense(page, "Grafik kutusu", "98.765,43");
  await page.getByRole("tab", { name: "Durum" }).click();
  await page.getByRole("radio", { name: "Sütun", exact: true }).click();
  await expect(page.getByTestId("bar-value-label").first()).toBeVisible();

  // 1024 is where the rail appears, 1180 is where the dashboard pairs its
  // columns, 1440 is a real monitor. Each one gives the chart a different box.
  for (const width of [1024, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(async () =>
        page.getByTestId("bar-value-label").first().evaluate((label) => {
          const wider: string[] = [];
          // Up from the drawn label to the page: the card, the column and the
          // screen all have to be wide enough for what the chart asked for.
          for (let el: Element | null = label; el && el !== document.body; el = el.parentElement) {
            if (!(el instanceof HTMLElement)) continue;
            if (el.scrollWidth > el.clientWidth + 1) wider.push(`${el.scrollWidth}>${el.clientWidth}`);
          }
          return wider;
        }),
      )
      .toEqual([]);
  }
});

test("yearly subscriptions ask for a real renewal date", async ({ page }) => {
  await onboard(page);
  await page.goto("/helix/subscription-form");
  await page.getByRole("radio", { name: "Yıllık", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sonraki yenileme tarihi", exact: true })).toBeVisible();
  await expect(page.getByText("Ayın kaçında?", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Yıllık ücretin bir sonraki kez alınacağı tarihi seç.", { exact: true })).toBeVisible();
});

test("subscriptions explain recurrence and summarize the next payment path", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);
  await page.goto("/helix/subscription-form");

  await expect(page.getByRole("img", { name: /Aboneliğin kimliği.*Aylık.*Aylık karşılığı/ })).toBeVisible();
  await expect(page.getByText("Sıradaki ödeme", { exact: true })).toBeVisible();
  await expect(page.getByText("Sonraki tekrar", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Ad", exact: true }).fill("Müzik");
  await page.getByRole("textbox", { name: "Tutar · TRY", exact: true }).fill("199,90");
  await pickOption(page, "Kategori", "Market");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Abonelikler", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /1 aktif abonelik.*31 günde 1 ödeme.*0 otomatik, 1 elle/ })).toBeVisible();
  await expect(page.getByText("Ödeme döngüsü", { exact: true })).toBeVisible();
  await expect(page.getByText("Sıradaki ödeme durakları", { exact: true })).toBeVisible();
  await expect(page.getByText("0/1", { exact: true })).toBeVisible();
  await expect(page.getByText("1 elle takip", { exact: true })).toBeVisible();
  await expect(page.getByText(/TRY aylık karşılığı/)).toBeVisible();
  await expect(page.getByTestId("screen-header").getByRole("button", { name: "Abonelik Ekle", exact: true })).toBeVisible();
  await expect(page.getByTestId("subscription-cycle-summary").getByText("Müzik", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 1200, height: 900 });
  const summary = await page.getByTestId("subscription-cycle-summary").boundingBox();
  expect(summary).not.toBeNull();
  expect(summary!.width).toBeGreaterThan(700);
});

test("a dirty subscription can be dismissed without saving", async ({ page }) => {
  await onboard(page);
  await page.goto("/helix/subscription-form");
  await page.getByRole("textbox", { name: "Ad", exact: true }).fill("Kaydedilmeyecek abonelik");
  await page.getByRole("button", { name: "Geri", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Kaydedilmemiş değişiklikler var", exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(page).toHaveURL(/\/helix\/subscription-form$/);
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await page.getByRole("button", { name: "Değişiklikleri sil", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Abonelikler", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/helix\/subscriptions$/);
});

test("a dirty balance correction can be cancelled, cleared and reopened safely", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);
  const amount = () => page.getByRole("textbox", { name: "Gerçek güncel bakiyen", exact: true });
  const back = () => page.getByRole("button", { name: "Geri", exact: true }).first();

  await page.goto("/helix/opening-balance");
  await amount().fill("100");
  await amount().focus();
  await back().click();
  await expect(page.getByRole("dialog")).toContainText("Kaydedilmemiş değişiklikler var");
  await page.getByRole("dialog").getByRole("button", { name: "Vazgeç", exact: true }).click();
  await amount().fill("");
  await back().click();
  await expect(page).toHaveURL(/\/helix\/cash-flow$/);

  // Re-entering the same route must install a fresh guard, not reuse a stale
  // confirmation or leave a transparent overlay intercepting the next tap.
  await page.goto("/helix/opening-balance");
  await amount().fill("100");
  await back().click();
  await page.getByRole("dialog").getByRole("button", { name: "Değişiklikleri sil", exact: true }).click();
  await expect(page).toHaveURL(/\/helix\/cash-flow$/);
});

test("stack headers keep navigation titles on one line at narrow width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await onboard(page);
  for (const route of ["/helix/opening-balance", "/helix/subscription-form", "/helix/settings/payment-sources"]) {
    await page.goto(route);
    const header = page.getByTestId("navigation-header");
    await expect(header).toBeVisible();
    const metrics = await header.evaluate((element) => {
      const title = element.querySelector<HTMLElement>('[role="heading"]');
      if (!title) throw new Error("navigation header has no title");
      const box = title.getBoundingClientRect();
      return {
        height: box.height,
        scrollHeight: title.scrollHeight,
        clientHeight: title.clientHeight,
      };
    });
    expect(metrics.height).toBeLessThanOrEqual(24);
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
  }
});

test("narrow panel headers keep their title clear of status metadata", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await onboard(page);
  await page.goto("/helix/opening-balance");
  const title = page.getByRole("heading", { name: "Gerçek güncel bakiyen", exact: true });
  await expect(title).toBeVisible();
  const metrics = await title.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { height: box.height, lines: Math.round(element.scrollHeight / box.height) };
  });
  expect(metrics.height).toBeLessThanOrEqual(24);
  expect(metrics.lines).toBe(1);
  await expect(page.getByText("Bakiye eşleşiyor", { exact: true })).toBeVisible();
});

test("a single-person workspace keeps assignment optional and compact", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);
  await page.getByRole("button", { name: "İşlem Ekle" }).first().click();

  await expect(page.getByTestId("person-assignment-hint")).toBeVisible();
  await expect(page.getByText(/Sana ait/)).toBeVisible();
  await expect(page.getByText("Kimin İçin", { exact: true })).toHaveCount(0);
  await page.goto("/helix/settings/persons");
  await expect(page.getByText("Şimdilik yalnızca kendi hesabını izliyorsun.", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Kişi Ekle", exact: true }).fill("Deniz");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByTestId("persons-workspace-secondary").getByText("Deniz", { exact: true })).toBeVisible();
  await page.goto("/helix/transaction");
  await expect(page.getByText("Kimin İçin", { exact: true })).toBeVisible();
  await expect(page.getByTestId("person-assignment-hint")).toHaveCount(0);
});

test("wide tools start on one line with equal work areas", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await onboard(page);
  await page.goto("/helix/settings/tools");
  await expect(page.getByRole("heading", { name: "Araçlar", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Hesap Makinesi", exact: true })).toBeVisible();

  const geometry = await page.getByTestId("calculator-workspace").evaluate((workspace) => {
    const calculator = workspace.querySelector<HTMLElement>('[data-testid="calculator-tool"]')!;
    const converter = workspace.querySelector<HTMLElement>('[data-testid="converter-tool"]')!;
    const calculatorBox = calculator.getBoundingClientRect();
    const converterBox = converter.getBoundingClientRect();
    const calculatorCard = calculator.children[1]!.getBoundingClientRect();
    const converterCard = converter.children[1]!.getBoundingClientRect();
    return {
      calculatorTop: calculatorBox.top,
      converterTop: converterBox.top,
      calculatorWidth: calculatorBox.width,
      converterWidth: converterBox.width,
      calculatorCardTop: calculatorCard.top,
      converterCardTop: converterCard.top,
    };
  });

  expect(Math.abs(geometry.calculatorTop - geometry.converterTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.calculatorCardTop - geometry.converterCardTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.calculatorWidth - geometry.converterWidth)).toBeLessThanOrEqual(1);
});

/**
 * A route with two entrances needs two exits. `/transaction` is the ledger's
 * entry form and, with `intent=investment-refund`, the wallet transfer opened
 * from Investments — and leaving the second one without saving used to walk out
 * into the Financial Table, a different tab, after asking to discard a form the
 * user had not touched. (The form declared itself dirty because its single
 * transfer category is assigned by an effect once the data loads.)
 */
test("leaving the wallet transfer returns to Investments without inventing a draft", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await onboard(page);
  await page.getByRole("tab", { name: "Yatırımlar", exact: true }).click();
  await page.getByRole("button", { name: "Yatırım Alanını Aç", exact: true }).click();
  await page.getByRole("textbox", { name: "Bugünkü serbest yatırım bakiyesi", exact: true }).fill("10.000");
  await page.getByRole("button", { name: "Yatırım Alanını Aç", exact: true }).click();

  await page.getByRole("button", { name: "Serbest Bakiyeyi Aktar" }).click();
  await expect(page.getByRole("heading", { name: "Serbest Bakiyeyi Aktar" })).toBeVisible();

  await page.getByRole("button", { name: "Geri", exact: true }).click();
  // No discard dialog: nothing was edited.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Yatırımlar", selected: true })).toBeVisible();
  await expect(page).toHaveURL(/investments/);
});

test("a mistaken investment journal and its selected ledger refund are removed together @smoke", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await onboard(page);
  await page.getByRole("tab", { name: "Yatırımlar", exact: true }).click();
  await page.getByRole("button", { name: "Yatırım Alanını Aç", exact: true }).click();
  await page.getByRole("textbox", { name: "Bugünkü serbest yatırım bakiyesi", exact: true }).fill("0");
  await page.getByRole("button", { name: "Yatırım Alanını Aç", exact: true }).click();

  await page.getByRole("button", { name: "Yeni Ürün Tanımla" }).click();
  await page.getByRole("radio", { name: "Borsa", exact: true }).click();
  await page.getByRole("textbox", { name: "Ürün adı", exact: true }).fill("Yanlış ürün");
  await page.getByRole("button", { name: "Ürünü Kaydet", exact: true }).click();
  await page.getByRole("button", { name: "Sahip Olduğumu Ekle" }).click();
  await page.getByRole("textbox", { name: "Miktar / adet · zorunlu", exact: true }).fill("1");
  await page.getByRole("textbox", { name: "Birim fiyat · zorunlu", exact: true }).fill("100.000");
  await page.getByRole("button", { name: "Mevcut yatırımı ekle", exact: true }).click();

  await page.getByRole("button", { name: "Satış Yap" }).click();
  await page.getByRole("textbox", { name: "Miktar / adet · zorunlu", exact: true }).fill("1");
  await page.getByRole("textbox", { name: "Birim fiyat · zorunlu", exact: true }).fill("100.000");
  await page.getByRole("button", { name: "Satış yap", exact: true }).click();

  await page.getByRole("button", { name: "Serbest Bakiyeyi Aktar" }).click();
  await page.getByRole("button", { name: "Mali Tabloya Aktar", exact: true }).click();

  await page.getByRole("button", { name: "Düzenle", exact: true }).first().click();
  const removeProduct = page.getByRole("button", { name: "Yatırım Ürününü Kaldır", exact: true });
  await expect(removeProduct).toBeVisible();
  await removeProduct.click();
  await expect(page).toHaveURL(/investments\/correction/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const transfer = page.locator('[data-testid^="investment-correction-transfer-"]');
  await expect(transfer).toHaveCount(1);
  await transfer.click();
  await page.getByRole("button", { name: "Ürünü Tamamen Kaldır", exact: true }).click();
  const confirmation = page.getByRole("dialog");
  await expect(confirmation).toContainText("Mali Tablo aktarımı");
  await confirmation.getByRole("button", { name: "Ürünü Tamamen Kaldır", exact: true }).click();
  await expect(page).toHaveURL(/investments\/?$/);
  await expect(removeProduct).toHaveCount(0);
  await expect(page.getByText("Henüz yatırım ürünü yok", { exact: true })).toBeVisible();
  await expect(page.getByText("Yatırım hareketleri", { exact: true })).toHaveCount(0);
});

test("investment setup, weighted sale, BES contribution and wallet refund form one flow @smoke @cross-browser", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);
  await page.getByRole("tab", { name: "Yatırımlar", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Yatırım alanını başlat", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Yatırım Alanını Aç", exact: true }).click();
  await page.getByRole("textbox", { name: "Bugünkü serbest yatırım bakiyesi", exact: true }).fill("10.000");
  await page.getByRole("button", { name: "Yatırım Alanını Aç", exact: true }).click();
  await expect(page.getByText("Serbest nakit ve ürün maliyetleri", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("screen-header").getByRole("button", { name: "İşlem Ekle", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Yeni Ürün Tanımla" }).click();
  await page.getByRole("radio", { name: "Borsa", exact: true }).click();
  await page.getByRole("textbox", { name: "Ürün adı", exact: true }).fill("SASA");
  await page.getByRole("button", { name: "Ürünü Kaydet", exact: true }).click();

  await page.getByTestId("screen-header").getByRole("button", { name: "İşlem Ekle", exact: true }).click();
  await page.getByRole("textbox", { name: "Miktar / adet · zorunlu", exact: true }).fill("10");
  await page.getByRole("textbox", { name: "Birim fiyat · zorunlu", exact: true }).fill("100");
  await page.getByRole("textbox", { name: "Toplam TRY · isteğe bağlı", exact: true }).fill("2.000");
  await expect(page.getByRole("alert")).toContainText("birbiriyle uyuşmuyor");
  await page.getByRole("textbox", { name: "Toplam TRY · isteğe bağlı", exact: true }).fill("1.000");
  await page.getByRole("button", { name: "Alış ekle", exact: true }).click();
  await expect(page.getByText("SASA", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Satış Yap" }).click();
  await page.getByRole("textbox", { name: "Miktar / adet · zorunlu", exact: true }).fill("4");
  await page.getByRole("textbox", { name: "Birim fiyat · zorunlu", exact: true }).fill("150");
  await page.getByRole("button", { name: "Satış yap", exact: true }).click();
  await expect(page.getByText("₺200,00", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Yeni Ürün Tanımla" }).click();
  await page.getByRole("radio", { name: "BES", exact: true }).click();
  await page.getByRole("textbox", { name: "Ürün adı", exact: true }).fill("Emeklilik Planım");
  await page.getByRole("button", { name: "Ürünü Kaydet", exact: true }).click();
  await page.getByTestId("screen-header").getByRole("button", { name: "İşlem Ekle", exact: true }).click();
  await pickOption(page, "Ürün", "Emeklilik Planım · BES");
  await page.getByRole("radio", { name: "Yalnız katkı tutarı", exact: true }).click();
  await page.getByRole("textbox", { name: "Toplam katkı · zorunlu", exact: true }).fill("500");
  await page.getByRole("button", { name: "BES katkısı ekle", exact: true }).click();
  await expect(page.getByText("Pay bilgisi yok", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Serbest Bakiyeyi Aktar" }).click();
  await page.getByRole("radio", { name: "Bir kısmı", exact: true }).click();
  await page.getByRole("textbox", { name: "Aktarılacak tutar", exact: true }).fill("100");
  await page.getByRole("button", { name: "Mali Tabloya Aktar", exact: true }).click();
  await expect(page.getByText("₺9.000,00", { exact: true }).first()).toBeVisible();

  // Expo Router keeps every tab mounted, so `getByTestId` can resolve inside a
  // screen that is not on top — and a hidden screen never re-measures, so it
  // answers geometry questions with its LAST layout. Landing on Investments
  // explicitly, then resizing, is what makes the measurements below about the
  // screen the user is actually looking at. Without it this test failed two
  // full runs in three while passing in isolation, and CI's single retry hid
  // it every time.
  await page.getByRole("tab", { name: "Yatırımlar" }).click();
  await expect(page.getByRole("tab", { name: "Yatırımlar", selected: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByTestId("investment-distribution-chart")).toBeVisible();
  const walletGeometry = await page.getByTestId("investment-wallet-summary").evaluate((wallet) => {
    const cash = wallet.querySelector<HTMLElement>('[data-testid="investment-cash-amount"]')!;
    const transfers = wallet.querySelector<HTMLElement>('[data-testid="investment-transfer-summary"]')!;
    const metrics = wallet.querySelector<HTMLElement>('[data-testid="investment-portfolio-metrics"]')!;
    const chart = wallet.querySelector<HTMLElement>('[data-testid="investment-distribution-chart"]')!;
    const box = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
    };
    return { cash: box(cash), transfers: box(transfers), metrics: box(metrics), chart: box(chart) };
  });
  expect(walletGeometry.chart.left).toBeGreaterThan(walletGeometry.cash.right);
  expect(walletGeometry.chart.width).toBeGreaterThan(walletGeometry.cash.width);
  expect(walletGeometry.metrics.left).toBeCloseTo(walletGeometry.cash.left, 0);
  expect(walletGeometry.metrics.top).toBeGreaterThanOrEqual(walletGeometry.transfers.bottom - 1);

  const productItems = page.locator('[data-testid^="investment-products-item-"]');
  const productGeometry = await productItems.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  }));
  expect(productGeometry.length).toBeGreaterThanOrEqual(2);
  expect(productGeometry.every((box) => Math.abs(box.left - productGeometry[0]!.left) <= 1)).toBe(true);
  expect(productGeometry[1]!.top).toBeGreaterThan(productGeometry[0]!.top);
  await page.getByRole("radio", { name: "Borsa", exact: true }).click();
  await expect(page.locator('[data-testid^="investment-products-item-"]')).toHaveCount(1);
  await page.getByRole("radio", { name: "Tümü", exact: true }).click();
  await expect(page.locator('[data-testid^="investment-products-item-"]')).toHaveCount(2);
});

test("the investment wallet keeps large balances readable at the narrowest phone width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await onboard(page);
  await page.getByRole("tab", { name: "Yatırımlar", exact: true }).click();
  await page.getByRole("button", { name: "Yatırım Alanını Aç", exact: true }).click();
  await page.getByRole("textbox", { name: "Bugünkü serbest yatırım bakiyesi", exact: true }).fill("987.654.321.000");
  await page.getByRole("button", { name: "Yatırım Alanını Aç", exact: true }).click();

  const summary = page.getByTestId("investment-wallet-summary");
  const cash = page.getByTestId("investment-cash-amount");
  await expect(cash).toHaveAttribute("aria-label", /^Serbest bakiye: ₺987\.654\s+Mr$/u);
  const geometry = await summary.evaluate((element) => {
    const parent = element.getBoundingClientRect();
    const cashAmount = element.querySelector<HTMLElement>('[data-testid="investment-cash-amount"]')!;
    const amount = cashAmount.getBoundingClientRect();
    const descendantsFit = Array.from(element.querySelectorAll<HTMLElement>("*")).every((child) => {
      const box = child.getBoundingClientRect();
      return box.width === 0 || (box.left >= parent.left - 1 && box.right <= parent.right + 1);
    });
    return {
      parentLeft: parent.left,
      parentRight: parent.right,
      amountLeft: amount.left,
      amountRight: amount.right,
      amountFontSize: parseFloat(getComputedStyle(cashAmount).fontSize),
      descendantsFit,
    };
  });
  expect(geometry.amountLeft).toBeGreaterThanOrEqual(geometry.parentLeft - 1);
  expect(geometry.amountRight).toBeLessThanOrEqual(geometry.parentRight + 1);
  expect(geometry.amountFontSize).toBeGreaterThanOrEqual(24);
  expect(geometry.descendantsFit).toBe(true);
  await expect(page.getByTestId("investment-mobile-allocation")).toBeVisible();

  const fill = page.getByTestId("investment-allocation-fill").first();
  await expect(fill).toBeVisible();
  const widths = await fill.evaluate(async (element) => {
    const samples: number[] = [];
    for (let frame = 0; frame < 6; frame += 1) {
      samples.push(element.getBoundingClientRect().width);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return samples;
  });
  expect(new Set(widths.map((width) => Math.round(width * 10) / 10)).size).toBeGreaterThan(1);
  const actionBand = page.locator('[data-testid="investment-actions"]:visible').first();
  const actions = actionBand.getByRole("button");
  await expect(actions).toHaveCount(4);
  const actionGeometry = await actions.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), width: Math.round(box.width) };
  }));
  expect(new Set(actionGeometry.map(({ left }) => left)).size).toBe(4);
  expect(new Set(actionGeometry.map(({ top }) => top)).size).toBe(1);
  expect(Math.max(...actionGeometry.map(({ width }) => width)) - Math.min(...actionGeometry.map(({ width }) => width))).toBeLessThanOrEqual(1);
  expect(Math.max(...actionGeometry.map(({ right }) => right))).toBeLessThanOrEqual(320 - 16);

  const bandGeometry = await actionBand.evaluate((element) => {
    const band = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const boxes = (selector: string) => Array.from(element.querySelectorAll<HTMLElement>(selector)).map((child) => {
      const box = child.getBoundingClientRect();
      return { top: box.top, left: box.left, right: box.right, bottom: box.bottom };
    });
    return {
      band: { left: band.left, right: band.right, top: band.top, bottom: band.bottom },
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      icons: boxes('[data-testid="investment-action-icon"]'),
      labels: boxes('[data-testid="investment-action-label"]'),
      captions: boxes('[data-testid="investment-action-caption"]'),
    };
  });
  expect(bandGeometry.padding).toEqual(["0px", "0px", "0px", "0px"]);
  const narrowBandHeight = bandGeometry.band.bottom - bandGeometry.band.top;
  expect(narrowBandHeight).toBeGreaterThan(0);
  expect(bandGeometry.icons.every(({ top }) => top === bandGeometry.icons[0]!.top)).toBe(true);
  expect(bandGeometry.labels.every(({ top }) => top === bandGeometry.labels[0]!.top)).toBe(true);
  expect(bandGeometry.captions.every(({ top }) => top === bandGeometry.captions[0]!.top)).toBe(true);
  expect(actionGeometry[0]!.left).toBeGreaterThanOrEqual(bandGeometry.band.left - 1);
  expect(actionGeometry[actionGeometry.length - 1]!.right).toBeLessThanOrEqual(bandGeometry.band.right + 1);

  const actionTextGeometry = await actions.evaluateAll((elements) => elements.map((element) => {
    const textNodes = Array.from(element.querySelectorAll<HTMLElement>("*"))
      .filter((node) => node.children.length === 0 && node.textContent?.trim())
      .map((node) => ({ text: node.textContent!.trim(), box: node.getBoundingClientRect() }));
    const label = textNodes.find(({ text }) => !text.includes("döner") && !text.includes("düşmez") && !text.includes("yok") && !text.includes("çıkar"));
    const caption = textNodes.find(({ text }) => text.includes("döner") || text.includes("düşmez") || text.includes("yok") || text.includes("çıkar"));
    if (!label || !caption) throw new Error(`Missing investment action text in ${element.getAttribute("aria-label")}`);
    return {
      labelTop: Math.round(label.box.top),
      labelBottom: Math.round(label.box.bottom),
      captionTop: Math.round(caption.box.top),
      captionBottom: Math.round(caption.box.bottom),
    };
  }));
  expect(new Set(actionTextGeometry.map(({ labelTop }) => labelTop)).size).toBe(1);
  expect(new Set(actionTextGeometry.map(({ captionTop }) => captionTop)).size).toBe(1);
  expect(actionTextGeometry.every(({ labelBottom, captionTop }) => labelBottom <= captionTop + 1)).toBe(true);

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(() => actionBand.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(narrowBandHeight);
  const wideBandGeometry = await actionBand.evaluate((element) => {
    const band = element.getBoundingClientRect();
    const boxes = (selector: string) => Array.from(element.querySelectorAll<HTMLElement>(selector)).map((child) => {
      const box = child.getBoundingClientRect();
      return { top: Math.round(box.top), bottom: Math.round(box.bottom) };
    });
    return {
      band: { top: band.top, bottom: band.bottom },
      icons: boxes('[data-testid="investment-action-icon"]'),
      labels: boxes('[data-testid="investment-action-label"]'),
      captions: boxes('[data-testid="investment-action-caption"]'),
    };
  });
  const wideBandHeight = wideBandGeometry.band.bottom - wideBandGeometry.band.top;
  expect(wideBandHeight).toBeLessThan(narrowBandHeight);
  expect(wideBandGeometry.icons.every(({ top }) => top === wideBandGeometry.icons[0]!.top)).toBe(true);
  expect(wideBandGeometry.labels.every(({ top }) => top === wideBandGeometry.labels[0]!.top)).toBe(true);
  expect(wideBandGeometry.captions.every(({ top }) => top === wideBandGeometry.captions[0]!.top)).toBe(true);

  const metricTextGeometry = await page.getByTestId("investment-portfolio-metrics").evaluate((element) => {
    const columns = Array.from(element.children) as HTMLElement[];
    return columns.map((column) => {
      const valueWrapper = column.lastElementChild as HTMLElement | null;
      const value = valueWrapper?.firstElementChild as HTMLElement | null;
      if (!value) throw new Error("Missing investment portfolio metric value");
      const box = value.getBoundingClientRect();
      const wrapperBox = valueWrapper!.getBoundingClientRect();
      return {
        fontSize: Number.parseFloat(getComputedStyle(value).fontSize),
        bottom: Math.round(box.bottom),
        valueHeight: Math.round(box.height),
        wrapperBottom: Math.round(wrapperBox.bottom),
      };
    });
  });
  expect(metricTextGeometry.length).toBeGreaterThanOrEqual(2);
  expect(Math.max(...metricTextGeometry.map(({ fontSize }) => fontSize)) - Math.min(...metricTextGeometry.map(({ fontSize }) => fontSize))).toBeLessThanOrEqual(0.5);
  expect(new Set(metricTextGeometry.map(({ bottom }) => bottom)).size).toBe(1);

  await page.getByRole("button", { name: "Serbest Bakiyeyi Aktar. Mali tabloya çıkar", exact: true }).click();
  const refundAmount = page.getByTestId("investment-refund-cash-amount");
  await expect(refundAmount).toBeVisible();
  const refundGeometry = await refundAmount.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const parent = element.parentElement!.getBoundingClientRect();
    return { left: box.left, right: box.right, parentLeft: parent.left, parentRight: parent.right };
  });
  expect(refundGeometry.left).toBeGreaterThanOrEqual(refundGeometry.parentLeft - 1);
  expect(refundGeometry.right).toBeLessThanOrEqual(refundGeometry.parentRight + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("the financial-table tools are one control, one row, at every width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await onboard(page);
  await page.goto("/helix/cash-flow");

  await expect(page.getByTestId("screen-header").getByRole("button", { name: "İşlem Ekle", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("screen-header").getByText(/^\d{4}$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "İşlem Ekle", exact: true })).toBeVisible();

  // ONE toolbar at every width. It used to be six labelled buttons above a
  // tablet and five 9px-captioned icon tiles below it — same five
  // destinations, two control languages, two label sets, so the screen had to
  // be relearned when the window changed.
  const toolRow = page.locator("text=/^(Kolonlar|Taksitler|Analiz|Geçmiş Ay|Başlangıç)$/");
  const measure = async () => {
    const tools = page.getByRole("button").filter({ has: toolRow });
    await expect(tools).toHaveCount(5);
    return tools.evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        const caption = element.querySelector("div:last-child") ?? element;
        return {
          top: Math.round(box.top),
          height: Math.round(box.height),
          captionSize: Math.round(Number.parseFloat(getComputedStyle(caption).fontSize)),
        };
      }),
    );
  };

  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(150);
    const boxes = await measure();
    expect(new Set(boxes.map(({ top }) => top)).size, `${width}px: one row`).toBe(1);
    expect(new Set(boxes.map(({ height }) => height)).size, `${width}px: one height`).toBe(1);
    expect(boxes[0]!.height, `${width}px: platform minimum`).toBeGreaterThanOrEqual(44);
    // The caption is a declared role, never a bespoke size under the scale.
    expect(boxes.every((box) => box.captionSize >= 11), `${width}px: legible caption`).toBe(true);
  }
});

test("pivoting the financial table resets unrelated offsets and keeps complete columns", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await onboard(page);
  await page.goto("/helix/cash-flow");

  await expect(page.getByRole("radio", { name: "Kolon odaklı" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("link", { name: "Kredi Kartı", exact: true })).toBeVisible();
  const visibleMonths = await page.getByTestId("table-horizontal-header").getByRole("button").evaluateAll((buttons) => {
    // The scroller itself is the viewport; walking up a fixed number of parents
    // encoded the wrapper depth instead.
    const viewport = buttons[0]?.closest('[data-testid="table-horizontal-header"]')?.getBoundingClientRect();
    if (!viewport) return [];
    return buttons
      .map((button) => {
        const box = button.getBoundingClientRect();
        return { name: button.getAttribute("aria-label"), left: box.left, right: box.right };
      })
      .filter(({ name, left, right }) =>
        name != null
        && !name.startsWith("Sabitle")
        && !name.startsWith("Sabitlemeyi kaldır")
        && right > viewport.left
        && left < viewport.right,
      )
      .map(({ name, left, right }) => ({
        name,
        left,
        right,
        viewportLeft: viewport.left,
        viewportRight: viewport.right,
      }));
  });
  expect(visibleMonths.length).toBeGreaterThanOrEqual(2);
  expect(visibleMonths.every(({ left, right, viewportLeft, viewportRight }) =>
    left >= viewportLeft - 1 && right <= viewportRight + 1
  )).toBe(true);
  await page.getByRole("radio", { name: "Satır odaklı" }).click();
  const firstCategory = page.getByRole("button", { name: "Kredi Kartı", exact: true });
  await expect(firstCategory).toBeVisible();
  const box = await firstCategory.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(16);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320 - 16);
});

test("supplementary financial-table details collapse without losing recovery", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await onboard(page);
  await page.goto("/helix/cash-flow");

  const details = page.getByRole("button", { name: "Mali tabloyu okuma rehberi", exact: true });
  const guide = page.getByTestId("cash-flow-table-details-content");
  await expect(details).toBeVisible();
  // Collapsed means unreachable, not absent: the panel stays mounted so it can
  // open and close instead of blinking, and is hidden from assistive
  // technology and from the pointer while it is closed.
  await expect(guide).toBeHidden();
  const initialGeometry = await details.evaluate((element) => {
    const button = element.getBoundingClientRect();
    const segment = element.closest<HTMLElement>('[role="radiogroup"]')!.getBoundingClientRect();
    return { buttonHeight: button.height, segmentHeight: segment.height };
  });
  expect(Math.abs(initialGeometry.buttonHeight - initialGeometry.segmentHeight)).toBeLessThanOrEqual(1);
  const table = page.getByTestId("cash-flow-matrix-table");
  const collapsedHeight = (await table.boundingBox())!.height;
  await details.click();
  await expect(guide).toBeVisible();
  await expect.poll(async () => (await table.boundingBox())!.height).toBeLessThan(collapsedHeight - 20);
  const expandedHeight = (await table.boundingBox())!.height;
  expect(collapsedHeight - expandedHeight).toBeGreaterThan(20);
  await details.click();
  await expect(guide).toBeHidden();
  await expect.poll(async () => (await table.boundingBox())!.height).toBeGreaterThanOrEqual(collapsedHeight - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  // Closing it is a statement about what this reader already knows, so it
  // survives a reload and a change of width. Re-teaching the grammar on every
  // visit is what the owner asked to stop.
  await page.reload();
  await expect(page.getByRole("button", { name: "Mali tabloyu okuma rehberi", exact: true })).toBeVisible();
  await expect(guide).toBeHidden();

  await page.setViewportSize({ width: 768, height: 844 });
  await page.goto("/helix/cash-flow");
  const desktopDetails = page.getByRole("button", { name: "Mali tabloyu okuma rehberi", exact: true });
  await expect(desktopDetails).toBeVisible();
  await expect(guide).toBeHidden();
  const desktopTable = page.getByTestId("cash-flow-matrix-table");
  const desktopClosedHeight = (await desktopTable.boundingBox())!.height;
  await desktopDetails.click();
  await expect(guide).toBeVisible();
  await expect.poll(async () => (await desktopTable.boundingBox())!.height).toBeLessThan(desktopClosedHeight - 20);
  await desktopDetails.click();
  await expect(guide).toBeHidden();
});

test("desktop action systems use intentional full-width or single-stream geometry", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await onboard(page);

  await page.goto("/helix/cash-flow");
  const toolbar = page.getByTestId("cash-flow-action-toolbar");
  await expect(toolbar).toBeVisible();
  const toolbarBox = await toolbar.boundingBox();
  const contentBox = await page.getByTestId("screen-header").locator("..").boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(toolbarBox!.width).toBeGreaterThanOrEqual(contentBox!.width * 0.9);

  await page.goto("/helix/subscription-form");
  const behavior = page.getByText("Takip ve otomasyon", { exact: true });
  await expect(behavior).toBeVisible();
  const behaviorCard = behavior.locator("..").locator("..");
  const behaviorBox = await behaviorCard.boundingBox();
  const formBox = await page.getByTestId("subscription-form-workspace").boundingBox();
  expect(behaviorBox).not.toBeNull();
  expect(formBox).not.toBeNull();
  expect(behaviorBox!.width).toBeGreaterThanOrEqual(formBox!.width * 0.9);

  await page.goto("/helix/reconciliation");
  const grid = page.getByTestId("reconciliation-grid");
  // A clean onboarding workspace has no due recurring items, so the route
  // intentionally renders its empty state instead of an empty grid. When the
  // fixture contains pending items, the actual grid must still stay a single
  // readable stream on desktop.
  if (await grid.count() === 0) {
    await expect(page.getByText("Onay bekleyen bir şey yok, güncelsin ✅", { exact: true })).toBeVisible();
    return;
  }
  await expect(grid).toBeVisible();
  const items = grid.locator('[data-testid^="reconciliation-grid-item-"]');
  const itemCount = await items.count();
  if (itemCount > 1) {
    const boxes = await items.evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { left: Math.round(box.left), width: Math.round(box.width) };
    }));
    expect(new Set(boxes.map(({ left }) => left)).size).toBe(1);
    expect(new Set(boxes.map(({ width }) => width)).size).toBe(1);
  }
});

test("investment summary keeps financial meaning grouped on phone and desktop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);
  await page.goto("/helix/investments");
  await page.getByRole("button", { name: "Yatırım Alanını Aç", exact: true }).click();
  await page.getByRole("textbox", { name: "Bugünkü serbest yatırım bakiyesi", exact: true }).fill("100000");
  await page.getByRole("button", { name: "Yatırım Alanını Aç", exact: true }).click();
  await page.getByRole("button", { name: "Yeni Ürün Tanımla" }).click();
  await page.getByRole("radio", { name: "Borsa", exact: true }).click();
  await page.getByRole("textbox", { name: "Ürün adı", exact: true }).fill("Uzun Vadeli Büyüme Sepeti");
  await page.getByRole("button", { name: "Ürünü Kaydet", exact: true }).click();
  await page.getByTestId("screen-header").getByRole("button", { name: "İşlem Ekle", exact: true }).click();
  await pickOption(page, "Ürün", "Uzun Vadeli Büyüme Sepeti · Borsa");
  await page.getByRole("textbox", { name: "Miktar / adet · zorunlu", exact: true }).fill("12");
  await page.getByRole("textbox", { name: "Birim fiyat · zorunlu", exact: true }).fill("1.250");

  const summary = page.getByTestId("investment-operation-summary");
  await expect(summary).toContainText("Uzun Vadeli Büyüme Sepeti");
  await expect(summary).toContainText("İşlem tarihi");
  await expect(summary).toContainText("Bakiye etkisi");
  await expect(summary).toContainText("Hesaplanan toplam");
  const mobileBox = await summary.boundingBox();
  expect(mobileBox).not.toBeNull();
  expect(mobileBox!.x).toBeGreaterThanOrEqual(16);
  expect(mobileBox!.x + mobileBox!.width).toBeLessThanOrEqual(390 - 16);

  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopBox = await summary.boundingBox();
  expect(desktopBox).not.toBeNull();
  expect(desktopBox!.width).toBeGreaterThan(600);
  expect(desktopBox!.x + desktopBox!.width).toBeLessThanOrEqual(1440 - 16);
});

test("month notes use the note content as their marker without a duplicate title", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);
  await addMarketExpense(page, "Not başlığı tekrarlanmamalı");
  await page.goto(`/helix/cash-flow/${currentMonthKey()}`);

  const market = page.getByRole("button", { name: /Market/ }).first();
  await expect(market).toBeVisible();
  await market.click();
  const note = page.getByRole("textbox", { name: "Hücre notu", exact: true });
  await note.fill("Bu içerik başlık yerine görünür.");
  await page.getByRole("button", { name: "Kaydet", exact: true }).last().click();
  await expect(market).toContainText("Bu içerik başlık yerine görünür.");
  expect(await market.getByText("Not", { exact: true }).count()).toBe(0);
});

test("lifecycle confirmations carry the operation context after the action", async ({ page }) => {
  await onboard(page);
  await page.goto("/helix/settings");

  const signOutCard = page.getByTestId("account-sign-out-card");
  const signOutAction = signOutCard.getByTestId("account-sign-out-action");
  await expect(signOutAction).toBeVisible();
  expect((await signOutAction.boundingBox())!.height).toBeLessThan(90);
  const signOutButton = signOutAction.getByRole("button", { name: /Çıkış yap/ });
  await expect(signOutButton).toBeVisible();

  await signOutButton.click();
  await expect(page.getByTestId("operation-dialog-header")).toBeVisible();
  await expect(page.getByTestId("operation-dialog-message")).toContainText("Cihazdan ayrılmadan önce");
  await expect(page.getByTestId("operation-dialog-plan")).toContainText("Önce yedek al");
  await expect(page.getByTestId("operation-dialog-header")).toContainText("Cihazdan ayrıl");
  await expect(page.getByTestId("operation-dialog-header")).toContainText("Bu cihazdaki veriler silinir");
  await expect(page.getByTestId("operation-dialog-header")).toContainText("Önce yedek al");
  await expect(page.getByTestId("operation-dialog-header").getByText("Tüm veriler silinecek", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(page.getByTestId("operation-dialog-header")).toHaveCount(0);

  // A CLOUD account ends on Account Security, beside the reversible version of
  // the same decision — asserted in `tests/operation-guard.test.ts`, because
  // this export runs local-only and that screen redirects away. What a
  // local-only workspace has is this one row, here, and the dialog it opens is
  // the same one.
  const deleteAction = page.getByTestId("account-delete-action");
  await expect(deleteAction).toBeVisible();
  expect((await deleteAction.boundingBox())!.height).toBeLessThan(90);
  await expect(deleteAction.getByRole("button", { name: /Hesabı sil/i })).toBeVisible();
  await deleteAction.getByRole("button", { name: /Hesabı sil/i }).click();
  await expect(page.getByTestId("operation-dialog-header")).toBeVisible();
  await expect(page.getByTestId("operation-dialog-header")).toContainText("Kalıcı silme");
  await expect(page.getByTestId("operation-dialog-message")).toContainText("Kalıcı silme kapsamı");
  await expect(page.getByTestId("operation-dialog-plan")).toContainText("Son kontrol");
  await expect(page.getByTestId("operation-dialog-header")).toContainText("Mali tablo, işlemler ve taksitler");
  await expect(page.getByTestId("operation-dialog-header").getByText("Hesabı sil", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/helix/settings");
  await page.getByTestId("account-sign-out-action").getByRole("button", { name: /Çıkış yap/ }).click();
  const mobileSurface = page.getByTestId("operation-dialog-surface");
  await expect(mobileSurface).toBeVisible();
  const mobileBox = await mobileSurface.boundingBox();
  expect(mobileBox).not.toBeNull();
  expect(mobileBox!.x).toBeGreaterThanOrEqual(0);
  expect(mobileBox!.x + mobileBox!.width).toBeLessThanOrEqual(390);
  expect(mobileBox!.y).toBeGreaterThanOrEqual(0);
  expect(mobileBox!.y + mobileBox!.height).toBeLessThanOrEqual(844);
  await expect(page.getByTestId("operation-dialog-header")).toContainText("Önce yedek al");
});

test("empty settings contexts return desktop width to the active editor", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboard(page);
  for (const [route, testID] of [
    ["/helix/settings/budgets", "budgets-workspace"],
    ["/helix/settings/computed-columns", "computed-columns-workspace"],
    ["/helix/settings/incomes", "incomes-workspace"],
    ["/helix/settings/payment-sources", "payment-sources-workspace"],
  ] as const) {
    await page.goto(route);
    const workspace = page.getByTestId(testID);
    await expect(workspace).toBeVisible();
    const primary = await workspace.getByTestId(`${testID}-primary`).boundingBox();
    const secondary = await workspace.getByTestId(`${testID}-secondary`).boundingBox();
    expect(primary).not.toBeNull();
    expect(secondary).not.toBeNull();
    expect(Math.abs(primary!.x - secondary!.x)).toBeLessThanOrEqual(2);
  }
});

test("compact financial-table pins stay beside headers and month labels keep breathing room", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await onboard(page);
  await page.goto("/helix/cash-flow");

  const assertPinBesideLabel = async (pinName: string, label: string) => {
    const metrics = await page.getByRole("button", { name: pinName, exact: true }).evaluate((pin, expectedLabel) => {
      const marker = pin.parentElement!;
      const header = marker.parentElement!;
      const labelNode = Array.from(header.querySelectorAll<HTMLElement>(
        '[data-testid="table-column-label"]',
      )).find((node) => node.textContent?.replace(/\u200B/g, "") === expectedLabel)!;
      const pinBox = pin.getBoundingClientRect();
      const headerBox = header.getBoundingClientRect();
      const labelBox = labelNode.getBoundingClientRect();
      return {
        headerHeight: headerBox.height,
        pinRightInset: headerBox.right - pinBox.right,
        pinCenterY: pinBox.top + pinBox.height / 2,
        labelCenterY: labelBox.top + labelBox.height / 2,
      };
    }, label);
    expect(metrics.headerHeight).toBeLessThanOrEqual(56);
    expect(metrics.pinRightInset).toBeLessThanOrEqual(2);
    expect(Math.abs(metrics.pinCenterY - metrics.labelCenterY)).toBeLessThanOrEqual(2);
  };

  await page.getByRole("radio", { name: "Satır odaklı" }).click();
  await assertPinBesideLabel("Kredi Kartı kolonunu sabitle", "Kredi Kartı");
  const billsHeader = await page.getByTestId("table-column-label").filter({ hasText: "Faturalar" }).first().boundingBox();
  expect(billsHeader).not.toBeNull();
  expect(billsHeader!.height).toBeLessThanOrEqual(30);
  const year = currentMonthKey().slice(0, 4);
  for (const month of ["Temmuz", "Ağustos"]) {
    const metrics = await page.getByRole("link", { name: `${month} ${year}`, exact: true }).evaluate((row) => {
      const text = row.querySelector<HTMLElement>('[data-testid="table-row-label"]')!;
      const rowBox = row.getBoundingClientRect();
      const textBox = text.getBoundingClientRect();
      return {
        visibleLabel: text.textContent?.replace(/\u200B/g, ""),
        left: textBox.left - rowBox.left,
        right: rowBox.right - textBox.right,
        height: textBox.height,
      };
    });
    expect(metrics.visibleLabel).toBe(month);
    expect(metrics.left).toBeGreaterThanOrEqual(11);
    expect(metrics.right).toBeGreaterThanOrEqual(11);
    expect(metrics.height).toBeLessThanOrEqual(18);
  }

  await page.getByRole("radio", { name: "Kolon odaklı" }).click();
  await assertPinBesideLabel("Temmuz kolonunu sabitle", "Tem");
});

test("bulk entry gives long item names more room than bounded amounts", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);
  await page.goto("/helix/bulk-entry");

  const field = page.getByRole("textbox", { name: /Kredi Kartı/ }).first();
  const widths = await field.evaluate((input) => {
    const inputBox = input.parentElement!.getBoundingClientRect();
    const row = input.parentElement!.parentElement!;
    const labelBox = row.firstElementChild!.getBoundingClientRect();
    return { input: inputBox.width, label: labelBox.width };
  });
  expect(widths.label).toBeGreaterThan(widths.input);
  expect(widths.input).toBeLessThanOrEqual(156);
});

test("column builders align their functional graphics at the same card depth", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);
  await page.goto("/helix/columns-editor");
  const categoryGraphic = page.getByTestId("category-ledger-map");
  await expect(categoryGraphic).toBeVisible();
  const categoryInset = await categoryGraphic.evaluate((graphic) => {
    const card = graphic.parentElement!;
    return Math.round(graphic.getBoundingClientRect().top - card.getBoundingClientRect().top);
  });

  await page.getByRole("radio", { name: "Hesaplanan Kolonlar", exact: true }).click();
  const computedGraphic = page.getByTestId("calculation-flow");
  await expect(computedGraphic).toBeVisible();
  const computedInset = await computedGraphic.evaluate((graphic) => {
    const card = graphic.parentElement!;
    return Math.round(graphic.getBoundingClientRect().top - card.getBoundingClientRect().top);
  });
  expect(categoryInset).toBe(computedInset);
});

test("shared selection tiles search, toggle and reflow long labels consistently", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/helix/");
  await page.getByRole("button", { name: "Kurulumu Özelleştir", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /Kredi Kartı/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Seçeneklerde ara", exact: true })).toBeVisible();

  await onboard(page);
  await page.goto("/helix/settings/categories");

  const longName = "Kredi kartı tek çekim ödeme planı ve yıllık aidatlar";
  await page.getByRole("button", { name: "Düzenle · Kredi Kartı", exact: true }).click();
  await page.getByRole("textbox", { name: "Düzenle · Kredi Kartı", exact: true }).fill(longName);
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByRole("button", { name: `Düzenle · ${longName}`, exact: true })).toBeVisible();

  await page.goto("/helix/settings/computed-columns");
  const option = page.getByRole("checkbox", { name: longName, exact: true });
  await expect(option).toHaveAttribute("aria-checked", "false");
  const optionMetrics = await option.evaluate((element, expectedLabel) => {
    const box = element.getBoundingClientRect();
    const label = Array.from(element.querySelectorAll<HTMLElement>("*"))
      .find((child) => child.children.length === 0 && child.textContent?.trim() === expectedLabel);
    return {
      height: box.height,
      contained: label ? label.scrollWidth <= label.clientWidth + 1 : false,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, longName);
  expect(optionMetrics.height).toBeGreaterThan(48);
  expect(optionMetrics.contained).toBe(true);
  expect(optionMetrics.pageOverflow).toBeLessThanOrEqual(1);

  await option.click();
  await expect(option).toHaveAttribute("aria-checked", "true");
  const search = page.getByRole("textbox", { name: "Seçeneklerde ara", exact: true });
  await search.fill("aidatlar");
  await expect(option).toBeVisible();
  await search.fill("bulunmayan seçenek");
  await expect(page.getByText("Aramana uyan seçenek yok.", { exact: true })).toBeVisible();

  await page.goto("/helix/workspace-template");
  await expect(page.getByRole("heading", { name: "Önerilen Kalemler", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Zaten sende olanlar", exact: true })).toBeVisible();
  const states = await page.getByRole("checkbox").evaluateAll((elements) =>
    elements.map((element) => ({
      disabled: element.getAttribute("aria-disabled") === "true" || (element as HTMLButtonElement).disabled,
      checked: element.getAttribute("aria-checked"),
    })),
  );
  expect(states.some(({ disabled }) => disabled)).toBe(true);
  expect(states.some(({ disabled }) => !disabled)).toBe(true);
  expect(states.every(({ checked }) => checked === "true" || checked === "false")).toBe(true);
});

test("management forms keep their purpose, status and controls visible across themes and target viewports", async ({ page }) => {
  test.setTimeout(180_000);
  await onboard(page);
  const routes = [
    { path: "/helix/settings/payment-sources", heading: "Yöntem bilgileri", control: "Yöntem adı" },
    { path: "/helix/settings/incomes", heading: "Düzenli gelir ekle", control: "Başlık" },
    { path: "/helix/opening-balance", heading: "Gerçek güncel bakiyen", control: "Gerçek güncel bakiyen", status: "Bakiye eşleşiyor" },
  ];
  const viewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
    { width: 844, height: 390 },
  ];

  for (const scheme of ["Açık", "Koyu"]) {
    await page.goto("/helix/settings");
    await page.getByRole("radio", { name: scheme, exact: true }).click();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
      scheme === "Açık" ? "light" : "dark",
    );

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const route of routes) {
        await page.goto(route.path);
        await expect(page.getByRole("heading", { name: route.heading, exact: true })).toBeVisible();
        await expect(page.getByRole("textbox", { name: route.control, exact: true })).toBeVisible();
        if (route.status) await expect(page.getByText(route.status, { exact: true })).toBeVisible();
        await expect(page.getByText("Yeni", { exact: true })).toHaveCount(0);
        const layout = await page.evaluate(() => ({
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          offscreen: Array.from(document.querySelectorAll<HTMLElement>('[role="button"],[role="radio"],[role="textbox"]'))
            .filter((element) => {
              const box = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return style.display !== "none" && box.width > 0 && (box.left < -1 || box.right > window.innerWidth + 1);
            })
            .map((element) => element.getAttribute("aria-label") ?? element.textContent?.trim() ?? ""),
        }));
        expect(layout.pageOverflow, `${scheme} ${viewport.width} ${route.path}`).toBeLessThanOrEqual(1);
        expect(layout.offscreen, `${scheme} ${viewport.width} ${route.path}`).toEqual([]);
      }
    }
  }
});

test("financial-table labels and amounts stay inside their cells across widths and realistic names", async ({ page }) => {
  await onboard(page);
  await page.goto("/helix/settings/categories");

  const rename = async (from: string, to: string) => {
    await page.getByRole("button", { name: `Düzenle · ${from}`, exact: true }).click();
    await page.getByRole("textbox", { name: `Düzenle · ${from}`, exact: true }).fill(to);
    await page.getByRole("button", { name: "Kaydet", exact: true }).click();
    await expect(page.getByRole("button", { name: `Düzenle · ${to}`, exact: true })).toBeVisible();
  };
  await rename("Kredi Kartı", "Kredi Kartı ve Aidat Ödemeleri");
  await rename("Faturalar", "TelekomünikasyonHizmetleri");
  await page.goto("/helix/cash-flow");

  const assertCellContainment = async () => {
    await expect(async () => {
      const result = await page.locator('[data-testid="table-column-label"], [data-testid="table-row-label"], [data-testid="matrix-value"]').evaluateAll((elements) => {
        const overflows: { text: string; kind: string }[] = [];
        let amountMaxHeight = 0;
        for (const element of elements as HTMLElement[]) {
          const text = element.textContent?.trim() ?? "";
          if (!text) continue;
          const box = element.getBoundingClientRect();
          const parent = element.parentElement?.getBoundingClientRect();
          if (!parent) continue;
          const style = getComputedStyle(element);
          // The ledger label is the one place allowed to shorten, and only
          // past three lines — an item name is user-authored, and unbounded
          // wrapping hands the table's geometry to whatever someone types.
          const deliberateTableClamp =
            element.dataset.testid !== "matrix-value" &&
            style.webkitLineClamp === "3" &&
            Boolean(element.getAttribute("aria-label"));
          const contained =
            box.left >= parent.left - 1 &&
            box.right <= parent.right + 1 &&
            box.top >= parent.top - 1 &&
            box.bottom <= parent.bottom + 1 &&
            (
              (
                element.scrollWidth <= element.clientWidth + 1 &&
                element.scrollHeight <= element.clientHeight + 1
              ) ||
              deliberateTableClamp
            );
          if (!contained) overflows.push({ text, kind: element.dataset.testid ?? "" });
          if (element.dataset.testid === "matrix-value") amountMaxHeight = Math.max(amountMaxHeight, box.height);
        }
        return {
          overflows,
          amountMaxHeight,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(result.overflows).toEqual([]);
      expect(result.amountMaxHeight).toBeLessThanOrEqual(18);
      expect(result.pageOverflow).toBeLessThanOrEqual(1);
    }).toPass({ timeout: 5_000 });
  };

  for (const width of [320, 375, 390, 430, 768, 1024]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await page.getByRole("radio", { name: "Satır odaklı" }).click();
    await assertCellContainment();
    await page.getByRole("radio", { name: "Kolon odaklı" }).click();
    await assertCellContainment();
    await page.getByRole("radio", { name: "Ay odaklı" }).click();
    await assertCellContainment();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("radio", { name: "Kolon odaklı" }).click();
  const shortLabel = page.getByTestId("table-row-label").filter({ hasText: "Market" }).first();
  const longLabel = page.getByTestId("table-row-label").filter({ hasText: "Kredi Kartı ve Aidat Ödemeleri" }).first();
  await expect(shortLabel).toHaveAttribute("aria-label", "Market");
  await expect(longLabel).toHaveAttribute("aria-label", "Kredi Kartı ve Aidat Ödemeleri");
  const labelFlow = await Promise.all([
    shortLabel.evaluate((element) => ({
      clamp: getComputedStyle(element).webkitLineClamp,
      overflows: element.scrollHeight > element.clientHeight + 1,
    })),
    longLabel.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const box = element.getBoundingClientRect();
      return {
        clamp: getComputedStyle(element).webkitLineClamp,
        lines: new Set(
          Array.from(range.getClientRects())
            .filter((rect) => rect.top < box.bottom - 1)
            .map((rect) => Math.round(rect.top)),
        ).size,
      };
    }),
  ]);
  expect(labelFlow[0].overflows).toBe(false);
  // A real item name wraps and the row grows to hold it. It used to stop at two
  // lines, so "Kredi Kartı Tek Çekim tek çekim" rendered as "Kredi Kartı Tek
  // Çekim tek çe…" — the shortened part being exactly what separates it from
  // the next item. Three lines is past every real name; the bound exists only
  // so one pathological entry cannot take the table with it.
  expect(labelFlow[1].clamp).toBe("3");
  expect(labelFlow[1].lines).toBeGreaterThan(1);
  const fullyVisible = await longLabel.evaluate(
    (element) => element.scrollHeight <= element.clientHeight + 1,
  );
  expect(fullyVisible).toBe(true);
});

test("settings workspace navigation reflows from one to two columns", async ({ page }) => {
  await onboard(page);
  await page.goto("/helix/settings");
  const links = page.getByTestId("settings-workspace-link");
  await expect(links).toHaveCount(6);
  const toolsLink = page.getByRole("button", { name: /Hızlı Hesaplamalar/ });
  await expect(toolsLink).toHaveCount(1);
  const sectionOrder = await Promise.all(
    ["Çalışma Alanı", "Araçlar", "Uygulama"].map((label) =>
      page.getByText(label, { exact: true }).first().evaluate((element) => element.getBoundingClientRect().top),
    ),
  );
  expect(sectionOrder[0]).toBeLessThan(sectionOrder[1]!);
  expect(sectionOrder[1]).toBeLessThan(sectionOrder[2]!);

  await page.setViewportSize({ width: 320, height: 844 });
  await expect.poll(async () => {
    const phone = await links.evaluateAll((elements) =>
      elements.map((element) => Math.round(element.getBoundingClientRect().left)),
    );
    return new Set(phone).size;
  }).toBe(1);

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect.poll(async () => {
    const left = await links.evaluateAll((elements) =>
      elements.map((element) => Math.round(element.getBoundingClientRect().left)),
    );
    return new Set(left).size;
  }).toBe(2);
  const tablet = await links.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { left: Math.round(box.left), top: Math.round(box.top) };
  }));
  expect(new Set(tablet.map(({ left }) => left)).size).toBe(2);
  expect(tablet[0]!.top).toBe(tablet[1]!.top);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("theme preference keeps browser chrome and native controls in the active scheme", async ({ page }) => {
  await onboard(page);
  await page.goto("/helix/settings");

  const light = page.getByRole("radio", { name: "Açık", exact: true });
  const dark = page.getByRole("radio", { name: "Koyu", exact: true });
  const hex = /^#[\dA-F]{6}$/i;
  const chrome = () => page.locator('meta[name="theme-color"]').getAttribute("content");
  const rootScheme = () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);

  // Two different things settle here, at their own pace: the root's
  // `color-scheme` and the `theme-color` meta the browser paints its chrome
  // from. Waiting on the first and then reading the second once is a race by
  // construction — it asserts a value it never waited for, and that read
  // failed intermittently on macOS while passing on Linux CI. Each signal now
  // waits for itself, so the test measures settled state on every platform
  // without loosening what it demands: two valid, different colours.
  await light.click();
  await expect.poll(rootScheme).toBe("light");
  await expect.poll(chrome).toMatch(hex);
  const lightChrome = await chrome();

  await dark.click();
  await expect.poll(rootScheme).toBe("dark");
  // The chrome must end up on a different colour than light left it on —
  // polled, so a slow update is waited for and a stuck one still fails.
  await expect.poll(chrome).not.toBe(lightChrome);
  const darkChrome = await chrome();

  expect(lightChrome).toMatch(hex);
  expect(darkChrome).toMatch(hex);
  expect(darkChrome).not.toBe(lightChrome);
});

test("disabled primary actions remain readable in every theme", async ({ page }) => {
  await onboard(page);
  for (const palette of ["Amber", "Petrol", "Servi"]) {
    for (const scheme of ["Açık", "Koyu"]) {
      await page.goto("/helix/settings");
      await page.getByRole("radio", { name: palette, exact: true }).click();
      await page.getByRole("radio", { name: scheme, exact: true }).click();
      await page.goto("/helix/transaction");
      const save = page.getByRole("button", { name: "Kaydet", exact: true });
      await expect(save).toBeDisabled();
      expect(await effectiveControlTextContrast(page, "Kaydet"), `${palette} · ${scheme}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("primary work surfaces reflow without page overflow across the target viewport matrix @smoke", async ({ page }) => {
  await onboard(page);
  const viewports = [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ];
  const routes = ["/helix/", "/helix/cash-flow", "/helix/transaction", "/helix/settings"];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await page.goto(route);
      await expect.poll(
        () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        `${route} must not create page-level horizontal overflow at ${viewport.width}x${viewport.height}`,
      ).toBeLessThanOrEqual(1);
    }
  }
});

for (const viewport of [{ w: 320, h: 640 }, { w: 390, h: 844 }, { w: 1280, h: 720 }]) {
  test(`the calculator popup stays centred inside a ${viewport.w}x${viewport.h} viewport`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.w, height: viewport.h });
    await onboard(page);
    await page.getByRole("button", { name: "İşlem Ekle" }).first().click();
    await page.getByRole("button", { name: /hesap makinesini aç/i }).first().click();

    const box = await page.getByRole("heading", { name: "Hesap Makinesi" }).evaluate((heading) => {
      let card: HTMLElement | null = heading.parentElement;
      while (card && parseFloat(getComputedStyle(card).borderTopLeftRadius) < 14) card = card.parentElement;
      // The scrim is the popup's own viewport — what the pad must sit in the
      // middle of, wherever the screen behind it happens to be scrolled.
      let scrim: HTMLElement | null = card;
      while (scrim && scrim.getBoundingClientRect().height < window.innerHeight * 0.9) scrim = scrim.parentElement;
      const c = card!.getBoundingClientRect();
      const s = scrim!.getBoundingClientRect();
      return {
        card: { top: c.top, bottom: c.bottom, left: c.left, right: c.right },
        scrim: { top: s.top, bottom: s.bottom, left: s.left, right: s.right },
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
    });

    // Fully on screen…
    expect(box.card.top).toBeGreaterThanOrEqual(0);
    expect(box.card.bottom).toBeLessThanOrEqual(box.vh);
    expect(box.card.left).toBeGreaterThanOrEqual(0);
    expect(box.card.right).toBeLessThanOrEqual(box.vw);
    // …and centred in that scrim. Horizontal centring is exact. Vertically the
    // bound is looser because the scroller's own box moves with the screen
    // behind it, but it still fails the defect this guards by an order of
    // magnitude: the pad used to be pinned to the top of a stretched scroller,
    // which leaves the whole remaining height — 260px+ here — on one side.
    expect(Math.abs((box.card.left - box.scrim.left) - (box.scrim.right - box.card.right))).toBeLessThanOrEqual(2);
    expect(Math.abs((box.card.top - box.scrim.top) - (box.scrim.bottom - box.card.bottom))).toBeLessThanOrEqual(24);
  });
}

test("a wait shows one indicator for its whole duration", async ({ page, context }) => {
  // Hold the SQLite wasm so the app stays in its boot wait.
  await context.route("**/*.wasm", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 9_000));
    await route.continue();
  });
  await page.goto("/helix/");

  const indicator = page.locator('[role="progressbar"]');
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveAttribute("aria-label", /hazırlanıyor/i);

  // Three dots, and nothing that has to decode or lay out a second time. The
  // indicator must not swap representation part-way through the wait, which is
  // what a logo appearing after a threshold did.
  const shape = async () => indicator.evaluate((el) => ({
    dots: el.querySelectorAll("div").length,
    images: el.querySelectorAll("img,svg").length,
  }));
  const first = await shape();
  expect(first.dots).toBe(3);
  expect(first.images).toBe(0);

  await page.waitForTimeout(2_500);
  expect(await shape()).toEqual(first);
});

test("a short boot wait never flashes a loading indicator", async ({ page, context }) => {
  await context.route("**/*.wasm", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.continue();
  });
  await page.goto("/helix/");
  await expect(page.locator('[role="progressbar"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Hemen Kullanmaya Başla/ })).toBeVisible();
});

/**
 * A pair of fields in one row has to stay a pair.
 *
 * The statement and due day sit side by side and each hides the day the other
 * already owns. While the unavailable day was deleted from the list, choosing
 * "Ayın sonu" on the left emptied the right-hand chip row completely and its
 * input rose a whole control height — two inputs on one line, on two different
 * baselines. The day is disabled now, so both columns keep the same shape.
 *
 * The same render also proves the chip itself does not resize when chosen: it
 * is the widest label in a row that wraps, so a few pixels of extra border or
 * font weight re-flowed everything after it.
 */
test("paired month-day fields keep one baseline when a day is taken", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);
  await page.goto("/helix/settings/payment-sources");
  await page.getByRole("radio", { name: "Kredi Kartı" }).click();

  const statement = page.getByRole("textbox", { name: "Ekstre kesim günü" });
  const due = page.getByRole("textbox", { name: "Son ödeme günü" });
  await expect(statement).toBeVisible();
  await expect(due).toBeVisible();

  const baselines = async () => {
    const [a, b] = await Promise.all([statement.boundingBox(), due.boundingBox()]);
    return { statement: Math.round(a!.y), due: Math.round(b!.y) };
  };
  // The month end is its own explained control per field, so each carries the
  // field's name — which is also why there are no longer two radios sharing
  // one label.
  const statementEnd = page.getByRole("radio", { name: "Ekstre kesim günü · Ayın son günü", exact: true });
  const dueEnd = page.getByRole("radio", { name: "Son ödeme günü · Ayın son günü", exact: true });
  await expect(statementEnd).toHaveCount(1);
  await expect(dueEnd).toHaveCount(1);
  const widths = async () => Promise.all(
    [statementEnd, dueEnd].map(async (chip) => Math.round((await chip.boundingBox())!.width)),
  );

  const before = await baselines();
  expect(before.statement, "the paired inputs start on one line").toBe(before.due);
  const widthsBefore = await widths();

  await statementEnd.click();
  await expect(statementEnd).toHaveAttribute("aria-checked", "true");

  const after = await baselines();
  expect(after.statement, "choosing a day keeps both inputs on one line").toBe(after.due);
  expect(await widths(), "a chosen chip is the same size as an unchosen one").toEqual(widthsBefore);

  // The day the other field now owns is still on screen and still refused.
  await expect(dueEnd).toHaveAttribute("aria-disabled", "true");
});

/**
 * A pressed list row lights the row, not the words in it. Painted on the bare
 * content box the fill began at the first glyph, so a held settings row looked
 * cropped against the card it sits in.
 */
/**
 * A row's fill reaches the card's edge, not four pixels short of it.
 *
 * The fill is painted on the pressable, so the pressable has to be as wide as
 * the space it occupies. It bled `spacing.sm` past its own text while the card
 * around it padded by `density.list.cardPadding` — 8 against 12 — which left a
 * 4px unlit strip down both sides of every hovered settings row. Four pixels
 * does not read as a margin; it reads as a fill that missed.
 */
test("a held list row lights its card from edge to edge", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);
  await page.goto("/helix/settings");

  const row = page.getByRole("button", { name: /^Bakiye Düzeltme/ }).first();
  await expect(row).toBeVisible();
  const geometry = await row.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const label = el.querySelector("div")!.getBoundingClientRect();
    // The nearest ancestor that paints a surface of its own is the card.
    let card: HTMLElement | null = el.parentElement;
    while (card && getComputedStyle(card).borderRadius === "0px") card = card.parentElement;
    const cardBox = (card ?? el).getBoundingClientRect();
    return {
      left: box.left, right: box.right,
      textLeft: label.left, textRight: label.right,
      cardLeft: cardBox.left, cardRight: cardBox.right,
    };
  });
  // Still wider than its own words, which is what the fill is for.
  expect(geometry.textLeft - geometry.left, "left inset").toBeGreaterThanOrEqual(8);
  expect(geometry.right - geometry.textRight, "right inset").toBeGreaterThanOrEqual(8);
  // And now flush with the card itself on both sides — the row's negative
  // margin gives back exactly the padding the card took, so the only gap left
  // is the card's hairline border.
  expect(Math.abs(geometry.left - geometry.cardLeft), "left edge of the card").toBeLessThanOrEqual(2);
  expect(Math.abs(geometry.right - geometry.cardRight), "right edge of the card").toBeLessThanOrEqual(2);
});

/**
 * Every control lights the whole box it occupies.
 *
 * The rule this enforces is one line: the interaction fill is painted on the
 * pressable, the pressable owns its padding, and the box around it owns only
 * position. Break it and the fill floats — the ledger's column header held its
 * padding on the cell around the button, so a hovered header lit 86x48 of a
 * 134x56 cell and left an unlit margin on all four sides.
 *
 * Only controls that are the SOLE occupant of their slot are checked: one of
 * five buttons in a flex row being a fifth as wide is correct, not a defect.
 */
test("a control fills the slot it is the only thing in", async ({ page }) => {
  await onboard(page);
  await openCashFlow(page);
  const offenders = await page.evaluate(() => {
    const found: string[] = [];
    for (const node of Array.from(document.querySelectorAll('[role="button"],[role="radio"],[role="link"]'))) {
      const el = node as HTMLElement;
      const box = el.getBoundingClientRect();
      const parent = el.parentElement;
      if (box.width < 2 || box.height < 2 || !parent) continue;
      const occupants = Array.from(parent.children)
        .filter((child) => child.getBoundingClientRect().width > 1);
      if (occupants.length !== 1) continue;
      const slot = parent.getBoundingClientRect();
      const style = getComputedStyle(parent);
      const inset = (side: "Top" | "Right" | "Bottom" | "Left") =>
        Number.parseFloat(style[`padding${side}` as "paddingTop"] || "0");
      const missingWidth = Math.round(slot.width - inset("Left") - inset("Right") - box.width);
      const missingHeight = Math.round(slot.height - inset("Top") - inset("Bottom") - box.height);
      if (missingWidth <= 1 && missingHeight <= 1) continue;
      const name = (el.getAttribute("aria-label") || el.textContent || "?").trim().slice(0, 30);
      found.push(`${name}: ${Math.round(box.width)}x${Math.round(box.height)} in ${Math.round(slot.width)}x${Math.round(slot.height)}`);
    }
    return found;
  });
  expect(offenders, "a fill that floats inside the box it belongs to").toEqual([]);
});

/**
 * The browser rests on a whole cell, exactly as the phone does.
 *
 * `snapToInterval` is unimplemented in react-native-web — its `ScrollView`
 * maps only `pagingEnabled` onto `scroll-snap-type` — so the rule this table
 * exists to enforce held on the phone app and nowhere else. Measured before
 * the web half existed: after a 200px drag the ledger rested at 722px on an
 * 87px grid, which puts the sticky label column over the left of an amount and
 * turns `₺14.500,00` into a smaller, entirely plausible `4.500,00`.
 */
test("a dragged ledger rests on a whole month in the browser too", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);
  await openCashFlow(page);
  await page.getByRole("radio", { name: "Kolon odaklı" }).click();
  await expect(page.getByTestId("cash-flow-matrix-table")).toBeVisible();

  const body = page.getByTestId("table-horizontal-body");
  const cellWidth = await page
    .getByTestId("table-column-label")
    .first()
    .evaluate((node) => Math.round((node.parentElement!.parentElement as HTMLElement).getBoundingClientRect().width));
  expect(cellWidth).toBeGreaterThan(0);

  for (const nudge of [37, 129, 214]) {
    await body.evaluate((element, delta) => { element.scrollLeft += delta; }, nudge);
    await expect
      .poll(async () => body.evaluate((element, cell) => {
        const left = Math.round(element.scrollLeft);
        const max = Math.round(element.scrollWidth - element.clientWidth);
        return left % cell === 0 || left === max;
      }, cellWidth), { timeout: 3_000 })
      .toBe(true);
    const resting = await body.evaluate((element) => ({
      left: Math.round(element.scrollLeft),
      max: Math.round(element.scrollWidth - element.clientWidth),
    }));
    // Either exactly on the grid, or hard against the far end.
    const onGrid = resting.left % cellWidth === 0 || resting.left === resting.max;
    expect(onGrid, `rested at ${resting.left} on a ${cellWidth}px grid (max ${resting.max})`).toBe(true);
  }
});

/**
 * The pivot's underline sits under the option it belongs to.
 *
 * The indicator is a percentage of its track and the reading-guide toggle
 * beside it is a fixed 44pt, so measuring the indicator against the whole strip
 * made it both too narrow and progressively too far left — correct on the first
 * segment, visibly wrong on the third, and only in the view that has a toggle.
 */
test("the financial-table pivot underlines the option it belongs to", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await onboard(page);
  await openCashFlow(page);

  for (const name of ["Satır odaklı", "Kolon odaklı", "Ay odaklı"]) {
    const option = page.getByRole("radio", { name, exact: true });
    await expect(option, `the pivot offers "${name}"`).toHaveCount(1);
    await option.click();
    await expect(option).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () =>
        option.evaluate((element) => {
          const strip = element.closest<HTMLElement>('[role="radiogroup"]')!;
          const indicator = Array.from(strip.querySelectorAll<HTMLElement>("div")).find((node) => {
            const style = getComputedStyle(node);
            return style.position === "absolute" && node.getBoundingClientRect().height <= 4 && node.getBoundingClientRect().width > 20;
          });
          if (!indicator) return "no indicator";
          const bar = indicator.getBoundingClientRect();
          const seg = element.getBoundingClientRect();
          return Math.round(Math.abs(bar.left - seg.left)) <= 2 && Math.round(Math.abs(bar.width - seg.width)) <= 2
            ? "aligned"
            : `left ${Math.round(bar.left - seg.left)} width ${Math.round(bar.width - seg.width)}`;
        }),
      )
      .toBe("aligned");
  }
});
