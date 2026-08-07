/**
 * What the app costs to open, measured in the browser.
 *
 * The bundle budget in `scripts/check-web-budget.mjs` bounds the BYTES; this
 * bounds what the browser does with them. They answer different questions: a
 * change can keep every byte and still push the first paint out by loading the
 * database, the fonts and the first query in the wrong order.
 *
 * The ceilings are deliberately loose. A CI runner is a noisy clock and a
 * timing test that fails on variance gets skipped, then deleted — which is
 * worse than not having it. These are set to catch a change that alters the
 * ORDER of magnitude (a synchronous migration on the boot path, a font that
 * blocks paint, an entry bundle that doubles), not one that costs 40 ms.
 */

import { expect, test } from "@playwright/test";
import { isolateExternalData } from "./helpers";

/** The paint the user reads as "it opened". */
const FIRST_CONTENTFUL_PAINT_BUDGET_MS = 6_000;
/** Onboarding interactive: the whole boot path, database included. */
const FIRST_SCREEN_BUDGET_MS = 15_000;
/** Bytes the browser must fetch before it can show anything. */
const INITIAL_SCRIPT_BUDGET_BYTES = 4_500_000;

test.beforeEach(async ({ context }) => isolateExternalData(context));

test("opens within its measured startup budget @smoke", async ({ page }, testInfo) => {
  const startedAt = Date.now();
  await page.goto("/helix/");
  // The first thing a new account is shown. Waiting on a real heading — not on
  // a network event — is what makes this the user's startup and not the
  // server's.
  await expect(page.getByRole("heading", { name: "Hoş geldin", exact: true })).toBeVisible();
  const firstScreenMs = Date.now() - startedAt;

  // The paint HAS happened — the heading above is on screen — but Chromium
  // fills the paint-timing buffer asynchronously, so reading it straight away
  // returns null on roughly one run in eight. Measured, not guessed: eight
  // consecutive runs gave 320, 356, 348, 516, null, 356, 356, 368 ms. Waiting
  // for the entry turns that race into a wait; asserting it exists without
  // waiting is what made this test flaky in a full suite run.
  await page.waitForFunction(
    () => performance.getEntriesByType("paint").some((entry) => entry.name === "first-contentful-paint"),
    null,
    { timeout: 10_000 },
  );
  const paint = await page.evaluate(() =>
    performance.getEntriesByType("paint").find((entry) => entry.name === "first-contentful-paint")?.startTime ?? null,
  );

  // Every script the document itself pulls in — the initial load, before any
  // navigation. Route code lives in here on purpose (see the asyncRoutes
  // decision in `.ai/INVARIANTS.md`), so this is the honest figure.
  const initialScriptBytes = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry): entry is PerformanceResourceTiming => entry.entryType === "resource")
      .filter((entry) => entry.initiatorType === "script")
      .reduce((total, entry) => total + (entry.decodedBodySize || entry.transferSize || 0), 0),
  );

  await testInfo.attach("startup", {
    body: JSON.stringify({ firstScreenMs, firstContentfulPaintMs: paint, initialScriptBytes }, null, 2),
    contentType: "application/json",
  });

  expect(firstScreenMs, "first usable screen").toBeLessThan(FIRST_SCREEN_BUDGET_MS);
  // Still asserted: the wait above can only end with the entry present, so a
  // null here would mean the metric itself disappeared.
  expect(paint, "first-contentful-paint entry").not.toBeNull();
  expect(paint ?? Infinity, "first contentful paint").toBeLessThan(FIRST_CONTENTFUL_PAINT_BUDGET_MS);
  expect(initialScriptBytes, "scripts fetched before the first screen").toBeLessThan(INITIAL_SCRIPT_BUDGET_BYTES);
  // And that it measured anything at all: a zero here would pass every ceiling
  // above while proving nothing.
  expect(initialScriptBytes, "resource timing available").toBeGreaterThan(500_000);
});

/**
 * The ledger is built before the user asks for it, not during the transition.
 *
 * A bottom-tab screen mounts on first focus by default, which puts the whole
 * tree — build, style, commit — on the thread that is drawing the navigator's
 * fade. Measured at 6x CPU throttling on the exact sequence the owner
 * described (sit on the dashboard, reload, go straight to Mali Tablo): two long
 * tasks, 112ms, the longest 58ms, and nothing on any later visit.
 * `useWarmRoute` moves that into idle.
 *
 * The assertion is the STATE, not the timing. A long-task threshold on a CI
 * runner is a coin toss; "the table exists before anyone opened its tab" is the
 * thing that has to stay true, and it is exactly what stops being true if the
 * warm-up is removed or the navigator stops honouring `preload`.
 */
test("has the ledger mounted before its tab is opened", async ({ page }) => {
  await page.goto("/helix/");
  await expect(page.getByRole("heading", { name: "Hoş geldin", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hemen Kullanmaya Başla" }).click();
  const skipTour = page.getByRole("button", { name: "Geç", exact: true });
  await skipTour.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  if (await skipTour.isVisible().catch(() => false)) await skipTour.click();
  await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();

  // The dashboard is still the selected tab; the ledger's own column headers
  // are nonetheless in the tree, which can only be true if it was preloaded.
  await expect(page.getByTestId("table-column-label").first()).toBeAttached({ timeout: 15_000 });
  await expect(page.getByRole("tab", { name: "Durum", selected: true })).toBeVisible();
});
