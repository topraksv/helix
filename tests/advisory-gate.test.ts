import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { blockingAdvisories, evaluate } from "../scripts/check-advisories.mjs";

const advisory = (id: string, severity: string, name = "pkg") => ({
  source: 1,
  name,
  title: `${name} is broken`,
  url: `https://github.com/advisories/${id}`,
  severity,
});

const report = (vulnerabilities: Record<string, unknown>) => ({ vulnerabilities });
const ack = (id: string) => [{ id, package: "pkg", checkedOn: "2026-07-28", reason: "proven unreachable" }];

describe("advisory gate", () => {
  it("collects one entry per advisory, not per affected package", () => {
    // 25 packages were flagged by a single brace-expansion advisory. Counting
    // packages instead of advisories made the report unreadable and hid how
    // few decisions were actually being made.
    const found = blockingAdvisories(
      report({
        a: { via: [advisory("GHSA-x", "high")] },
        b: { via: ["a", advisory("GHSA-x", "high")] },
        c: { via: [advisory("GHSA-y", "critical")] },
      }),
    );
    expect([...found.keys()].sort()).toEqual(["GHSA-x", "GHSA-y"]);
    expect([...found.get("GHSA-x")!.affected].sort()).toEqual(["a", "b"]);
  });

  it("ignores transitive edges and anything below high", () => {
    const found = blockingAdvisories(
      report({
        a: { via: ["depends-on-b"] },
        b: { via: [advisory("GHSA-moderate", "moderate")] },
        c: { via: [advisory("GHSA-low", "low")] },
      }),
    );
    expect([...found.keys()]).toEqual([]);
  });

  it("fails on an advisory nobody has examined", () => {
    const { problems } = evaluate(report({ a: { via: [advisory("GHSA-new", "high")] } }), []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("UNACKNOWLEDGED GHSA-new");
  });

  it("still fails when a new advisory appears beside an accepted one", () => {
    const { problems } = evaluate(
      report({ a: { via: [advisory("GHSA-known", "high")] }, b: { via: [advisory("GHSA-new", "critical")] } }),
      ack("GHSA-known"),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("GHSA-new");
  });

  it("fails on an acknowledgement that outlived its advisory", () => {
    // Otherwise the list silently becomes a permanent exemption for something
    // that was fixed upstream years ago.
    const { problems } = evaluate(report({}), ack("GHSA-fixed"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("STALE GHSA-fixed");
  });

  it("passes only when every blocking advisory is accounted for", () => {
    const { problems, accepted } = evaluate(
      report({ a: { via: [advisory("GHSA-known", "high")] } }),
      ack("GHSA-known"),
    );
    expect(problems).toEqual([]);
    expect(accepted).toHaveLength(1);
  });

  it("keeps the real acknowledgement list minimal and evidenced", () => {
    const source = readFileSync(resolve(process.cwd(), "scripts/check-advisories.mjs"), "utf8");
    const ids = [...source.matchAll(/id: "(GHSA-[^"]+)"/g)].map((match) => match[1]);
    expect(ids.length, "every exemption is a decision; keep the list short").toBeLessThanOrEqual(3);
    for (const id of ids) expect(source).toMatch(new RegExp(`${id}[\\s\\S]{0,400}checkedOn: "\\d{4}-\\d{2}-\\d{2}"`));
    // The threshold itself must never be quietly relaxed.
    expect(source).toContain('new Set(["high", "critical"])');
  });
});
