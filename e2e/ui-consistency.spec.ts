/**
 * Layout and feedback rules that only a real render can prove: a card's own
 * padding reading evenly, a popup staying inside the viewport, palette
 * persistence, and one stable wait indicator.
 */

import { expect, test, type Page } from "@playwright/test";
import { isolateExternalData, onboard, pickOption } from "./helpers";

test.beforeEach(async ({ context }) => isolateExternalData(context));

/** Distance from a container's edge to the first/last child's own text. */
async function verticalInsets(page: Page, insideText: RegExp) {
  return page.getByRole("button", { name: insideText }).evaluate((btn) => {
    let card: HTMLElement | null = btn.parentElement;
    while (card && parseFloat(getComputedStyle(card).borderTopLeftRadius) < 14) card = card.parentElement;
    const box = card!.getBoundingClientRect();
    const kids = Array.from(card!.children) as HTMLElement[];
    const firstText = (kids[0]!.querySelector("div,span") as HTMLElement | null) ?? kids[0]!;
    const lastText = (btn.querySelector("div,span") as HTMLElement | null) ?? btn;
    return {
      top: +(firstText.getBoundingClientRect().top - box.top).toFixed(1),
      bottom: +(box.bottom - lastText.getBoundingClientRect().bottom).toFixed(1),
    };
  });
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
  // A regular button's 48pt minimum height used to centre its label 4.5px
  // deeper than the first row's text sits from the top.
  expect(Math.abs(insets.top - insets.bottom)).toBeLessThanOrEqual(1);
});

test("palette preference repaints immediately and survives a reload", async ({ page }) => {
  await onboard(page);
  await page.goto("/helix/settings");
  const clay = page.getByRole("radio", { name: "Kil", exact: true });
  const sand = page.getByRole("radio", { name: "Kum", exact: true });
  await expect(clay).toHaveAttribute("aria-checked", "true");
  const clayFill = await clay.evaluate((element) => getComputedStyle(element).backgroundColor);

  await sand.click();
  await expect(sand).toHaveAttribute("aria-checked", "true");
  const sandFill = await sand.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(sandFill).not.toBe(clayFill);
  expect(await page.evaluate(() => localStorage.getItem("helix.palette"))).toBe("sand");

  await page.reload();
  await expect(page.getByRole("radio", { name: "Kum", exact: true })).toHaveAttribute("aria-checked", "true");
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
