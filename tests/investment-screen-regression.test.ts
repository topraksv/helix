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
});
