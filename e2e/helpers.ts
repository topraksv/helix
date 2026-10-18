import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";

// The browser is pinned to Europe/Istanbul but this file runs in the runner's
// timezone (UTC on CI), so a bare `new Date()` is a day ahead of the app after 21:00 UTC.
const istanbulToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());

export const currentMonthKey = () => istanbulToday().slice(0, 7);

/** Unpadded: the form field takes a number, not a calendar string. */
export const currentIstanbulDay = () => String(Number(istanbulToday().slice(8)));

export async function isolateExternalData(context: BrowserContext): Promise<void> {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.protocol === "blob:" || url.protocol === "data:") {
      await route.continue();
    } else {
      // A 503 rather than an abort: Firefox reports aborted CORS requests as page
      // errors even when the app catches them.
      await route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "External data disabled in browser tests",
      });
    }
  });
}

/** Every interactive control's box lies inside the viewport it was laid out in. */
export async function offscreenControls(page: Page): Promise<string[]> {
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

export const scrollsSideways = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

/**
 * A guard that redirects makes "this route was audited" a claim about another
 * screen. `<Redirect>` fires a frame or two after `#root` appears, so call
 * `routeRedirectProblem` AFTER the route's own work, never straight after this.
 */
export async function openRouteForAudit(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await expect(page.locator("#root")).toBeVisible();
}

/** Null when the app held the route; a problem line when it went elsewhere. */
export function routeRedirectProblem(page: Page, route: string): string | null {
  const landed = new URL(page.url()).pathname;
  const requested = new URL(route, page.url()).pathname;
  return landed === requested
    ? null
    : `${route} redirected to ${landed}: this route was not audited, ${landed} was audited twice`;
}

export function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Blocked external feeds and Pages' dynamic-route 404 document are expected;
    // a missing local file (chunk, font) is not, so only extensionless local paths pass.
    if (text.startsWith("Failed to load resource:")) {
      const url = message.location().url;
      if (!url) return;
      const { hostname, pathname } = new URL(url);
      if (hostname !== "127.0.0.1" || !/\.[a-z0-9]+$/i.test(pathname)) return;
    }
    errors.push(text);
  });
  return errors;
}

export async function onboard(page: Page): Promise<void> {
  await page.goto("/helix/");
  await expect(page.getByRole("heading", { name: "Hoş geldin", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hemen Kullanmaya Başla" }).click();
  const skipTour = page.getByRole("button", { name: "Geç", exact: true });
  // The tour appears after the dashboard mounts; returning/restore flows have none.
  await skipTour.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  if (await skipTour.isVisible()) {
    await skipTour.click();
    await expect(skipTour).toBeHidden();
  }
  await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();
  // Quick start leaves the balance at ₺0, so the first expense would raise the
  // one-time "bakiyen ekside" hint over whatever the test does next; the test
  // that owns the hint clears this again.
  await page.evaluate(() => localStorage.setItem("helix.negative-balance-hint.done", "true"));
}

export async function openCashFlow(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Mali Tablo" }).click();
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();
}

/** Choose a value from a form dropdown: the field is a button, the options are radios in its modal. */
export async function pickOption(page: Page, field: string, option: string | RegExp): Promise<void> {
  const trigger = page.getByRole("button", { name: field, exact: true });
  await trigger.click();
  const modal = page.locator('[aria-modal="true"]');
  await modal.getByRole("radio", { name: option }).click();
  await expect(modal).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

export async function addSubscription(
  page: Page,
  name: string,
  amount: string,
  day = currentIstanbulDay(),
): Promise<void> {
  await page.getByRole("tab", { name: "Abonelikler" }).click();
  await page.getByRole("button", { name: "Abonelik Ekle", exact: true }).click();
  await page.getByRole("textbox", { name: "Ad", exact: true }).fill(name);
  await page.getByRole("textbox", { name: "Tutar · TRY", exact: true }).fill(amount);
  await page.getByRole("textbox", { name: "Ödeme günü", exact: true }).fill(day);
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  const categoryOffer = page.getByRole("button", { name: "Oluştur ve Kaydet", exact: true });
  if (await categoryOffer.count()) await categoryOffer.click();
  await expect(page).toHaveURL(/subscriptions/u);
}

export async function addMarketExpense(
  page: Page,
  note: string,
  amount = "1.234,56",
  category: string | RegExp = /Market/,
): Promise<void> {
  await openCashFlow(page);
  await page.getByRole("button", { name: "İşlem Ekle" }).click();
  await expect(page.getByRole("heading", { name: "Yeni İşlem" })).toBeVisible();
  await page.getByRole("textbox", { name: "Tutar · TRY" }).fill(amount);
  await pickOption(page, "Kalem", category);
  await page.getByRole("textbox", { name: "Not" }).fill(note);
  const save = page.getByRole("button", { name: "Kaydet", exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();
}

/**
 * Contrast of what the browser painted, since role queries pass on invisible controls.
 * `"boundary"` samples the border and starts the backdrop walk one level up, for
 * controls whose fill is a low-contrast neutral and are seen only by their outline.
 */
export async function renderedContrast(locator: Locator, against: "text" | "boundary"): Promise<number> {
  return locator.evaluate((element, mode) => {
    const parse = (value: string): [number, number, number] => {
      const parts = value.match(/[\d.]+/g);
      if (!parts || parts.length < 3) throw new Error(`Unsupported color: ${value}`);
      return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
    };
    const luminance = (rgb: [number, number, number]) =>
      rgb
        .map((channel) => channel / 255)
        .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
        .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index]!, 0);

    const style = getComputedStyle(element);
    if (mode === "boundary" && Number.parseFloat(style.borderTopWidth) === 0) {
      throw new Error("Control has no painted boundary");
    }
    const foreground = parse(mode === "boundary" ? style.borderTopColor : style.color);
    let node: HTMLElement | null = mode === "boundary"
      ? (element as HTMLElement).parentElement
      : (element as HTMLElement);
    let background: [number, number, number] | null = null;
    while (node) {
      const painted = getComputedStyle(node).backgroundColor;
      const alpha = painted.match(/[\d.]+/g)?.[3];
      if (painted && painted !== "transparent" && alpha !== "0") {
        background = parse(painted);
        break;
      }
      node = node.parentElement;
    }
    if (!background) throw new Error("No painted background found above the element");
    const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (lighter! + 0.05) / (darker! + 0.05);
  }, against);
}
