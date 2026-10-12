import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { MARKET_DATA_HOST, MARKET_PAIRS, MARKET_RANGES } from "../../src/domain/market";
import { sourceFiles } from "../source-corpus";
import { dirname, join, relative, resolve } from "node:path";

/**
 * The module graph, asserted rather than described.
 *
 * The repository asks that these directions stay one proven pattern instead of
 * a third style, but nothing failed when a file drifted the other way. A
 * dependency direction is cheap to break by accident (one convenient import in
 * a screen) and expensive to unwind later, so it is checked here — statically,
 * with no runtime cost.
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

});

/**
 * `SPEC.md` names the files that cite each section; this checks they do.
 *
 * The citation is how you get from a module to the rules it implements: every
 * module header in the older layers carries one, as `(spec §2.2)`. `AGENTS.md`
 * states the relationship in the other direction too — SPEC reconstructs "the
 * product sections cited by source files" — so a section nobody cites is a
 * section the code cannot lead you to.
 *
 * A section nobody cites is a section the code cannot lead you to: the ten
 * older sections were at 24/24, which is what makes a gap legible as drift
 * rather than as a convention nobody follows.
 */
describe("spec citations", () => {
  /**
   * The specification is not in the repository.
   *
   * It is the owner's own working document and is deliberately untracked, so a
   * clone does not have it and this guard has nothing to compare source
   * citations against. It runs on the machine that holds the document — which
   * is the machine where a citation can actually drift — and stands down
   * elsewhere rather than failing a build for a file it was never given.
   */
  const specPath = join(ROOT, "docs/SPEC.md");
  const spec = existsSync(specPath) ? readFileSync(specPath, "utf8") : "";
  /** `## §3.9 — Card statement import` → id plus its body. */
  const sections = spec.split(/^## /m).slice(1)
    .flatMap((block) => {
      const id = (block.match(/^(§[0-9]+(?:\.[0-9]+)?[a-z]?)/) ?? [])[1];
      return id ? [{ id, cites: [...block.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1] ?? "") }] : [];
    });

  const present = spec !== "";

  it.skipIf(!present)("finds the sections and their citing-file lists", () => {
    // Same floor rule `sourceFiles` applies: a parse that silently returns
    // nothing would make every assertion below pass while checking nothing.
    expect(sections.length).toBeGreaterThanOrEqual(16);
    expect(sections.every((section) => section.cites.length > 0)).toBe(true);
  });

  it.skipIf(!present)("has every cited file carry its own section marker", () => {
    const offenders = sections.flatMap((section) => section.cites
      .filter((file) => !readFileSync(join(ROOT, file), "utf8").includes(section.id))
      .map((file) => `${file} is missing ${section.id}`));
    expect(offenders).toEqual([]);
  });
});

