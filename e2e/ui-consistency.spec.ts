/**
 * Layout and feedback rules that only a real render can prove: a card's own
 * padding reading evenly, a popup staying inside the viewport, palette
 * persistence, and one stable wait indicator.
 */

import { expect, test, type Page } from "@playwright/test";
import { addMarketExpense, currentMonthKey, isolateExternalData, onboard, pickOption } from "./helpers";

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

test("investment setup, weighted sale, BES contribution and wallet refund form one flow @smoke", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);
  await page.getByRole("tab", { name: "Yatırımlar", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Yatırım alanını başlat", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Yatırım Alanını Aç", exact: true }).click();
  await page.getByRole("textbox", { name: "Bugünkü serbest yatırım bakiyesi", exact: true }).fill("10.000");
  await page.getByRole("button", { name: "Yatırım Alanını Aç", exact: true }).click();
  await expect(page.getByText("Serbest nakit ve ürün maliyetleri", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("screen-header").getByRole("button", { name: "İşlem Ekle", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Ürün Ekle", exact: true }).click();
  await page.getByRole("radio", { name: "Borsa", exact: true }).click();
  await page.getByRole("textbox", { name: "Ürün adı", exact: true }).fill("SASA");
  await page.getByRole("button", { name: "Ürün Ekle", exact: true }).click();

  await page.getByTestId("screen-header").getByRole("button", { name: "İşlem Ekle", exact: true }).click();
  await page.getByRole("textbox", { name: "Miktar / adet · zorunlu", exact: true }).fill("10");
  await page.getByRole("textbox", { name: "Birim fiyat · zorunlu", exact: true }).fill("100");
  await page.getByRole("textbox", { name: "Toplam TRY · isteğe bağlı", exact: true }).fill("2.000");
  await expect(page.getByRole("alert")).toContainText("birbiriyle uyuşmuyor");
  await page.getByRole("textbox", { name: "Toplam TRY · isteğe bağlı", exact: true }).fill("1.000");
  await page.getByRole("button", { name: "Alış ekle", exact: true }).click();
  await expect(page.getByText("SASA", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Satış Yap", exact: true }).click();
  await page.getByRole("textbox", { name: "Miktar / adet · zorunlu", exact: true }).fill("4");
  await page.getByRole("textbox", { name: "Birim fiyat · zorunlu", exact: true }).fill("150");
  await page.getByRole("button", { name: "Satış yap", exact: true }).click();
  await expect(page.getByText("₺200,00", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Ürün Ekle", exact: true }).click();
  await page.getByRole("radio", { name: "BES", exact: true }).click();
  await page.getByRole("textbox", { name: "Ürün adı", exact: true }).fill("Emeklilik Planım");
  await page.getByRole("button", { name: "Ürün Ekle", exact: true }).click();
  await page.getByTestId("screen-header").getByRole("button", { name: "İşlem Ekle", exact: true }).click();
  await pickOption(page, "Ürün", "Emeklilik Planım · BES");
  await page.getByRole("radio", { name: "Yalnız katkı tutarı", exact: true }).click();
  await page.getByRole("textbox", { name: "Toplam katkı · zorunlu", exact: true }).fill("500");
  await page.getByRole("button", { name: "BES katkısı ekle", exact: true }).click();
  await expect(page.getByText("Pay bilgisi yok", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Serbest Bakiyeyi Aktar", exact: true }).click();
  await page.getByRole("radio", { name: "Bir kısmı", exact: true }).click();
  await page.getByRole("textbox", { name: "Aktarılacak tutar", exact: true }).fill("100");
  await page.getByRole("button", { name: "Mali Tabloya Aktar", exact: true }).click();
  await expect(page.getByText("₺9.000,00", { exact: true }).first()).toBeVisible();
});

test("the investment wallet keeps large balances readable at the narrowest phone width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await onboard(page);
  await page.getByRole("tab", { name: "Yatırımlar", exact: true }).click();
  await page.getByRole("button", { name: "Yatırım Alanını Aç", exact: true }).click();
  await page.getByRole("textbox", { name: "Bugünkü serbest yatırım bakiyesi", exact: true }).fill("987.654.321.000");
  await page.getByRole("button", { name: "Yatırım Alanını Aç", exact: true }).click();

  const summary = page.getByTestId("investment-wallet-summary");
  const cash = page.getByTestId("investment-cash-amount");
  await expect(cash).toHaveAttribute("aria-label", "Serbest bakiye: ₺987.654.321.000,00");
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
  const actions = page.getByTestId("investment-actions").getByRole("button");
  await expect(actions).toHaveCount(4);
  const actionGeometry = await actions.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), width: Math.round(box.width) };
  }));
  expect(new Set(actionGeometry.map(({ left }) => left)).size).toBe(4);
  expect(new Set(actionGeometry.map(({ top }) => top)).size).toBe(1);
  expect(Math.max(...actionGeometry.map(({ width }) => width)) - Math.min(...actionGeometry.map(({ width }) => width))).toBeLessThanOrEqual(1);
  expect(Math.max(...actionGeometry.map(({ right }) => right))).toBeLessThanOrEqual(320 - 16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("the phone financial-table tools stay in one compact row", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await onboard(page);
  await page.goto("/helix/cash-flow");

  await expect(page.getByTestId("screen-header").getByRole("button", { name: "İşlem Ekle", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("screen-header").getByText(/^\d{4}$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "İşlem Ekle", exact: true })).toBeVisible();

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

  await expect(page.getByRole("radio", { name: "Kolon odaklı" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("link", { name: "Kredi Kartı", exact: true })).toBeVisible();
  const visibleMonths = await page.getByTestId("table-horizontal-header").getByRole("button").evaluateAll((buttons) => {
    const viewport = buttons[0]?.parentElement?.parentElement?.getBoundingClientRect();
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
    { path: "/helix/settings/payment-sources", heading: "Yöntem bilgileri", control: "Yöntem Ekle" },
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
          const deliberateTableClamp =
            element.dataset.testid !== "matrix-value" &&
            style.webkitLineClamp === "2" &&
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
  expect(labelFlow[1].clamp).toBe("2");
  expect(labelFlow[1].lines).toBeGreaterThan(1);
  expect(labelFlow[1].lines).toBeLessThanOrEqual(2);
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
