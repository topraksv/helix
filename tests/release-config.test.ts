import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const app = JSON.parse(read("app.json"));
const eas = JSON.parse(read("eas.json"));
const ci = read(".github/workflows/ci.yml");
const security = read(".github/workflows/security.yml");
const nightly = read(".github/workflows/nightly.yml");
const keepalive = read(".github/workflows/keepalive.yml");
const dependabot = read(".github/dependabot.yml");
const packageJson = JSON.parse(read("package.json"));
const packageLock = JSON.parse(read("package-lock.json"));
const easPreviewPath = resolve(process.cwd(), ".eas/workflows/deploy-preview.yml");

function dependabotRule(dependency: string) {
  const marker = `      - dependency-name: "${dependency}"`;
  const start = dependabot.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = dependabot.indexOf("\n      - dependency-name:", start + marker.length);
  return dependabot.slice(start, next === -1 ? undefined : next);
}

describe("release contract", () => {
  it("targets the Expo Go runtime without standalone-build configuration", () => {
    expect(app.expo.runtimeVersion).toEqual({ policy: "sdkVersion" });
    expect(app.expo.updates).toBeUndefined();
    expect(app.expo.extra.eas.projectId).toBe("f71b0477-c800-45cc-903a-9b4d32a9c6b4");
    expect(app.expo.ios.bundleIdentifier).toBe("com.toprak.helix");
    expect(app.expo.android.package).toBe("com.toprak.helix");
    expect(app.expo.android.allowBackup).toBe(false);
    expect(packageJson.dependencies.expo).toMatch(/^~54\./);
    expect(eas.cli.version).toBe("21.4.0");
    expect(eas.build).toBeUndefined();
    expect(eas.submit).toBeUndefined();
    expect(packageJson.engines.node).toBe("^22");
  });

  it("keeps web recovery and offline caches inside narrow browser boundaries", () => {
    const html = read("src/app/+html.tsx");
    const serviceWorker = read("public/sw.js");
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
    expect(html).toContain("trustedSupabaseOrigin(process.env.EXPO_PUBLIC_SUPABASE_URL)");
    expect(html).not.toContain("https://*.supabase.co");
    expect(html).toContain('"frame-src \'none\'"');
    expect(serviceWorker).toContain('const CACHE = "helix-v2"');
    expect(serviceWorker).toContain('res.ok && contentType.startsWith("text/html")');
    expect(serviceWorker.indexOf('contentType.startsWith("text/html")'))
      .toBeLessThan(serviceWorker.indexOf("cache.put(SHELL, res.clone())"));
  });

  it("publishes one Expo Go preview update and never searches for or creates a binary", () => {
    expect(existsSync(easPreviewPath)).toBe(false);
    const mobile = ci.slice(ci.indexOf("  deploy-mobile:"));
    const deploy = mobile.split("\n").find((line) => line.includes(".bin/eas update"));
    expect(deploy).toBeDefined();
    expect(deploy).toMatch(/\.\/node_modules\/\.bin\/eas update /);
    expect(deploy).toContain("--branch preview");
    expect(deploy).toContain("--platform all");
    expect(deploy).toContain("--clear-cache");
    expect(deploy).toContain("--non-interactive");
    expect(deploy).not.toContain("@latest");
    expect(mobile).not.toMatch(/workflow:run|fingerprint|get-build|eas\s+build|eas\s+submit|type:\s*(build|submit)/);
    expect(mobile).not.toMatch(/APPLE_|ASC_|provision/i);
  });

  it("runs every release check somewhere in CI, and each of them once", () => {
    for (const command of [
      "npm run typecheck",
      "npx expo lint",
      "npm test",
      "node scripts/check-advisories.mjs",
      "npx expo export -p web --clear",
      "npm run bundle:check",
    ]) {
      expect(ci.split(command).length - 1, command).toBe(1);
    }
    // One export per run. The deploy consumes the artifact the budget check
    // ran against; a second export there could serve unchecked bytes.
    expect(ci.split("npx expo export").length - 1).toBe(1);
    expect(ci).not.toContain("verify:release");
  });

  it("gates the deploys on the checks but decides them from the classifier", () => {
    // Both edges matter. `needs: [classify, gate]` orders a deploy after the
    // checks; the condition reads `classify` directly because forwarding the
    // decision through `gate`'s outputs resolved to an empty string and
    // skipped both deploys on a green run.
    for (const job of ["deploy-web", "deploy-mobile"] as const) {
      const decision = job === "deploy-web" ? "deploy_web" : "deploy_mobile";
      const condition = ci.slice(ci.indexOf(`  ${job}:\n`), ci.indexOf("steps:", ci.indexOf(`  ${job}:\n`)));
      expect(condition, job).toContain("needs: [classify, gate]");
      // `!cancelled()` is load-bearing: without it GitHub propagates the
      // upstream skip through `gate`'s `always()` and this job never runs.
      expect(condition, job).toContain("!cancelled()");
      expect(condition, job).toContain("needs.gate.result == 'success'");
      expect(condition, job).toContain(`needs.classify.outputs.${decision} == 'true'`);
    }
    expect(ci).not.toContain("needs.gate.outputs");
  });

  it("builds the E2E export once and shares it with both shards", () => {
    // Each shard used to run its own `test:e2e:export`: a second full Metro
    // bundle, and two shards testing two separately-produced artifacts.
    expect(ci.split("npm run test:e2e:export").length - 1, "one E2E export per run").toBe(1);
    const build = ci.slice(ci.indexOf("  e2e-build:"), ci.indexOf("  e2e-full:"));
    expect(build).toContain("npm run test:e2e:export");
    expect(build).toContain("actions/upload-artifact");
    expect(build).toContain("if-no-files-found: error");
    const full = ci.slice(ci.indexOf("  e2e-full:"), ci.indexOf("  gate:"));
    expect(full).toContain("needs: [classify, e2e-build]");
    expect(full).toContain("actions/download-artifact");
    expect(full).toContain("path: dist-e2e");
    // Both shards must consume the same named artifact.
    const artifact = "dist-e2e-${{ github.run_id }}";
    expect(build).toContain(artifact);
    expect(full).toContain(artifact);
    // …and must not rebuild it, which `npm run test:e2e` would.
    expect(full).not.toContain("npm run test:e2e");
    expect(full).toContain("npx playwright test --shard=");
  });

  it("splits the browser suite by risk and shards the full run", () => {
    expect(ci).toContain("npm run test:e2e:smoke");
    expect(ci).toContain("npx playwright install chromium --with-deps");
    // Sharding across runners is the only parallelism: this suite drives one
    // browser against one static server and goes flaky with two workers.
    expect(ci).not.toMatch(/workers:\s*[2-9]/);
    // The shard count is read from the workflow rather than pinned here, but
    // the matrix and the flag have to agree — a matrix of three feeding
    // `--shard=n/2` silently drops a third of the suite.
    const shardCount = ci.match(/--shard=\${{ matrix\.shard }}\/(\d+)/)?.[1];
    expect(shardCount, "ci declares a shard count").toBeDefined();
    expect(ci).toContain(`shard: [${Array.from({ length: Number(shardCount) }, (_, i) => i + 1).join(", ")}]`);
    expect(nightly).toContain(`--shard=\${{ matrix.shard }}/${shardCount}`);
    expect(nightly).toContain(`shard: [${Array.from({ length: Number(shardCount) }, (_, i) => i + 1).join(", ")}]`);
    // Playwright splits by FILE unless `fullyParallel` is set, and this suite's
    // specs are very unevenly sized — measured, two shards took 65 and 10 of
    // the 75 tests. Balance is what makes a shard count worth raising.
    expect(read("playwright.config.ts")).toContain("fullyParallel: true");
    expect(nightly.split("npm run test:e2e:export").length - 1).toBe(1);
    expect(nightly).toContain("nightly-dist-e2e-${{ github.run_id }}");
    expect(nightly).toContain("actions/upload-artifact");
    expect(nightly).toContain("actions/download-artifact");
    const nightlySuite = nightly.slice(nightly.indexOf("  full-suite:"));
    expect(nightlySuite).not.toContain("npm run test:e2e");
    // The nightly run reports; it never publishes. No deploy job, no Pages
    // artifact, no EAS dispatch and no write permission to reach them with.
    expect(nightly).not.toMatch(/^\s+deploy[\w-]*:$/m);
    expect(nightly).not.toMatch(/deploy-pages|upload-pages-artifact|eas-cli/);
    expect(nightly).toMatch(/permissions:\n\s+contents: read/);
  });

  it("cancels a superseded run rather than certifying a stale commit", () => {
    expect(ci).toMatch(
      /concurrency:\n\s+group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n\s+cancel-in-progress: true/,
    );
  });

  it("lets the gate accept a skipped job but never a failed one", () => {
    expect(ci).toMatch(/gate:\n\s+if: always\(\)/);
    expect(ci).toContain("success|skipped) ;;");
  });

  it("blocks delivery on dependency advisories while keeping CodeQL advisory", () => {
    expect(security).toContain("github/codeql-action/init");
    // The gate names each accepted advisory instead of relaxing the threshold.
    // Assert against the executed lines: the surrounding comments legitimately
    // discuss the escapes this job refuses to take.
    const commands = security.split("\n").filter((line) => /^\s*(-\s*)?(run|uses|continue-on-error):/.test(line));
    expect(commands.join("\n")).toContain("node scripts/check-advisories.mjs");
    for (const line of commands) {
      expect(line, line).not.toMatch(/--audit-level=(moderate|low|info)|--omit=dev|continue-on-error/);
    }
    expect(security).toContain("cron:");
    expect(security).toContain("package-lock.json");
    const quality = ci.slice(ci.indexOf("  quality:"), ci.indexOf("  web-build:"));
    expect(quality).toContain("node scripts/check-advisories.mjs");
    expect(quality.indexOf("node scripts/check-advisories.mjs")).toBeLessThan(quality.indexOf("npm ci"));
    // A README or Markdown edit must not wake a scanner: the push trigger is
    // an allowlist of paths, and none of them is documentation.
    const paths = security.slice(security.indexOf("paths:")).split("\n").slice(1);
    const listed = paths.filter((line) => line.trim().startsWith("- ")).map((line) => line.trim());
    expect(listed.length).toBeGreaterThan(0);
    for (const entry of listed) expect(entry, entry).not.toMatch(/\.md|README/);
    // CodeQL stays out of the delivery path; only the deterministic advisory
    // policy over this commit's lockfile blocks it.
    expect(ci).not.toContain("codeql");
  });

  it("removes the checkout token before dependency or build code runs", () => {
    for (const [name, workflow] of Object.entries({ ci, security, nightly })) {
      const checkouts = workflow.split("uses: actions/checkout@").length - 1;
      const removals = workflow.split("persist-credentials: false").length - 1;
      expect(removals, name).toBe(checkouts);
    }
  });

  it("pins every third-party action to a full commit SHA", () => {
    for (const [name, workflow] of Object.entries({ ci, security, nightly, keepalive })) {
      const refs = [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
      for (const ref of refs) expect(ref, `${name}: ${ref}`).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it("pins the EAS CLI that publishes after the gate", () => {
    const mobile = ci.slice(ci.indexOf("  deploy-mobile:"));
    const deploy = mobile.split("\n").find((line) => line.includes(".bin/eas update"));
    expect(deploy).toBeDefined();
    expect(deploy).toMatch(/\.\/node_modules\/\.bin\/eas update/);
    expect(deploy).not.toContain("@latest");
    expect(mobile).not.toMatch(/npx\s+eas-cli@/);

    const expectedVersion = eas.cli.version;
    expect(packageJson.devDependencies["eas-cli"]).toBe(expectedVersion);
    const locked = packageLock.packages["node_modules/eas-cli"];
    expect(locked.version).toBe(expectedVersion);
    expect(locked.resolved).toBe(`https://registry.npmjs.org/eas-cli/-/eas-cli-${expectedVersion}.tgz`);
    expect(locked.integrity).toMatch(/^sha512-/);

    expect(packageJson.overrides["eas-cli@21.4.0"]["minimatch@5.1.2"]).toBe("5.1.9");
    const patchedMinimatch = packageLock.packages["node_modules/eas-cli/node_modules/minimatch"];
    expect(patchedMinimatch.version).toBe("5.1.9");
    expect(patchedMinimatch.integrity).toMatch(/^sha512-/);
    const unrelatedMinimatch = packageLock.packages[
      "node_modules/eas-cli/node_modules/@expo/prebuild-config/node_modules/minimatch"
    ];
    expect(unrelatedMinimatch.version).toBe("9.0.9");
  });

  it("withholds the Expo publish credential from dependency installation", () => {
    const mobile = ci.slice(ci.indexOf("  deploy-mobile:"));
    const jobHeader = mobile.slice(0, mobile.indexOf("    steps:"));
    expect(jobHeader).not.toContain("EXPO_TOKEN");

    const installAt = mobile.indexOf("- run: npm ci");
    const publishAt = mobile.indexOf("- name: Publish Expo Go preview update");
    expect(installAt).toBeGreaterThanOrEqual(0);
    expect(publishAt).toBeGreaterThan(installAt);
    const publishStep = mobile.slice(publishAt);
    expect(publishStep).toContain("EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}");
    expect(publishStep).toContain("./node_modules/.bin/eas update");
  });

  it("denies the repository token to the standalone keepalive job", () => {
    expect(keepalive).toMatch(/\npermissions: \{\}\n\njobs:/);
  });

  it("no longer carries the removed skill-verification gate", () => {
    expect(Object.keys(packageJson.scripts)).not.toContain("verify:skills");
    expect(ci).not.toContain("verify:skills");
  });

  it("keeps SDK-managed version updates in the coordinated Expo backlog", () => {
    for (const dependency of [
      "expo*",
      "babel-preset-expo",
      "react",
      "react-dom",
      "@types/react",
      "react-native",
      "react-native-web",
      "react-native-safe-area-context",
      "react-native-screens",
      "react-native-svg",
      "eslint-config-expo",
    ]) {
      const rule = dependabotRule(dependency);
      expect(rule).toContain("version-update:semver-patch");
      expect(rule).toContain("version-update:semver-minor");
      expect(rule).toContain("version-update:semver-major");
    }
    const eslintRule = dependabotRule("eslint");
    expect(eslintRule).toContain("version-update:semver-patch");
    expect(eslintRule).toContain("version-update:semver-minor");
    expect(eslintRule).toContain("version-update:semver-major");
    expect(dependabotRule("typescript")).toContain("version-update:semver-major");
  });
});
