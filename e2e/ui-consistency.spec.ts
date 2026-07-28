/**
 * Layout and feedback rules that only a real render can prove: a card's own
 * padding reading evenly, a popup staying inside the viewport, palette
 * persistence, and one stable wait indicator.
 */

import { expect, test, type Page } from "@playwright/test";
import { addMarketExpense, isolateExternalData, onboard, pickOption } from "./helpers";

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
  await page.getByRole("button", { name: "Ödeme Günü" }).click();
  const days = await page.getByRole("button").evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label")).filter((l): l is string => !!l && /^\d{1,2} \w+ \d{4}$/.test(l)));
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

test("bar-chart amounts stay readable and contained on phone and desktop", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await onboard(page);
  await addMarketExpense(page, "Sütun grafik tutarı", "123.456,78");
  await page.getByRole("tab", { name: "Durum" }).click();
  await page.getByRole("radio", { name: "Sütun", exact: true }).click();

  for (const width of [320, 390, 1024]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    const labels = page.getByTestId("bar-value-label");
    await expect(labels.first()).toBeVisible();
    const axisLabels = await page.getByTestId("bar-axis-label").allTextContents();
    expect(new Set(axisLabels).size).toBeGreaterThan(2);
    expect(axisLabels.some((label) => !/^[-−]?₺?0(?:[,.]0+)?$/.test(label.trim()))).toBe(true);
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});

test("yearly subscriptions ask for a real renewal date", async ({ page }) => {
  await onboard(page);
  await page.goto("/helix/subscription-form");
  await page.getByRole("radio", { name: "Yıllık", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sonraki Yenileme Tarihi", exact: true })).toBeVisible();
  await expect(page.getByText("Ayın kaçında?", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Yıllık ücretin bir sonraki kez alınacağı tarihi seç.", { exact: true })).toBeVisible();
});

test("the phone financial-table tools stay in one compact row", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await onboard(page);
  await page.goto("/helix/cash-flow");

  const tools = page.getByRole("button").filter({
    has: page.locator("text=/^(Düzenle|Taksitler|Analiz|Toplu|Açılış)$/"),
  });
  await expect(tools).toHaveCount(5);
  const boxes = await tools.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { top: Math.round(box.top), height: Math.round(box.height) };
    }),
  );
  expect(new Set(boxes.map(({ top }) => top)).size).toBe(1);
  expect(boxes.every(({ height }) => height === 44)).toBe(true);
});

test("pivoting the financial table resets unrelated offsets and keeps complete columns", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await onboard(page);
  await page.goto("/helix/cash-flow");

  await page.getByRole("radio", { name: "Sütun odaklı" }).click();
  await expect(page.getByRole("button", { name: "Temmuz", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kredi Kartı", exact: true })).toBeVisible();
  for (const month of ["Temmuz", "Ağustos"]) {
    const monthBox = await page.getByRole("button", { name: month, exact: true }).boundingBox();
    expect(monthBox).not.toBeNull();
    expect(monthBox!.x).toBeGreaterThanOrEqual(16 + 112);
    expect(monthBox!.x + monthBox!.width).toBeLessThanOrEqual(320 - 16);
  }
  await page.getByRole("radio", { name: "Satır odaklı" }).click();
  const firstCategory = page.getByRole("button", { name: "Kredi Kartı", exact: true });
  await expect(firstCategory).toBeVisible();
  const box = await firstCategory.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(16);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320 - 16);
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
  for (const month of ["Temmuz", "Ağustos"]) {
    const metrics = await page.getByRole("link", { name: month, exact: true }).evaluate((row) => {
      const text = row.querySelector<HTMLElement>('[data-testid="table-row-label"]')!;
      const rowBox = row.getBoundingClientRect();
      const textBox = text.getBoundingClientRect();
      return {
        left: textBox.left - rowBox.left,
        right: rowBox.right - textBox.right,
        height: textBox.height,
      };
    });
    expect(metrics.left).toBeGreaterThanOrEqual(11);
    expect(metrics.right).toBeGreaterThanOrEqual(11);
    expect(metrics.height).toBeLessThanOrEqual(18);
  }

  await page.getByRole("radio", { name: "Sütun odaklı" }).click();
  await assertPinBesideLabel("Temmuz kolonunu sabitle", "Tem");
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
          const contained =
            box.left >= parent.left - 1 &&
            box.right <= parent.right + 1 &&
            box.top >= parent.top - 1 &&
            box.bottom <= parent.bottom + 1 &&
            element.scrollWidth <= element.clientWidth + 1;
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
    await page.getByRole("radio", { name: "Sütun odaklı" }).click();
    await assertCellContainment();
    await page.getByRole("radio", { name: "Ay odaklı" }).click();
    await assertCellContainment();
  }
});

test("theme preference keeps browser chrome and native controls in the active scheme", async ({ page }) => {
  await onboard(page);
  await page.goto("/helix/settings");

  const light = page.getByRole("radio", { name: "Açık", exact: true });
  const dark = page.getByRole("radio", { name: "Koyu", exact: true });
  await light.click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light");
  const lightChrome = await page.locator('meta[name="theme-color"]').getAttribute("content");

  await dark.click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
  const darkChrome = await page.locator('meta[name="theme-color"]').getAttribute("content");

  expect(lightChrome).toMatch(/^#[\dA-F]{6}$/i);
  expect(darkChrome).toMatch(/^#[\dA-F]{6}$/i);
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

test("primary work surfaces reflow without page overflow across the target viewport matrix", async ({ page }) => {
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
