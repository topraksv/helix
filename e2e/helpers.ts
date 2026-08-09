import { expect, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";

const APP_PATH = "/helix/";

export function currentMonthKey(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("Could not derive the current Istanbul month");
  return `${year}-${month}`;
}

/** Registrable host of the live market feed (`src/services/markets.ts`). */
const MARKET_FEED_HOST = "haremaltin.com";

/**
 * Whether a socket URL belongs to the market feed.
 *
 * A substring match on the host is the wrong contract: `/haremaltin\.com/`
 * is unanchored, so it also matches `notharemaltin.com` and any URL that
 * merely mentions the host in a query string. Compare the parsed hostname,
 * accepting the registrable domain and its subdomains and nothing else.
 */
export function isMarketFeedSocket(url: URL): boolean {
  return url.hostname === MARKET_FEED_HOST || url.hostname.endsWith(`.${MARKET_FEED_HOST}`);
}

export async function isolateExternalData(context: BrowserContext): Promise<void> {
  await context.routeWebSocket((url) => isMarketFeedSocket(url), (socket) => socket.close());
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.protocol === "blob:" || url.protocol === "data:") {
      await route.continue();
    } else {
      // Model an unavailable optional service with an HTTP response instead of
      // a client-side abort. Firefox reports CORS/network aborts as page-level
      // JavaScript errors even though the application catches them; a 503
      // exercises the same offline fallback without manufacturing noise.
      await route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "External data disabled in browser tests",
      });
    }
  });
}

export function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // Chromium reports blocked optional feeds and Pages' intentional dynamic
    // route 404 document as console resource errors. Page exceptions and real
    // application console errors still fail the suite.
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      errors.push(message.text());
    }
  });
  return errors;
}

export async function onboard(page: Page): Promise<void> {
  await page.goto(APP_PATH);
  await expect(page.getByRole("heading", { name: "Hoş geldin", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hemen Kullanmaya Başla" }).click();
  const skipTour = page.getByRole("button", { name: "Geç", exact: true });
  let tourVisible = true;
  try {
    // The welcome tour is scheduled after the dashboard mounts, so a
    // zero-wait visibility probe can race it and leave an invisible overlay
    // intercepting the next real action.
    await skipTour.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    // Returning/restore flows legitimately have no first-run tour.
    tourVisible = false;
  }
  if (tourVisible) {
    await skipTour.click();
    await expect(skipTour).toBeHidden();
  }
  await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();
}

export async function openCashFlow(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Mali Tablo" }).click();
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();
}

/**
 * Choose a value from one of the form dropdowns (category, payment source).
 *
 * These used to be chip rows, so a test could click the option directly. They
 * are `Select` now: the field is a button carrying the label, and the options
 * are radios inside its modal. Routed through one helper so a later change to
 * the control is one edit here rather than six across the suite.
 */
export async function pickOption(page: Page, field: string, option: string | RegExp): Promise<void> {
  const trigger = page.getByRole("button", { name: field, exact: true });
  await trigger.click();
  const modal = page.locator('[aria-modal="true"]');
  await modal.getByRole("radio", { name: option }).click();
  await expect(modal).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

export async function addMarketExpense(page: Page, note: string, amount = "1.234,56"): Promise<void> {
  await openCashFlow(page);
  await page.getByRole("button", { name: "İşlem Ekle" }).click();
  await expect(page.getByRole("heading", { name: "Yeni İşlem" })).toBeVisible();
  await page.getByRole("textbox", { name: "Tutar · TRY" }).fill(amount);
  await pickOption(page, "Kategori", /Market/);
  await page.getByRole("textbox", { name: "Not" }).fill(note);
  const save = page.getByRole("button", { name: "Kaydet", exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("heading", { name: "Mali Tablo", exact: true })).toBeVisible();
}

/**
 * Rendered contrast of an element's own text against the nearest ancestor that
 * actually paints a background. `getByRole` matches the accessible name, so a
 * control can pass every interaction assertion while being invisible to a
 * human — this measures what the browser really painted.
 */
export async function renderedContrastRatio(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
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

    const foreground = parse(getComputedStyle(element).color);
    let node: HTMLElement | null = element as HTMLElement;
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
  });
}

/**
 * Contrast between an element's own painted boundary and the surface behind it.
 *
 * A control whose fill is a low-contrast neutral is only visible because of its
 * outline, and `renderedContrastRatio` cannot see that — it measures text. The
 * refund switch rendered at exactly 1.00:1 against its row and simply was not
 * there, while every role/name assertion stayed green.
 */
export async function renderedBoundaryContrast(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
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
    if (Number.parseFloat(style.borderTopWidth) === 0) throw new Error("Control has no painted boundary");
    const boundary = parse(style.borderTopColor);
    let node: HTMLElement | null = element.parentElement;
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
    if (!background) throw new Error("No painted background found above the control");
    const [lighter, darker] = [luminance(boundary), luminance(background)].sort((a, b) => b - a);
    return (lighter! + 0.05) / (darker! + 0.05);
  });
}

export async function assertNoRuntimeErrors(errors: string[], testInfo: TestInfo): Promise<void> {
  if (errors.length > 0) {
    await testInfo.attach("runtime-errors", { body: errors.join("\n"), contentType: "text/plain" });
  }
  expect(errors).toEqual([]);
}
