import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  borderWidth,
  controlSize,
  elevation,
  font,
  iconSize,
  layer,
  radius,
  stateOpacity,
  toggleSize,
  type,
} from "../src/ui/theme";

const root = process.cwd();

function sourceFiles(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("design-system metric contracts", () => {
  it("keeps compact controls, touch targets and regular fields distinct", () => {
    expect(controlSize).toEqual({
      compact: 36,
      minimumTarget: 44,
      regular: 48,
      inputAccessoryWidth: 42,
      inputAccessoryInset: 44,
    });
    expect(controlSize.compact).toBeLessThan(controlSize.minimumTarget);
    expect(controlSize.minimumTarget).toBeLessThan(controlSize.regular);
    expect(iconSize).toEqual({ compact: 15, control: 17, accessory: 18 });
    expect(borderWidth).toEqual({ control: 1.5, toggle: 1 });
  });

  it("preserves exact geometry while replacing historical arithmetic aliases", () => {
    expect(radius.md).toBe(radius.sm + 2);
    expect(toggleSize).toEqual({ width: 46, height: 28, padding: 3 });
    expect(layer.dragActive).toBe(10);
    expect(elevation.dragActive).toBe(6);
  });

  it("keeps distinct disabled and transient-state weights intentional", () => {
    expect(stateOpacity).toEqual({
      buttonDisabled: 0.45,
      iconDisabled: 0.4,
      controlDisabled: 0.5,
      fieldDisabled: 0.6,
      pressed: 0.85,
      calendarDisabled: 0.3,
      dragActive: 0.96,
    });
  });
});

describe("design-system typography contracts", () => {
  it("maps semantic control text to the loaded font faces without changing metrics", () => {
    expect(type.button).toEqual({ fontSize: 15, fontFamily: font.medium });
    expect(type.buttonCompact).toEqual({ fontSize: 13, fontFamily: font.medium });
    expect(type.field).toEqual({ fontSize: 15, fontFamily: font.regular });
    expect(type.moneyInput).toEqual({
      fontSize: 17,
      fontFamily: font.semibold,
      fontVariant: ["tabular-nums"],
    });
  });

  it("keeps raw Inter face names inside the theme and font loader only", () => {
    const offenders = sourceFiles("src").filter((path) => {
      if (path === "src/ui/theme.ts" || path === "src/app/_layout.tsx") return false;
      return /Inter_[4567]00/.test(readFileSync(join(root, path), "utf8"));
    });
    expect(offenders).toEqual([]);
  });
});
