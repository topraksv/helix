import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

import { appVersionOf, entryOf, otaRecord, storeSdkMajor } from "../../scripts/check-published.mjs";

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

  // What push protection cannot see: a value that reaches the bundle from a
  // build environment rather than from a commit. The credentials are assembled
  // at runtime so this file does not itself carry the shapes it tests for.
  it("rejects a server credential anywhere in the export, naming the file and never the value", () => {
    const secret = ["sb", "secret", "x".repeat(24)].join("_");
    const { root } = fixture(`var key="${secret}";`);
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("serverCredentialReferences: 1");
    expect(result.stderr).toContain(`Supabase secret key in ${join("_expo", "static", "js", "web", "entry-test.js")}`);
    expect(result.stdout + result.stderr).not.toContain(secret);
  });

  it("tells a service-role JWT from the anon one that ships by design", () => {
    const token = (role: string) => [
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({ iss: "supabase", role })).toString("base64url"),
      Buffer.from("not-a-real-signature").toString("base64url"),
    ].join(".");
    expect(check(fixture(`var anon="${token("anon")}";`).root).status).toBe(0);
    const leaked = check(fixture(`var admin="${token("service_role")}";`).root);
    expect(leaked.status).toBe(1);
    expect(leaked.stderr).toContain("service-role JWT in");
  });
});

/**
 * What `scripts/check-published.mjs` counts as published.
 *
 * Each case is a way such a check passes or fails for the wrong reason: an
 * escaped manifest a plain search cannot see, a library's version standing in
 * for the app's, a preview SDK read as the stores' client, a publication
 * missing a platform, and a live site answering 200 with the previous build.
 */
describe("published surfaces", () => {
  const publishedScript = resolve(process.cwd(), "scripts/check-published.mjs");
  const app = JSON.parse(readFileSync("app.json", "utf8")).expo;
  // Expo embeds the app config as a JSON string, so its quotes arrive escaped.
  const bundleDeclaring = (version: string) =>
    `var lib={"name":"some-lib","version":"9.9.9"};get manifest(){return"${
      JSON.stringify({ name: "Helix", slug: app.slug, version }).replaceAll('"', '\\"')
    }"}`;

  it("reads the app's version from the escaped manifest, never a library's", () => {
    expect(appVersionOf(bundleDeclaring("1.2.3"), app.slug)).toBe("1.2.3");
    expect(appVersionOf('var lib={"name":"some-lib","version":"9.9.9"};', app.slug)).toBeNull();
  });

  it("finds the entry bundle below the site's base path", () => {
    expect(entryOf('<script src="/helix/_expo/static/js/web/entry-0123abcd.js" defer></script>'))
      .toBe("/_expo/static/js/web/entry-0123abcd.js");
    expect(entryOf("<html></html>")).toBeNull();
  });

  it("reads the stores' SDK as the newest released one, not the newest listed", () => {
    // Trimmed from api.expo.dev on 2026-09-15, which listed 58 as a preview.
    expect(storeSdkMajor({
      "58.0.0": { expoVersion: "~58.0.0-preview.1", iosClientVersion: "58.0.0" },
      "57.0.0": { expoVersion: "~57.0.22", iosClientVersion: "57.0.9" },
      "56.0.0": { expoVersion: "~56.0.0", iosClientVersion: "56.0.4" },
    })).toBe(57);
    expect(storeSdkMajor({})).toBeNull();
  });

  it("accepts one update per platform on the SDK's runtime, and nothing less", () => {
    const update = (platform: string, runtimeVersion = "exposdk:57.0.0") => ({
      id: `${platform}-id`,
      group: "group-1",
      platform,
      runtimeVersion,
      message: "1.8.0 abc",
      manifestPermalink: `https://u.expo.dev/${platform}`,
    });
    const record = otaRecord([update("ios"), update("android")], 57);
    expect(record.problems).toEqual([]);
    expect(record.summary.join("\n")).toContain("`group-1`");
    expect(otaRecord([update("ios")], 57).problems).toEqual(["expected one update per platform, got [ios]"]);
    expect(otaRecord([update("ios"), update("android", "exposdk:56.0.0")], 57).problems)
      .toEqual(["the android update targets exposdk:56.0.0, not exposdk:57.0.0"]);
  });

  it("passes a live site only when it serves this build's entry bundle and version", async () => {
    const entry = "/_expo/static/js/web/entry-0123abcd.js";
    const routes: Record<string, string> = {
      "/helix/": `<script src="/helix${entry}"></script>`,
      [`/helix${entry}`]: bundleDeclaring(app.version),
      "/helix/upcoming": "<html></html>",
    };
    const server = createServer((request, response) => {
      const body = routes[request.url ?? ""];
      response.writeHead(body == null ? 404 : 200);
      response.end(body ?? "");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/helix/`;
    const run = (...args: string[]) => new Promise<{ status: number | null; output: string }>((done) => {
      const child = spawn(process.execPath, [publishedScript, "web", base, ...args]);
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (output += chunk));
      child.on("close", (status) => done({ status, output }));
    });
    try {
      const live = await run("--entry", entry);
      expect(live.status, live.output).toBe(0);

      const stale = await run("--entry", "/_expo/static/js/web/entry-ffff0000.js", "--wait", "0");
      expect(stale.status).toBe(1);
      expect(stale.output).toContain("this run built /_expo/static/js/web/entry-ffff0000.js");

      routes[`/helix${entry}`] = bundleDeclaring("0.0.1");
      const behind = await run("--entry", entry);
      expect(behind.status).toBe(1);
      expect(behind.output).toContain(`production is not serving ${app.version}: the live bundle declares 0.0.1`);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});
