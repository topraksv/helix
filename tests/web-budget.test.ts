import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const script = resolve(process.cwd(), "scripts/check-web-budget.mjs");

function fixture(bundle = "console.log('ok');") {
  const root = mkdtempSync(join(tmpdir(), "helix-web-budget-"));
  roots.push(root);
  const js = join(root, "_expo", "static", "js", "web");
  mkdirSync(js, { recursive: true });
  writeFileSync(join(js, "entry-test.js"), bundle);
  return { root, js };
}

function check(root: string) {
  return spawnSync(process.execPath, [script, root], { encoding: "utf8" });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("web release budget", () => {
  it("accepts a bounded export without public debugging data", () => {
    const { root } = fixture();
    const result = check(root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("sourceMapFiles: 0");
    expect(result.stdout).toContain("sourceMapReferences: 0");
  });

  it("rejects source-map files and bundle references", () => {
    const { root, js } = fixture("console.log('mapped');\n//# sourceMappingURL=entry-test.js.map");
    writeFileSync(join(js, "entry-test.js.map"), "{}");
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Public source maps found");
    expect(result.stderr).toContain("Public source-map references found");
  });
});
