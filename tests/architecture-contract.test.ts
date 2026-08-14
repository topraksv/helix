import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { sourceFiles } from "./source-corpus";
import { dirname, join, relative, resolve } from "node:path";

/**
 * The module graph, asserted rather than described.
 *
 * These directions are the repository's one proven pattern rather than a
 * third style, but nothing
 * failed when a file drifted the other way. A dependency direction is cheap to
 * break by accident (one convenient import in a screen) and expensive to
 * unwind later, so it is checked here — statically, with no runtime cost.
 */

const ROOT = process.cwd();
const SRC = join(ROOT, "src");



/**
 * Static, side-effect and dynamic specifiers alike. A lazy `import()` is still
 * a dependency, and so is a bare `import "./x"` — which is exactly the shape
 * that would slip past a `from`-only reader.
 */
function importSpecifiers(source: string): string[] {
  return [
    ...[...source.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g)],
    ...[...source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)],
    ...[...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)],
  ].map((match) => match[1] ?? "");
}

function resolveLocal(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"), base]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not this extension; keep looking.
    }
  }
  return null;
}

// One floor for the whole graph: `src` is ~200 modules, so anything near
// zero means the walk, not the codebase, changed.
const files = sourceFiles("src", { atLeast: 150 }).map((path) => join(ROOT, path));
const graph = new Map<string, string[]>(
  files.map((file) => [
    file,
    importSpecifiers(readFileSync(file, "utf8"))
      .flatMap((specifier) => {
        const target = resolveLocal(file, specifier);
        return target ? [target] : [];
      }),
  ]),
);
const layerOf = (file: string): string => relative(SRC, file).split("/")[0] ?? "";
const show = (file: string): string => relative(ROOT, file);

/**
 * The guard the other contract tests now stand on. If it can be satisfied by
 * an empty walk, so can every test that uses it — which is the failure it
 * exists to prevent, so it is asserted rather than assumed.
 */
describe("source corpus", () => {
  it("refuses a corpus smaller than the floor the caller declared", () => {
    expect(() => sourceFiles("src/i18n", { atLeast: 2 })).toThrow(/expected at least 2/);
    expect(sourceFiles("src/i18n", { atLeast: 1 })).toEqual(["src/i18n/tr.ts"]);
  });

  it("honours the extension filter and the skipped directories", () => {
    expect(sourceFiles("src/db", { extensions: [".sql"], skip: [], atLeast: 5 }).every((p) => p.endsWith(".sql"))).toBe(true);
    // `migrations` is skipped by default, so the same walk finds no SQL at all.
    expect(() => sourceFiles("src/db", { extensions: [".sql"], atLeast: 1 })).toThrow(/yielded 0 source files/);
  });
});

describe("module graph", () => {
  it("has no import cycles", () => {
    const state = new Map<string, 1 | 2>();
    const stack: string[] = [];
    const cycles: string[] = [];
    const visit = (node: string): void => {
      state.set(node, 1);
      stack.push(node);
      for (const next of graph.get(node) ?? []) {
        if (!graph.has(next)) continue;
        if (state.get(next) === 1) {
          cycles.push([...stack.slice(stack.indexOf(next)), next].map(show).join(" → "));
        } else if (!state.has(next)) visit(next);
      }
      stack.pop();
      state.set(node, 2);
    };
    for (const file of files) if (!state.has(file)) visit(file);
    expect(cycles).toEqual([]);
  });

  it("keeps the domain layer pure", () => {
    // The financial core is the one part of this codebase that must stay
    // testable without a database, a renderer or a network — every rule in it
    // is verified by a plain function call.
    const offenders = files
      .filter((file) => layerOf(file) === "domain")
      .flatMap((file) => (graph.get(file) ?? [])
        .filter((target) => !["domain", "i18n"].includes(layerOf(target)))
        .map((target) => `${show(file)} → ${show(target)}`));
    expect(offenders).toEqual([]);
  });

  it("keeps routes as leaves nothing else imports", () => {
    // Expo Router owns `src/app`. A shared thing living in a route file is a
    // shared thing that cannot move without breaking a URL.
    const offenders = files
      .filter((file) => layerOf(file) !== "app")
      .flatMap((file) => (graph.get(file) ?? [])
        .filter((target) => layerOf(target) === "app")
        .map((target) => `${show(file)} → ${show(target)}`));
    expect(offenders).toEqual([]);
  });

  it("routes persistence through the data layer instead of the database", () => {
    // `src/db` is the async driver and the schema. A screen reaching it
    // directly bypasses `writeRows`, the outbox and every ownership check with
    // it. The one exception is boot: the root layout runs the migrations.
    const offenders = files
      .filter((file) => ["ui", "app"].includes(layerOf(file)) && !file.endsWith("app/_layout.tsx"))
      .flatMap((file) => (graph.get(file) ?? [])
        .filter((target) => layerOf(target) === "db")
        .map((target) => `${show(file)} → ${show(target)}`));
    expect(offenders).toEqual([]);
  });

  it("reaches persistence through the repo facade rather than its internals", () => {
    // `src/data/repo.ts` is the stable surface; `src/data/repo/*` is how it is
    // currently built. A screen importing an internal pins the split in place,
    // so the facade stops being free to change behind it. The rule was written
    // down long before anything asserted it, which is exactly how an invariant
    // decays without anyone noticing.
    const offenders = files
      .filter((file) => ["ui", "app"].includes(layerOf(file)))
      .flatMap((file) => (graph.get(file) ?? [])
        .filter((target) => /\/data\/repo\/[^/]+$/.test(target))
        .map((target) => `${show(file)} → ${show(target)}`));
    expect(offenders).toEqual([]);
  });

  it("keeps double casts out of the layers that decide what gets written", () => {
    // `as unknown as` is the strongest cast the language has: it turns off
    // every check between two types. In `src/ui` it is how react-native-web
    // exposes a DOM node behind a React Native ref, which has no honest type.
    // Below that it was hiding a real one — a lookup that could return
    // `undefined` was cast to a row, and boot maintenance would have thrown on
    // it rather than skipped it.
    const offenders = files
      .filter((file) => !["ui"].includes(layerOf(file)))
      .filter((file) => /\bas unknown as\b/.test(readFileSync(file, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")))
      .map(show);
    expect(offenders).toEqual([]);
  });

  it("draws icons from their own modules, never the package barrel", () => {
    // Metro does not tree-shake. `lucide-react-native` re-exports ~1_757 icons
    // from its root, so ONE value import from there put all of them in the
    // entry bundle — measured in the shipped file, which carried Aperture,
    // Rocket and Telescope for an app that draws 106 icons. Deep paths took
    // 1_766_475 bytes (34.7%) out of it. `import type { LucideIcon }` is fine:
    // a type-only import is erased before it reaches the bundler.
    const offenders = files
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return [...source.matchAll(/import\s+(type\s+)?\{[^}]*\}\s+from\s+"lucide-react-native";/g)]
          .some((match) => match[1] === undefined);
      })
      .map(show);
    expect(offenders).toEqual([]);
  });

  it("keeps `data/repo.ts` the only repository surface routes and UI can see", () => {
    const facade = join(SRC, "data", "repo.ts");
    const offenders = files
      .filter((file) => ["ui", "app"].includes(layerOf(file)))
      .flatMap((file) => (graph.get(file) ?? [])
        .filter((target) => target.startsWith(join(SRC, "data", "repo")) && target !== facade)
        .map((target) => `${show(file)} → ${show(target)}`));
    expect(offenders).toEqual([]);
  });
});
