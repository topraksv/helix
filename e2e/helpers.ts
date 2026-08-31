import { expect, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";

const APP_PATH = "/helix/";

/**
 * Today as the APP sees it, never as this file does.
 *
 * The browser is pinned to Europe/Istanbul (`playwright.config.ts`); this file
 * runs in the runner's timezone, which is UTC on CI. Between 21:00 UTC and
 * midnight those are different DATES, and every value derived from a bare
 * `new Date()` here is then a day ahead of the app under test.
 */
function todayInIstanbul(): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  const [year, month, day] = [value("year"), value("month"), value("day")];
  if (!year || !month || !day) throw new Error("Could not derive today in Istanbul");
  return { year, month, day };
}

export function currentMonthKey(): string {
  const { year, month } = todayInIstanbul();
  return `${year}-${month}`;
}

/**
 * The day of the month to type into a form the app reads against its own clock.
 *
 * A bare `new Date().getDate()` scheduled a subscription for the wrong day
 * whenever the run crossed the Istanbul midnight: nothing was then due today,
 * the attention inbox had no "Bugün" group, and the release gate failed on a
 * push that had nothing to do with it. Measured on the 21:34 UTC run of
 * 2026-08-31, which typed 31 while the app had already turned 1 September.
 *
 * Unpadded, because the field takes a number and not a calendar string.
 */
export function currentIstanbulDay(): string {
  return String(Number(todayInIstanbul().day));
}

export async function isolateExternalData(context: BrowserContext): Promise<void> {
  // The market feed used to need its own `routeWebSocket` rule, because
  // `context.route` does not see a WebSocket handshake. It is a plain polled
  // request now, so the catch-all below already covers it — one rule for every
  // external host instead of one rule plus an exception.
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
 * Rendered contrast of an element against the nearest ancestor that actually
 * paints a background.
 *
 * `getByRole` matches the accessible name, so a control can pass every
 * interaction assertion while being invisible to a human — this measures what
 * the browser really painted.
 *
 * `"text"` samples the element's own text colour. `"boundary"` samples its
 * painted border instead, and starts the backdrop walk one level up because
 * the border is painted ON the element: a control whose fill is a low-contrast
 * neutral is visible only because of its outline, which the text measurement
 * cannot see. The refund switch rendered at exactly 1.00:1 against its row and
 * simply was not there, while every role/name assertion stayed green.
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

export async function assertNoRuntimeErrors(errors: string[], testInfo: TestInfo): Promise<void> {
  if (errors.length > 0) {
    await testInfo.attach("runtime-errors", { body: errors.join("\n"), contentType: "text/plain" });
  }
  expect(errors).toEqual([]);
}
