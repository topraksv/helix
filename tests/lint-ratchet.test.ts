/**
 * The lint ratchet, tested the way the mutation one is: on its decision, not
 * on its output.
 *
 * A gate that nobody checks is how 262 warnings accumulated in the first
 * place, so the three things this script decides — what the report says, what
 * counts as worse, and what counts as new — each get a case. The measurement
 * itself (spawning ESLint) is not tested here; it is what the gate does every
 * run and a test that repeated it would only be slower.
 */
import { describe, expect, it } from "vitest";
import { countsFrom, evaluate, parseLintReport } from "../scripts/check-lint-ratchet.mjs";

describe("lint report parsing", () => {
  it("finds the JSON even behind the CLI's own preamble", () => {
    // `expo lint` prints `env: load .env` and similar before the report, so a
    // parser that assumed the output began with `[` read nothing at all.
    const report = parseLintReport('env: load .env\nenv: export FOO\n[{"filePath":"a.tsx","messages":[],"errorCount":0,"warningCount":0}]\n');
    expect(report).toHaveLength(1);
    expect(report[0].filePath).toBe("a.tsx");
  });

  it("refuses output that carries no report rather than reporting zero", () => {
    // The failure that matters: a run that produced no JSON must not look like
    // a clean tree. Silence is the one answer a ratchet may never accept.
    expect(() => parseLintReport("env: load .env\nSomething went wrong\n")).toThrow(/no ESLint JSON report/);
  });

  it("counts warnings by rule and errors as a total", () => {
    const { rules, errors } = countsFrom([
      { errorCount: 1, messages: [{ ruleId: "complexity", severity: 1 }, { ruleId: "no-undef", severity: 2 }] },
      { errorCount: 0, messages: [{ ruleId: "complexity", severity: 1 }, { ruleId: "react-hooks/refs", severity: 1 }] },
    ]);
    // Severity 2 is an error and is never ratcheted — it fails outright — so
    // it must not appear among the counted warnings.
    expect(rules).toEqual({ complexity: 2, "react-hooks/refs": 1 });
    expect(errors).toBe(1);
  });

  it("attributes a message with no rule id rather than dropping it", () => {
    // A parse error arrives as a message with `ruleId: null`. Dropping it
    // would let a file that ESLint could not read reduce the count.
    const { rules } = countsFrom([{ errorCount: 0, messages: [{ ruleId: null, severity: 1 }] }]);
    expect(rules).toEqual({ "(no rule)": 1 });
  });
});

describe("lint ratchet decisions", () => {
  const baseline = { rules: { complexity: 100, "react-hooks/refs": 134 } };

  it("passes a tree that fires no more than it did", () => {
    const { problems } = evaluate({ complexity: 100, "react-hooks/refs": 134 }, baseline);
    expect(problems).toEqual([]);
  });

  it("fails a rule that fires more often, naming both numbers", () => {
    const { problems } = evaluate({ complexity: 101, "react-hooks/refs": 134 }, baseline);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("complexity: 100 -> 101");
  });

  it("fails a rule nobody has decided about, instead of adopting it", () => {
    // The same rule `check-mutation-ratchet.mjs` holds: a finding enters this
    // gate deliberately. A new rule quietly starting at 40 would otherwise
    // become the number every later run is measured against.
    const { problems } = evaluate({ complexity: 100, "react-hooks/refs": 134, "no-shadow": 40 }, baseline);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("NEW RULE no-shadow");
  });

  it("reports a rule that improved, and one that stopped firing entirely", () => {
    const { problems, improvements } = evaluate({ complexity: 90 }, baseline);
    expect(problems).toEqual([]);
    expect(improvements).toContain("complexity: 100 -> 90");
    expect(improvements).toContain("react-hooks/refs: 134 -> 0");
  });
});

describe("the recorded baseline", () => {
  it("matches the shape the script writes and reads", async () => {
    const baseline = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync("lint-baseline.json", "utf8")));
    expect(Object.keys(baseline).sort()).toEqual(["rules", "total"]);
    expect(baseline.total).toBe(Object.values(baseline.rules).reduce((sum: number, n) => sum + Number(n), 0));
    // A floor: an empty baseline would make every later run "new rule" and an
    // all-zero one would make every run pass.
    expect(Object.keys(baseline.rules).length).toBeGreaterThan(0);
    expect(baseline.total).toBeGreaterThan(0);
  });
});
