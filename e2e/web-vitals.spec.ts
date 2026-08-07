/**
 * What the app costs the user AFTER it has opened.
 *
 * `startup.spec.ts` bounds the first paint and `scripts/check-web-budget.mjs`
 * bounds the bytes. Neither says anything about the two metrics a person
 * actually feels once they are inside a financial table: how long a tap takes
 * to produce a frame, and whether the page moves under their finger while they
 * are reading it.
 *
 * Interaction to Next Paint is the metric this shape of app is most exposed to
 * — a wide grid, live queries behind every control, derivations on the same
 * thread — and it is the one most sites fail. Cumulative Layout Shift is the
 * one an app that measures its own text is exposed to: `Amount` walks down a
 * font ladder after it has been laid out once, and a ladder that walks too far
 * is a table that visibly reflows after it has been read.
 *
 * The ceilings are the published "good" thresholds with headroom for a CI
 * runner, not micro-benchmarks: they exist to catch a change that puts a
 * synchronous derivation on the tap path or reintroduces an unreserved box,
 * not to police 20ms.
 */

import { expect, test } from "@playwright/test";
import { addMarketExpense, isolateExternalData, onboard, openCashFlow } from "./helpers";

/** Google's "good" INP is 200ms at the 75th percentile of real users. A single
 *  cold CI run is a worse sample than that, so the ceiling is doubled: what is
 *  being caught here is an interaction that became O(ledger), not one that
 *  slipped by 30ms. */
const INP_BUDGET_MS = 400;
/** "Good" CLS is 0.1. Nothing in this app is allowed to move at all after it
 *  settles, so the budget is well inside it. */
const CLS_BUDGET = 0.05;

/** Arm both observers before the interactions that have to be measured. */
async function observeVitals(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as { __vitals: { events: number[]; shifts: number[] } };
    store.__vitals = { events: [], shifts: [] };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // The interaction's whole latency, input delay through to the frame —
        // which is what INP measures and what `duration` carries.
        const event = entry as PerformanceEntry & { interactionId?: number };
        if (event.interactionId) store.__vitals.events.push(entry.duration);
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        // A shift the user caused by tapping is not a layout shift against
        // them; CLS excludes the 500ms after an input for exactly that reason.
        if (!shift.hadRecentInput) store.__vitals.shifts.push(shift.value);
      }
    }).observe({ type: "layout-shift", buffered: true } as PerformanceObserverInit);
  });
}

async function readVitals(page: import("@playwright/test").Page) {
  const { events, shifts } = await page.evaluate(
    () => (window as unknown as { __vitals: { events: number[]; shifts: number[] } }).__vitals,
  );
  return {
    interactions: events.length,
    worstInteractionMs: Math.round(Math.max(0, ...events)),
    cumulativeLayoutShift: Number(shifts.reduce((total, value) => total + value, 0).toFixed(4)),
  };
}

test("answers a pointer inside the interaction budget, and does not move under it", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await isolateExternalData(page.context());
  await onboard(page);
  await addMarketExpense(page, "vitals");

  await observeVitals(page);

  // The real interaction mix, not a synthetic click loop: a tab change, the
  // ledger's own controls, and a round trip back. Each one is a place where a
  // derivation could land on the tap path.
  await openCashFlow(page);
  await page.getByRole("tab", { name: "Durum" }).click();
  await openCashFlow(page);
  const columnLabel = page.getByTestId("table-column-label").first();
  if (await columnLabel.count()) await columnLabel.click({ trial: true }).catch(() => {});
  await page.getByRole("tab", { name: "Ayarlar" }).click();
  await page.getByRole("tab", { name: "Durum" }).click();
  // Let the last frame and any late shift land before reading.
  await page.waitForTimeout(1_500);

  const vitals = await readVitals(page);
  await testInfo.attach("web-vitals", { body: JSON.stringify(vitals, null, 2), contentType: "application/json" });

  // A run that measured nothing would pass every ceiling below.
  expect(vitals.interactions, "interactions observed").toBeGreaterThan(0);
  expect(vitals.worstInteractionMs, "slowest interaction").toBeLessThan(INP_BUDGET_MS);
  expect(vitals.cumulativeLayoutShift, "cumulative layout shift").toBeLessThan(CLS_BUDGET);
});
