import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("investment screen recovery", () => {
  it("does not turn a ready projection failure into an empty page", () => {
    const source = readFileSync(join(root, "src/app/(tabs)/investments/index.tsx"), "utf8");

    expect(source).toContain('status={status === "ready" ? "error" : status}');
  });

  it("lets the edit removal row use the full form width at every viewport", () => {
    const source = readFileSync(join(root, "src/app/(tabs)/investments/operation.tsx"), "utf8");
    const removal = source.slice(source.indexOf("{editing ? ("), source.lastIndexOf("</Screen>"));

    expect(removal).toContain('width: "100%"');
    expect(removal).toContain('alignSelf: "stretch"');
    expect(removal).toContain('justifyContent: "space-between"');
    expect(removal).toContain("flexShrink: 1");
    expect(removal).not.toContain("maxWidth: 520");
  });

  it("keeps empty investment distribution visible and meaningful", () => {
    const charts = readFileSync(join(root, "src/ui/charts.tsx"), "utf8");

    // The screen no longer answers this for itself. A phone used to get a
    // column of ranked bars with its own empty case; every breakpoint now
    // draws the shared ring, so the empty state is the ring's — one answer to
    // maintain instead of two that could disagree about what "no data" looks
    // like.
    expect(charts).toContain('testID="donut-empty-state"');
    expect(charts).toContain("tr.analysis.chartEmpty");
  });

  it("draws the same ring at every breakpoint, phone included", () => {
    // The distribution is one fact and had two pictures: a ring where there
    // was a pointer, ranked bars where there was not — so the surface with no
    // hover was also the only one where a holding could not be selected at
    // all. `Donut` carries the selection, the lock and the readout, and it is
    // the same component the analysis screen draws.
    const source = readFileSync(join(root, "src/app/(tabs)/investments/index.tsx"), "utf8");
    const heroStart = source.indexOf("onLayout={onHeroLayout}");
    const heroCard = source.slice(heroStart, source.indexOf("</HeroCard>", heroStart));

    expect(heroCard).not.toContain("AllocationStrip");
    expect(source).not.toContain("function AllocationStrip");
    // Three branches — compact, desktop, and the middle band — and each one
    // reaches the ring through the same testID the E2E suite looks for.
    expect(heroCard.split('testID="investment-distribution-chart"').length - 1).toBe(3);
  });

  /**
   * The wallet ring builds its marks through the shared rule, not by hand.
   *
   * Free cash was painted in `palette.surfaceStrong` here, which is 1.55
   * against the ring's own empty track: the largest slice in the wallet looked
   * like the part of the ring that had not been drawn, and locking it painted
   * the centre readout in the same invisible colour. `tests/theme-contrast`
   * owns why no surface token can be a mark; this owns that the screen goes
   * through `walletDonutSlices` to get one.
   */
  it("takes every wallet ring colour from the shared series ramp", () => {
    const source = readFileSync(join(root, "src/app/(tabs)/investments/index.tsx"), "utf8");
    const slices = source.slice(source.indexOf("const slices = "), source.indexOf("const totalCapital"));

    expect(slices).toContain("walletDonutSlices({");
    expect(slices).not.toMatch(/color:\s*palette\./);
    // The empties stay in the list: the index is the colour slot, so dropping
    // a zeroed type would recolour every type below it.
    expect(slices).toContain("INVESTMENT_ASSET_TYPES.map(");
    expect(slices).not.toContain("flatMap");
  });

  it("keeps investment entry actions primary and separated from the date field", () => {
    const operation = readFileSync(join(root, "src/app/(tabs)/investments/operation.tsx"), "utf8");
    const opening = readFileSync(join(root, "src/ui/opening-balance-editor.tsx"), "utf8");
    const addProduct = operation.slice(operation.indexOf("{products.length === 0"), operation.indexOf("</Card>", operation.indexOf("{products.length === 0")));

    expect(addProduct).toContain('marginBottom: spacing.md');
    expect(addProduct).not.toContain('variant="secondary"');
    expect(opening).toContain("historyOpeningAction} onPress");
  });

  it("puts the metric strip inside the balance column at every breakpoint that shows the ring beside it", () => {
    // The ring is centred against whichever column it shares a row with. When
    // the metric strip lived outside that row on the middle band but inside
    // it on desktop, the two breakpoints centred the ring against a
    // different height and it landed at a visibly different point in the
    // card depending on window width alone.
    const source = readFileSync(join(root, "src/app/(tabs)/investments/index.tsx"), "utf8");
    const heroStart = source.indexOf("onLayout={onHeroLayout}");
    const heroCard = source.slice(heroStart, source.indexOf("</HeroCard>", heroStart));
    const desktopStart = heroCard.indexOf(") : desktop ? (");
    const middleStart = heroCard.indexOf(") : (", desktopStart + 1);
    const desktopBranch = heroCard.slice(desktopStart, middleStart);
    const middleBranch = heroCard.slice(middleStart);

    for (const branch of [desktopBranch, middleBranch]) {
      const cashAt = branch.indexOf("{cashSummary}");
      const metricsAt = branch.indexOf("{portfolioMetrics}");
      const ringAt = branch.indexOf('testID="investment-distribution-chart"');
      expect(cashAt).toBeGreaterThan(-1);
      expect(metricsAt).toBeGreaterThan(cashAt);
      expect(ringAt).toBeGreaterThan(metricsAt);
    }
  });
});