/** These screens import react-native, so the wiring is asserted from source. */
describe("undo callbacks are owned everywhere", () => {
  it("makes the shared snackbar await and report every discovered undo", () => {
    const callers = sourceFiles("src", { extensions: [".tsx"], atLeast: 100 })
      .map((file) => join(ROOT, file))
      .filter((file) => readFileSync(file, "utf8").includes("undo.show("));
    expect(callers.length).toBeGreaterThanOrEqual(10);
    const primitive = readFileSync(join(ROOT, "src/ui/undo.tsx"), "utf8");
    expect(primitive).toContain("await runUndo");
    expect(primitive).toContain("tr.errors.undoFailed");
    for (const caller of callers) {
      expect(readFileSync(caller, "utf8"), caller).not.toMatch(/undo\.show\([^;]+\(\) => void /s);
    }
  });

  /** A wrapper that catches its own failure resolves, so the bar reports success and drops its retry: pass the repository call straight through. */
  it("lets a failed revert or unskip reach the snackbar instead of swallowing it", () => {
    const text = readFileSync(join(ROOT, "src/app/reconciliation.tsx"), "utf8");
    expect(text).toMatch(/undo\.show\([^;]*revertExpected\(userId, e\.id\)/s);
    expect(text).toMatch(/undo\.show\([^;]*unskipExpected\(userId, e\.id\)/s);
  });

  it("keeps the skip flow owned as well", () => {
    const text = readFileSync(join(ROOT, "src/app/reconciliation.tsx"), "utf8");
    expect(text).not.toMatch(/void skipExpected\(/);
    expect(text).toMatch(/const skip = async/);
    expect(text).toContain("operationGuard.run");
    expect(text).toContain("unskipExpected");
  });
});

describe("web document policy", () => {
  /** The CSP must name every host the app calls; it reads the market host from the feed's module so the two cannot diverge. */
  it("lets the document reach the market feed it is built to read", () => {
    const html = readFileSync(join(ROOT, "src/app/+html.tsx"), "utf8");
    // The directive itself, which is a template literal — not the paragraph
    // above it that happens to explain what `connect-src` is for.
    // To the end of its LINE: the directive interpolates a nested template
    // literal, so a backtick-delimited match stops halfway through it.
    const connect = /`connect-src.*$/m.exec(html)?.[0] ?? "";
    expect(connect).toContain("MARKET_DATA_HOST");
    // Interpolated, not spelled out a second time under a different name.
    expect(html).toContain('import { MARKET_DATA_HOST } from "../domain/market";');
    expect(html).not.toContain(MARKET_DATA_HOST);
  });
});

/**
 * The proxy's boundary, read from its source.
 *
 * `supabase/functions/market-proxy` is a Deno function: it imports nothing this
 * toolchain can resolve and `tsconfig.json` excludes the directory on purpose,
 * so it cannot be imported and called here. What CAN be held is the thing that
 * actually matters — that the allowlists in it still match the app's, and that
 * it never builds a URL from what a caller sent.
 *
 * The hazard is specific. A function that fetches a URL a client chose is a way
 * to make arbitrary requests from Supabase's network, at this project's expense
 * and under its name. This one takes a symbol and an interval and builds the
 * URL itself; these assertions are what stop that quietly becoming a `url`
 * parameter later.
 */
const proxySource = readFileSync(join(ROOT, "supabase/functions/market-proxy/index.ts"), "utf8");

describe("market proxy", () => {
  it("builds the upstream URL itself and never takes one", () => {
    // A caller-supplied URL is the whole hazard; there must be no way in.
    expect(proxySource).not.toMatch(/body\.url|params\.get\("url"\)|searchParams\.get\("url"\)/);
    expect(proxySource).toContain("const UPSTREAM_HOST = \"data-api.binance.vision\"");
    // Every fetch target is built from the constant host.
    for (const match of proxySource.matchAll(/fetch\(([^)]*)\)/g)) {
      expect(match[1], "a fetch that does not go through upstreamUrl").toMatch(/\burl\b/);
    }
    expect(proxySource, "the host is interpolated, not received").toContain("https://${UPSTREAM_HOST}");
  });

  it("allows exactly the books the app asks for, and no others", () => {
    const allowed = /const SYMBOLS = new Set\(\[([^\]]*)\]\)/.exec(proxySource)?.[1] ?? "";
    const symbols = [...allowed.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(symbols, "the proxy's basket is the app's basket").toEqual([...MARKET_PAIRS].sort());
  });

  it("allows exactly the intervals the ranges use", () => {
    const allowed = /const INTERVALS = new Set\(\[([^\]]*)\]\)/.exec(proxySource)?.[1] ?? "";
    const intervals = [...allowed.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    const used = [...new Set(Object.values(MARKET_RANGES).map((range) => range.interval))].sort();
    expect(intervals, "a range the app can ask for must be allowed, and nothing more").toEqual(used);
  });

  it("caps the candle count above what any range needs and below a year of minutes", () => {
    const cap = Number(/const MAX_LIMIT = (\d+)/.exec(proxySource)?.[1]);
    const largest = Math.max(...Object.values(MARKET_RANGES).map((range) => range.limit));
    expect(cap, "every range must fit").toBeGreaterThanOrEqual(largest);
    expect(cap, "and nothing much beyond it").toBeLessThan(largest * 3);
  });

  it("refuses anything that is not the one shape it serves", () => {
    expect(proxySource, "only POST, because that is what invoke sends").toContain('request.method !== "POST"');
    expect(proxySource, "an unknown kind is refused rather than guessed").toContain('return json({ error: "unsupported" }, 400)');
    expect(proxySource, "a body that will not parse is refused").toContain('return json({ error: "body" }, 400)');
    expect(proxySource, "and the upstream gets a deadline").toContain("UPSTREAM_TIMEOUT_MS");
  });

  it("carries nothing of the owner's, and says so", () => {
    // The request is a public symbol name. Anything that looked like user data
    // crossing this boundary would be a privacy change, not a networking one.
    expect(proxySource).not.toMatch(/user_id|userId|email|access_token|session/i);
    expect(proxySource, "the reason is written down where the next reader is").toContain("carries no user data");
  });
});

describe("item breakdown credit-card split call pattern", () => {
  it("keeps the screen's own call pattern off the per-month path", () => {
    const source = readFileSync(join(ROOT, "src/app/(tabs)/cash-flow/item.tsx"), "utf8");
    expect(source).toContain("creditCardSplitsByMonth");
    expect(source).not.toMatch(/creditCardSplit\(/);
  });
});

describe("balance declaration wiring", () => {
  it("is written when a balance is confirmed, and read where it matters", () => {
    const editor = readFileSync(join(ROOT, "src/ui/opening-balance-editor.tsx"), "utf8");
    expect(editor).toContain("setBalanceDeclaration(userId, target.minor, todayISO())");
    for (const path of ["src/app/(tabs)/index.tsx", "src/app/(tabs)/cash-flow/index.tsx"]) {
      expect(readFileSync(join(ROOT, path), "utf8")).toContain("balanceDeclarationDrift(");
    }
  });
});

describe("live screen contract", () => {
  const screens = [
    ...sourceFiles("src/app", { extensions: [".tsx"], atLeast: 40 }),
    ...sourceFiles("src/ui", { extensions: [".tsx"], atLeast: 25 }),
  ];
  const stateHook = /\buse(?:Categories|Persons|Sources|Subscriptions|Plans|CreditCardStatements|RecurringIncomes|ComputedColumns|CategoryBudgets|TransactionsBetween|AllTransactions|Adjustments|SettingsMap|Ledger|PendingExpected|LastEntryInfo)State\(/;

  it("gives every stateful financial-data screen a shared loading/retry notice", () => {
    for (const file of screens) {
      const source = readFileSync(join(ROOT, file), "utf8");
      if (stateHook.test(source)) expect(source, file).toContain("DataStateNotice");
    }
  });

});
