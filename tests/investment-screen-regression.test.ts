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
    const investments = readFileSync(join(root, "src/app/(tabs)/investments/index.tsx"), "utf8");
    const charts = readFileSync(join(root, "src/ui/charts.tsx"), "utf8");

    expect(investments).toContain("ordered.length === 0");
    expect(investments).toContain("tr.investments.distributionEmpty");
    expect(charts).toContain('testID="donut-empty-state"');
    expect(charts).toContain("tr.analysis.chartEmpty");
  });

  it("keeps investment entry actions primary and separated from the date field", () => {
    const operation = readFileSync(join(root, "src/app/(tabs)/investments/operation.tsx"), "utf8");
    const opening = readFileSync(join(root, "src/ui/opening-balance-editor.tsx"), "utf8");
    const addProduct = operation.slice(operation.indexOf("{products.length === 0"), operation.indexOf("</Card>", operation.indexOf("{products.length === 0")));

    expect(addProduct).toContain('marginBottom: spacing.md');
    expect(addProduct).not.toContain('variant="secondary"');
    expect(opening).toContain("historyOpeningAction} onPress");
  });
});
