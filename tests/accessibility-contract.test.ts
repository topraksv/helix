import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

function tsxFiles(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? tsxFiles(path) : entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("accessibility source contract", () => {
  it("never hides user text with truncation props", () => {
    for (const file of tsxFiles("src")) {
      const contents = source(file);
      expect(contents, file).not.toMatch(/numberOfLines|ellipsizeMode/);
    }
  });

  it("keeps shared controls labelled, stateful and error-announcing", () => {
    const components = source("src/ui/components.tsx");
    expect(components).toContain("accessibilityLabelledBy");
    expect(components).toContain('accessibilityLiveRegion="assertive"');
    expect(components).toContain("busy: Boolean(loading)");
    expect(components).toContain('accessibilityRole="radio"');
  });

  it("keeps every custom modal surface isolated from background focus", () => {
    for (const file of ["src/ui/components.tsx", "src/ui/dialog.tsx", "src/ui/calendar.tsx", "src/ui/calculator.tsx", "src/ui/tour.tsx"]) {
      expect(source(file), file).toContain("accessibilityViewIsModal");
    }
  });

  it("keeps chart alternatives and password-manager metadata", () => {
    expect(source("src/ui/charts.tsx")).toContain('accessibilityRole="image"');
    expect(source("src/app/(auth)/sign-in.tsx")).toContain('autoComplete="email"');
    expect(source("src/app/(auth)/sign-in.tsx")).toContain('autoComplete={mode === "signIn" ? "current-password" : "new-password"}');
  });
});
