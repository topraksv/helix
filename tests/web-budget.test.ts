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

function check(root: string, args: string[] = [], options: { env?: Record<string, string>; cwd?: string } = {}) {
  return spawnSync(process.execPath, [script, root, ...args], {
    encoding: "utf8",
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });
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

  // Metro's transform cache is shared by `expo export` and `eas update` and its
  // key ignores EXPO_PUBLIC_* values, so a cache left by the local-only E2E
  // export yields a bundle with no Supabase configuration — sign-in and sync
  // silently gone, invisible to every other budget metric.
  it("rejects a production export that lost its Supabase configuration", () => {
    const { root } = fixture("console.log('no config here');");
    const result = check(root, ["--require-supabase-config"], {
      env: { EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co" },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("supabaseConfigInlined: false");
    expect(result.stderr).toContain("Re-export with --clear");
  });

  it("accepts a production export that carries it, and says so when there is none to carry", () => {
    const configured = fixture("var u='https://example.supabase.co';");
    expect(check(configured.root, ["--require-supabase-config"], {
      env: { EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co" },
    }).status).toBe(0);

    // A local-only build is legitimate; the skip is printed, never assumed. Run
    // from the fixture directory so the repository's own `.env` cannot answer
    // for an environment that genuinely has none.
    const local = fixture();
    const result = check(local.root, ["--require-supabase-config"], {
      cwd: local.root,
      env: { EXPO_PUBLIC_SUPABASE_URL: "" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("supabaseConfigInlined: skipped");
  });
});
