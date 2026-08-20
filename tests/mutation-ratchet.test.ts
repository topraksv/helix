/**
 * The mutation ratchet replaced an absolute threshold of 98 that no real
 * product diff had ever met — the run that selected it measured 54.22. A gate
 * that cannot pass gets routed around, and the previous release was shipped
 * from a `workflow_dispatch` that ran sentinels instead. These assertions are
 * what stop the replacement from being a gate in name only: it has to fail on
 * a file that got worse, on a file nobody measured, and on an entry whose file
 * is gone.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluate, scoreOf, scoresFromReport } from "../scripts/check-mutation-ratchet.mjs";
import { selectMutationScope } from "../stryker.ci.config.mjs";

const baseline = (files: Record<string, number>) => ({
  measuredOn: "abc",
  measuredDate: "2026-08-19",
  files: Object.fromEntries(Object.entries(files).map(([name, score]) => [name, { score }])),
});
const present = () => true;

describe("mutation score", () => {
  it("counts a timeout as detected and no-coverage against the total", () => {
    expect(scoreOf([{ status: "Killed" }, { status: "Timeout" }])).toBe(100);
    expect(scoreOf([{ status: "Killed" }, { status: "Survived" }])).toBe(50);
    // NoCoverage is the difference between Stryker's two columns; the ratchet
    // tracks the total, so an untested mutant must drag the score down.
    expect(scoreOf([{ status: "Killed" }, { status: "NoCoverage" }])).toBe(50);
  });

  it("reads a file with nothing to mutate as complete rather than as zero", () => {
    expect(scoreOf([])).toBe(100);
  });

  it("derives per-file scores from a report", () => {
    const report = { files: { "a.ts": { mutants: [{ status: "Killed" }, { status: "Survived" }] } } };
    expect(scoresFromReport(report)).toEqual({ "a.ts": 50 });
  });
});

describe("ratchet", () => {
  it("passes a file that held its score", () => {
    const { problems } = evaluate({ "a.ts": 62.08 }, baseline({ "a.ts": 62.08 }), present);
    expect(problems).toEqual([]);
  });

  it("fails a file that detects less than it used to", () => {
    const { problems } = evaluate({ "a.ts": 55 }, baseline({ "a.ts": 62.08 }), present);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("REGRESSED a.ts");
    expect(problems[0]).toContain("62.08");
    expect(problems[0]).toContain("55.00");
  });

  /**
   * A low baseline is a measurement, not permission to go lower. Every file
   * recorded on 2026-08-19 is held to its own number, including the ones that
   * scored near zero because per-test coverage cannot attribute the repo
   * layer's integration tests.
   */
  it("holds a file recorded at zero to zero", () => {
    expect(evaluate({ "a.ts": 0 }, baseline({ "a.ts": 0 }), present).problems).toEqual([]);
    // There is nothing below zero, so the guard that matters is the next one up.
    const { problems } = evaluate({ "b.ts": 9 }, baseline({ "b.ts": 21.05 }), present);
    expect(problems[0]).toContain("REGRESSED b.ts");
  });

  // Tolerance is half a point below the recorded score: 62.08 - 0.5 = 61.58.
  it("absorbs runner variance but not a real drop", () => {
    expect(evaluate({ "a.ts": 61.7 }, baseline({ "a.ts": 62.08 }), present).problems).toEqual([]);
    expect(evaluate({ "a.ts": 61.6 }, baseline({ "a.ts": 62.08 }), present).problems).toEqual([]);
    expect(evaluate({ "a.ts": 61.5 }, baseline({ "a.ts": 62.08 }), present).problems).toHaveLength(1);
  });

  it("refuses a mutated file nobody has measured", () => {
    const { problems } = evaluate({ "new.ts": 91 }, baseline({ "a.ts": 50 }), present);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("UNBASELINED new.ts");
    // Adopting it silently at whatever it scores is the failure being prevented.
    expect(problems[0]).toContain("npm run mutation:baseline");
  });

  it("refuses an entry whose file is gone", () => {
    const { problems } = evaluate({}, baseline({ "deleted.ts": 50 }), () => false);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("STALE deleted.ts");
  });

  it("reports an improvement without failing, so it can be locked in", () => {
    const { problems, improvements } = evaluate({ "a.ts": 80 }, baseline({ "a.ts": 62.08 }), present);
    expect(problems).toEqual([]);
    expect(improvements).toEqual(["a.ts: 62.08 -> 80.00"]);
  });
});

describe("recorded baseline", () => {
  const recorded = JSON.parse(readFileSync("mutation-baseline.json", "utf8"));

  /**
   * Provenance is per FILE, not per document.
   *
   * One document-level "measured on" claimed every entry came from the current
   * tree, but a run only ever covers the scope it was given — so recording a
   * scope of eleven files rewrote the stamp on thirteen it never touched.
   */
  it("says which tree each entry was measured on, not one date for all of them", () => {
    expect(Object.keys(recorded)).toEqual(["files"]);
    const entries = Object.entries(recorded.files) as [string, Record<string, unknown>][];
    expect(entries.length).toBeGreaterThan(0);
    for (const [file, entry] of entries) {
      expect(entry.measuredOn, file).toMatch(/^[0-9a-f]{40}$/);
      expect(entry.measuredDate, file).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  /**
   * Every scope the selector can produce has to be covered.
   *
   * The first baseline was taken from one release's diff, which left the
   * sentinel scope — what a push that touches no mutated path falls back to —
   * entirely unrecorded. That is not a hypothetical: the very next push
   * touched only scripts and workflows, fell back to sentinels, and would have
   * failed the gate on nine UNBASELINED files. The ratchet was behaving
   * correctly; the baseline was incomplete.
   */
  it("covers every file the sentinel scope can select", () => {
    const sentinels = selectMutationScope({ base: "", head: "", eventName: "workflow_dispatch", cwd: process.cwd() });
    expect(sentinels.length).toBeGreaterThan(0);
    const missing = sentinels.filter((file: string) => recorded.files[file] === undefined);
    expect(missing, `unrecorded sentinel file(s): ${missing.join(", ")}`).toEqual([]);
  });

  it("carries the counts behind every score, so a number can be re-derived", () => {
    interface Entry {
      score: number;
      killed: number;
      timeout: number;
      survived: number;
      noCoverage: number;
    }
    const entries = Object.entries(recorded.files) as [string, Entry][];
    expect(entries.length).toBeGreaterThan(0);
    for (const [file, entry] of entries) {
      for (const field of ["score", "killed", "timeout", "survived", "noCoverage"] as const) {
        expect(entry[field], `${file}.${field}`).toBeTypeOf("number");
      }
      const detected = entry.killed + entry.timeout;
      const valid = detected + entry.survived + entry.noCoverage;
      const derived = valid === 0 ? 100 : Number(((detected / valid) * 100).toFixed(2));
      expect(derived, file).toBe(entry.score);
    }
  });
});
