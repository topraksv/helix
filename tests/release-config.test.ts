import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const app = JSON.parse(read("app.json"));
const eas = JSON.parse(read("eas.json"));
const ci = read(".github/workflows/ci.yml");
const classifier = read("scripts/classify-changes.mjs");
/**
 * The two documents this suite checks are not in the repository.
 *
 * `AGENTS.md` and `docs/RELEASE.md` are the owner's own working notes and are
 * deliberately untracked, so a clone does not have them. Reading them at load
 * would make every test in this file fail on a machine that is only building
 * the app. They are read when present — which is the machine that has them,
 * where the check is worth something — and the two assertions that need them
 * are skipped where they are not.
 *
 * This is a guard about a document agreeing with the workflow, so it can only
 * run where the document is. Nothing else in this file depends on them.
 */
const readIfPresent = (path: string) => {
  const full = resolve(process.cwd(), path);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
};
const agents = readIfPresent("AGENTS.md");
const release = readIfPresent("docs/RELEASE.md");
const documented = agents != null && release != null;
const security = read(".github/workflows/security.yml");
const nightly = read(".github/workflows/nightly.yml");
const keepalive = read(".github/workflows/keepalive.yml");
const database = read(".github/workflows/database.yml");
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
  /**
   * The three facts that make an OTA safe here, and the one that would stop
   * making it safe.
   *
   * `sdkVersion` is correct for exactly one distribution model: Expo Go, which
   * runs an update against the SDK's own runtime and therefore has no binary to
   * be incompatible with. It is the WRONG policy for a standalone build,
   * because it does not change when the native project does — a new native
   * module, a plugin edit, an SDK bump in the config — so an OTA would be
   * delivered to a binary that cannot run it, which is a white screen on a
   * phone that was working a minute ago. Expo's `fingerprint` policy exists for
   * that case: it hashes the native project and moves whenever the runtime
   * does.
   *
   * So the two must move together. The moment this project gains standalone
   * build configuration — `eas.build`, an `updates` URL, a build profile — the
   * policy has to become `fingerprint` BEFORE the next update is published, and
   * this test fails until it does.
   */
  it("targets the Expo Go runtime without standalone-build configuration", () => {
    const standalone = Boolean(app.expo.updates || eas.build || existsSync(easPreviewPath));
    expect(app.expo.runtimeVersion).toEqual({ policy: standalone ? "fingerprint" : "sdkVersion" });
    expect(app.expo.updates).toBeUndefined();
    expect(app.expo.extra.eas.projectId).toBe("f71b0477-c800-45cc-903a-9b4d32a9c6b4");
    expect(app.expo.ios.bundleIdentifier).toBe("com.toprak.helix");
    expect(app.expo.android.package).toBe("com.toprak.helix");
    expect(app.expo.android.allowBackup).toBe(false);
    expect(packageJson.dependencies.expo).toMatch(/^~57\./);
    expect(eas.cli.version).toBe("23.2.0");
    expect(eas.build).toBeUndefined();
    expect(eas.submit).toBeUndefined();
    expect(packageJson.engines.node).toBe("^22");
  });

  /**
   * A server render has no database, and three files have to agree on that.
   *
   * `web.output` is "static", so every route is rendered once in Node. Left
   * alone that pass drags the whole SQLite driver — and on SDK 57 its Web
   * Worker, which Metro then cannot chunk for a server bundle — into a render
   * that could never open a database anyway. `metro.config.js` substitutes the
   * stub, the stub says what it answers with, and the mutation gate excludes it
   * because a throw has no behaviour to mutate. Any one of the three drifting
   * from the other two puts the driver back.
   */
  it("keeps the database out of server rendering", () => {
    const metro = read("metro.config.js");
    const stub = read("src/db/expo-sqlite.server.js");
    const stryker = read("stryker.ci.config.mjs");

    expect(app.expo.web.output).toBe("static");
    expect(metro).toContain('moduleName === "expo-sqlite"');
    expect(metro).toContain("src/db/expo-sqlite.server.js");
    // Both server environments Expo names, and no client one.
    expect(metro).toContain('"node"');
    expect(metro).toContain('"react-server"');

    // The three runtime imports the app makes from `expo-sqlite`. A fourth
    // added later resolves to `undefined` on the server unless it lands here.
    for (const name of ["openDatabaseAsync", "deleteDatabaseAsync", "addDatabaseChangeListener"]) {
      expect(stub, `${name} must be answered for the server`).toContain(name);
    }
    expect(stryker).toContain("expo-sqlite\\.server\\.js");
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

  /**
   * The multi-tab lock screen, the boot-failure retry screen and the
   * database-recovery notice all render before `RootLayoutInner` ever mounts,
   * so `_layout.tsx`'s one `documentElement.style.colorScheme` assignment —
   * pinned below to confirm it stays that single, late occurrence — cannot
   * have run yet. Without a document-level default declared here, a browser
   * whose OS dark mode is on and that auto-adapts pages which don't declare
   * their own `color-scheme` (a real, commonly-on Edge/Chrome setting)
   * repaints those screens with its own heuristic, over colours that were
   * already correct — text measured at 1.9:1 against its own background
   * where the underlying HTML/CSS carries 8:1. Declared twice, because
   * Chromium's computed style does not reflect the meta tag's effect, only
   * the CSS rule's — a regression here would otherwise pass a check that
   * only grepped for the meta tag and ship silently broken again.
   */
  it("declares its own color scheme before any script can, so a browser never auto-darkens an undeclared page", () => {
    const html = read("src/app/+html.tsx");
    expect(html).toContain('<meta name="color-scheme" content="light dark" />');
    expect(html.replace(/\s+/g, "")).toContain(":root{color-scheme:lightdark}");

    const layout = read("src/app/_layout.tsx");
    const assignments = [...layout.matchAll(/documentElement\.style\.colorScheme\s*=/g)];
    expect(assignments, "exactly one place may claim a scheme once the owner's preference is known").toHaveLength(1);
    // That one assignment sits inside `RootLayoutInner`, which mounts only
    // after `dbReady` — everything the outer `RootLayout` can render (the
    // three screens named above) is before this point in the file and never
    // reaches it.
    expect(layout.indexOf("function RootLayoutInner")).toBeLessThan(assignments[0]!.index!);
  });

  it("publishes one Expo Go preview update and never searches for or creates a binary", () => {
    expect(existsSync(easPreviewPath)).toBe(false);
    const mobile = ci.slice(ci.indexOf("  deploy-mobile:"));
    const deploy = mobile.split("\n").find((line) => line.includes("eas-cli@") && line.includes(" update "));
    expect(deploy).toBeDefined();
    expect(deploy).toMatch(/npx --yes eas-cli@\d+\.\d+\.\d+ update /);
    expect(deploy).toContain("--branch preview");
    expect(deploy).toContain("--platform all");
    expect(deploy).toContain("--clear-cache");
    expect(deploy).toContain("--non-interactive");
    expect(deploy).not.toContain("@latest");
    expect(mobile).not.toMatch(/workflow:run|fingerprint|get-build|eas\s+build|eas\s+submit|type:\s*(build|submit)/);
    expect(mobile).not.toMatch(/APPLE_|ASC_|provision/i);
  });

  it("runs each light and full release check once in its owning job", () => {
    for (const command of [
      "npm run typecheck",
      "npx expo lint",
      "npx vitest run",
      "npm run test:coverage",
      "npm run test:mutation",
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

  it("never pays for the same unit or browser test twice in one run", () => {
    // `test:coverage` runs the whole unit suite under the per-file thresholds,
    // so the plain run is the light tier's own signal and must stand down when
    // the full tier is selected.
    expect(ci).toMatch(/if: needs\.classify\.outputs\.full_gate != 'true'\n\s+run: npx vitest run/);
    // `e2e-full` executes the whole browser suite; the `@smoke` tests are a
    // subset of it, and `test:e2e:smoke` would also export a third bundle.
    expect(ci).toMatch(/e2e-smoke:\n\s+needs: classify\n\s+if: needs\.classify\.outputs\.full_gate != 'true'/);
  });

  it("classifies first, always runs light checks, and adds full checks only for high risk", () => {
    expect(ci).toContain("  classify:");
    for (const output of [
      "run_ci",
      "light_gate",
      "full_gate",
      "run_web_build",
      "deploy_web",
      "deploy_mobile",
      "reason",
    ]) {
      expect(classifier).toContain(`${output}:`);
      expect(ci).toContain(`${output}: ` + "${{ steps.route.outputs." + output + " }}");
    }

    const light = ci.slice(ci.indexOf("  light-gate:"), ci.indexOf("  full-gate:"));
    expect(light).toContain("needs: classify");
    expect(light).not.toContain("needs.classify.outputs.full_gate == 'true'");
    expect(light).toContain("npm run typecheck");
    expect(light).toContain("npx expo lint");
    expect(light).toContain("npx vitest run");

    const full = ci.slice(ci.indexOf("  full-gate:"), ci.indexOf("  web-build:"));
    expect(full).toContain("needs: classify");
    expect(full).toContain("needs.classify.outputs.full_gate == 'true'");
    expect(full).toContain("npm run test:coverage");
    expect(full).toContain("npm run test:mutation:ci");
    expect(full).toContain("MUTATION_BASE_SHA: ${{ github.event.before }}");
    expect(full).toContain("MUTATION_HEAD_SHA: ${{ github.sha }}");
    expect(full).toContain("MUTATION_EVENT_NAME: ${{ github.event_name }}");
    expect(full).toContain("fetch-depth: 0");
  });

  it("gates automatic and manual deploys on the same successful run", () => {
    for (const job of ["deploy-web", "deploy-mobile"] as const) {
      const condition = ci.slice(ci.indexOf(`  ${job}:\n`), ci.indexOf("steps:", ci.indexOf(`  ${job}:\n`)));
      expect(condition, job).toContain("gate");
      expect(condition, job).toContain("classify");
      // `!cancelled()` is load-bearing: without it GitHub propagates the
      // upstream skip through `gate`'s `always()` and this job never runs.
      expect(condition, job).toContain("!cancelled()");
      expect(condition, job).toContain("needs.gate.result == 'success'");
      expect(condition, job).toContain(`needs.classify.outputs.deploy_${job === "deploy-web" ? "web" : "mobile"} == 'true'`);
    }
    expect(ci).not.toContain("release_approval");
  });

  it("keeps manual target overrides including a dual redeploy", () => {
    expect(ci).toMatch(/workflow_dispatch:\n\s+inputs:\n\s+release_target:/);
    expect(ci).toContain("type: choice");
    expect(ci).toContain("options: [none, web, mobile, both]");
    expect(ci).not.toContain("release_approval");
    expect(ci).not.toContain("helix-release-approval");
    expect(ci).not.toContain("github-pages");
    if (agents != null) {
      expect(agents).toMatch(/existing `helix` deployment\s+environment/);
      expect(agents).not.toContain("helix-release-approval");
    }

    for (const job of ["deploy-web", "deploy-mobile"] as const) {
      const start = ci.indexOf(`  ${job}:\n`);
      const jobEnd = job === "deploy-web" ? ci.indexOf("\n  deploy-mobile:", start) : -1;
      const jobBlock = ci.slice(start, jobEnd === -1 ? undefined : jobEnd);
      expect(jobBlock, job).toContain("environment:\n      name: helix");
    }
  });

  it.skipIf(!documented)("documents that an authorized main push authorizes its automatic deploys", () => {
    expect(agents!).toMatch(/A user-authorized push to\s+`main` also authorizes/);
    expect(agents!).toMatch(/automatic web and Expo Go\s+deployments/);
    expect(release!).toMatch(/A push to `main` classifies the changed paths/);
    expect(release!).toMatch(/Both surfaces can publish from the same\s+successful gate/);
    expect(release!).toMatch(/Manual `workflow_dispatch` remains an optional override/);
  });

  it("builds the E2E export once and shares it with every shard", () => {
    // Each shard used to run its own `test:e2e:export`: a second full Metro
    // bundle, and two shards testing two separately-produced artifacts.
    expect(ci.split("npm run test:e2e:export").length - 1, "one E2E export per run").toBe(1);
    const build = ci.slice(ci.indexOf("  e2e-build:"), ci.indexOf("  e2e-full:"));
    expect(build).toContain("npm run test:e2e:export");
    expect(build).toContain("actions/upload-artifact");
    expect(build).toContain("if-no-files-found: error");
    const full = ci.slice(ci.indexOf("  e2e-full:"), ci.indexOf("  gate:"));
    expect(full).toMatch(/needs: .*e2e-build/);
    expect(full).toContain("actions/download-artifact");
    expect(full).toContain("path: dist-e2e");
    // Every shard must consume the same named artifact.
    const artifact = "dist-e2e-${{ github.run_id }}";
    expect(build).toContain(artifact);
    expect(full).toContain(artifact);
    // …and must not rebuild it, which `npm run test:e2e` would.
    expect(full).not.toContain("npm run test:e2e");
    expect(full).toContain("npx playwright test --shard=");
  });

  it("runs smoke on a light push and shards the risk-selected full suite", () => {
    expect(ci).toContain("npm run test:e2e:smoke");
    expect(ci).toContain("npx playwright install chromium firefox --with-deps");
    expect(nightly).toContain("npx playwright install chromium firefox --with-deps");
    const playwright = read("playwright.config.ts");
    expect(playwright).toContain('name: "chromium"');
    expect(playwright).toContain('name: "firefox-critical"');
    expect(playwright).not.toContain('name: "webkit-critical"');
    expect(playwright.match(/grep: \/@cross-browser\//g)).toHaveLength(1);
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
    expect(playwright).toContain("fullyParallel: true");
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
    const e2eBuild = ci.slice(ci.indexOf("  e2e-build:"), ci.indexOf("  e2e-full:"));
    const e2eFull = ci.slice(ci.indexOf("  e2e-full:"), ci.indexOf("  gate:"));
    expect(e2eBuild).toContain("needs.classify.outputs.full_gate == 'true'");
    expect(e2eFull).toContain("needs.classify.outputs.full_gate == 'true'");
  });

  it("cancels a superseded run rather than certifying a stale commit", () => {
    expect(ci).toMatch(
      /concurrency:\n\s+group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n\s+cancel-in-progress: true/,
    );
  });

  /**
   * Every job is bounded in time.
   *
   * Nothing was, so the ceiling was GitHub's default of six hours. That is not
   * hypothetical here: `nightly.yml` records a Playwright `apt-get` step
   * hanging past 25 minutes on three shards at once, and the mutation job sat
   * over an hour on 2026-08-20 while the deploy waited behind it. A hung job
   * should fail and free the runner, not hold a release all afternoon.
   *
   * The limits are generous multiples of measured durations, so they fire on a
   * hang and never on ordinary variance.
   */
  it("bounds every job so a hang fails instead of occupying a runner for six hours", () => {
    for (const [name, workflow] of Object.entries({ ci, security, nightly, keepalive, database })) {
      const jobsSection = workflow.slice(workflow.indexOf("\njobs:"));
      const jobs = [...jobsSection.matchAll(/^  ([a-z0-9-]+):$/gm)].map((match) => match[1]);
      expect(jobs.length, name).toBeGreaterThan(0);
      const limits = [...jobsSection.matchAll(/^    timeout-minutes: (\d+)$/gm)].map((match) => Number(match[1]));
      expect(limits.length, `${name}: ${jobs.length} job(s) but ${limits.length} timeout(s)`).toBe(jobs.length);
      // A limit so large it could never fire is the same as having none.
      for (const limit of limits) expect(limit, name).toBeLessThanOrEqual(90);
    }
  });

  it("lets the gate accept a skipped job but never a failed one", () => {
    expect(ci).toMatch(/gate:\n\s+if: always\(\)/);
    expect(ci).toContain("success|skipped) ;;");
  });

  it("keeps scheduled security evidence off the delivery path", () => {
    expect(security).toContain("github/codeql-action/init");
    // The gate names each accepted advisory instead of relaxing the threshold.
    // Assert against the executed lines: the surrounding comments legitimately
    // discuss the escapes this job refuses to take.
    const commands = security.split("\n").filter((line) => /^\s*(-\s*)?(run|uses|continue-on-error):/.test(line));
    expect(commands.join("\n")).toContain("node scripts/check-advisories.mjs");
    // A bare `npm audit --audit-level=high` cannot express an acceptance, so
    // every package carrying Metro's two build-chain advisories becomes its
    // own blocking finding and the job stays red until the threshold is relaxed.
    expect(commands.join("\n")).not.toContain("npm audit --audit-level");
    for (const line of commands) {
      expect(line, line).not.toMatch(/--audit-level=(moderate|low|info)|--omit=dev|continue-on-error/);
    }
    expect(security).toContain("cron:");
    expect(security).toContain("package-lock.json");
    // A README or Markdown edit must not wake a scanner: the push trigger is
    // an allowlist of paths, and none of them is documentation.
    const paths = security.slice(security.indexOf("paths:")).split("\n").slice(1);
    const listed = paths.filter((line) => line.trim().startsWith("- ")).map((line) => line.trim());
    expect(listed.length).toBeGreaterThan(0);
    for (const entry of listed) expect(entry, entry).not.toMatch(/\.md|README/);
    // CodeQL and the time-sensitive registry advisory feed stay outside the
    // deterministic delivery gate. A red scheduled run remains visible
    // evidence without retroactively making a tested commit undeployable.
    expect(ci).not.toContain("codeql");
    expect(ci).not.toContain("npm audit");
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

  it("pins the EAS CLI that publishes after the gate, without installing it", () => {
    /**
     * The publisher is fetched at publish time rather than installed.
     *
     * It used to be a lockfile-pinned devDependency, which bought an
     * integrity hash. It also dragged eas-cli's whole tree into every
     * `npm ci` — and with it `dtrace-provider`, a package that COMPILES A
     * NATIVE ADDON at install time on the machine that holds EXPO_TOKEN, plus
     * a standing set of advisories (uuid, joi, yaml, ajv, ts-deepmerge) that
     * no product code could ever reach. `expo-doctor` had been asking for
     * this move for the same reason.
     *
     * What replaces the lockfile hash is an EXACT version, taken from
     * `eas.json` so the two cannot drift, and a hard ban on any floating
     * range. A publisher that resolves at runtime is only acceptable while it
     * cannot resolve to something new.
     */
    const mobile = ci.slice(ci.indexOf("  deploy-mobile:"));
    const deploy = mobile.split("\n").find((line) => line.includes("eas-cli@") && line.includes(" update "));
    expect(deploy).toBeDefined();
    expect(deploy).toContain(`npx --yes eas-cli@${eas.cli.version} update`);
    expect(deploy).not.toContain("@latest");
    expect(deploy).not.toMatch(/eas-cli@[\^~]/);

    // Not installed anywhere: that is the point of the move.
    expect(packageJson.devDependencies["eas-cli"]).toBeUndefined();
    expect(packageJson.dependencies?.["eas-cli"]).toBeUndefined();
    expect(packageLock.packages["node_modules/eas-cli"]).toBeUndefined();
    expect(Object.keys(packageJson.overrides)).not.toContain(`eas-cli@${eas.cli.version}`);
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
    expect(publishStep).toContain("npx --yes eas-cli@");
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

/**
 * Row-level security is the ONLY authority on account isolation — the client
 * checks are defence in depth. Its 138 pgTAP assertions existed for months
 * with nothing running them, so this pins both that they run and how.
 */
describe("database workflow", () => {
  it("proves account isolation on a schedule and when the schema changes", () => {
    expect(database).toContain("supabase@2.109.1 test db --local");
    expect(database).toContain("supabase@2.109.1 db lint --local --schema public --fail-on warning");
    expect(database).toContain("cron:");
    // The CLI must not arrive through a third-party action. This repository
    // allows GitHub-owned actions only (`patterns_allowed` empty,
    // `verified_allowed` false), so `supabase/setup-cli` was refused before the
    // run could start — a `startup_failure` with no log to explain itself.
    const uses = database.split("\n").filter((line) => line.includes("uses:"));
    expect(uses.every((line) => /uses:\s*(actions|github)\//.test(line)), uses.join(" | ")).toBe(true);
    const paths = database.slice(database.indexOf("paths:"), database.indexOf("schedule:"));
    expect(paths).toContain("supabase/**");
  });

  it("runs against a local stack, so an unattended job holds no credential", () => {
    // `--linked` would point a weekly, unattended run at production and need a
    // `SUPABASE_ACCESS_TOKEN` to do it. The suite rolls back, but that is a
    // promise a scheduled job should not have to keep.
    expect(database).not.toContain("--linked");
    expect(database).not.toContain("secrets.");
    expect(database).toMatch(/permissions:\n\s+contents: read/);
  });

  it("reports and never deploys", () => {
    expect(database).not.toMatch(/^\s+deploy[\w-]*:$/m);
    expect(database).not.toMatch(/deploy-pages|upload-pages-artifact|eas-cli/);
  });
});

/**
 * A supply-chain rule is only as good as the file nobody remembered to check.
 * Every workflow, including ones added later, not a list kept by hand.
 */
describe("workflow supply chain", () => {
  const workflows = readdirSync(resolve(process.cwd(), ".github/workflows"))
    .filter((name) => name.endsWith(".yml"));

  it("has more than one workflow to check", () => {
    // The walk itself is part of the assertion: an empty directory listing
    // would satisfy every loop below it.
    expect(workflows.length).toBeGreaterThanOrEqual(5);
  });

  it("pins every action to a full commit SHA", () => {
    const floating: string[] = [];
    for (const name of workflows) {
      for (const line of read(`.github/workflows/${name}`).split("\n")) {
        const used = /^\s*-?\s*uses:\s*(\S+)/.exec(line);
        // A tag or branch can be moved to point at different code; a SHA cannot.
        if (used && !/@[0-9a-f]{40}$/.test(used[1] ?? "")) floating.push(`${name}: ${used[1]}`);
      }
    }
    expect(floating).toEqual([]);
  });
});

/**
 * The version number, and the record that has to move with it.
 *
 * There was no version discipline here at all: one string in two files that
 * nothing compared, no tags, and no changelog. That is survivable while
 * everything ships continuously from `main` and stays 1.0.0, and stops being
 * survivable the moment a release has to be identified — a diagnostic row
 * carries `app_version`, and `incident_by_release` groups by it, so a number
 * that never moves makes both of those answer the same thing for ever.
 *
 * These assertions exist so the changelog cannot be the step that gets skipped.
 * A person bumping the version and stopping there fails the suite, which is
 * the only reliable way a changelog stays written.
 */
describe("version and changelog", () => {
  const changelog = read("CHANGELOG.md");
  const headings = [...changelog.matchAll(/^## (\d+\.\d+\.\d+)\s*$/gm)];
  const versions = headings.map((match) => match[1]!);
  const order = (version: string) => version.split(".").map(Number);

  it("keeps the shipped version and the packaged version the same string", () => {
    // Expo reads app.json and nothing reads package.json's copy, which is
    // exactly how the two drift: the one that matters is the one nobody looks
    // at when the other is edited.
    expect(app.expo.version).toBe(packageJson.version);
    expect(app.expo.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("names the shipped version at the top of the changelog", () => {
    expect(versions[0], "the newest changelog entry must be the version app.json ships").toBe(app.expo.version);
  });

  it("lists releases newest first, with no version recorded twice", () => {
    expect(versions.length).toBeGreaterThan(0);
    expect(new Set(versions).size).toBe(versions.length);
    for (let index = 1; index < versions.length; index += 1) {
      const [newer, older] = [order(versions[index - 1]!), order(versions[index]!)];
      expect(newer.join("."), `${versions[index - 1]} must sort above ${versions[index]}`)
        .not.toBe(older.join("."));
      const ranks = [0, 1, 2].map((part) => Math.sign(newer[part]! - older[part]!));
      expect(ranks.find((rank) => rank !== 0), `${versions[index - 1]} must be newer than ${versions[index]}`).toBe(1);
    }
  });

  it("gives every release its three lines", () => {
    const sections = changelog.split(/^## /m).slice(1);
    expect(sections.length).toBe(versions.length);
    for (const [index, section] of sections.entries()) {
      for (const line of ["Ne değişti", "Kimi ilgilendiriyor", "Ne yapmalısın"]) {
        expect(section, `${versions[index]} is missing "${line}"`).toContain(line);
      }
    }
  });
});

/**
 * What a link to this app turns into somewhere else.
 *
 * None of it is visible while using the app, which is exactly why it rots: a
 * canonical URL that has stopped matching where the app lives tells an index to
 * credit somebody else's page, and a card image that 404s leaves a blank
 * rectangle in every message the link is pasted into. Neither shows up in any
 * other check, and neither is noticed by the person who moved the thing.
 */
/**
 * A JPEG's real dimensions, from its own frame header.
 *
 * JPEG has no fixed-offset size the way PNG does: the file is a chain of
 * marker segments and the numbers live in whichever start-of-frame marker the
 * encoder used. So this walks the chain rather than guessing an offset.
 */
function jpegSize(bytes: Buffer): { width: number; height: number } {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1]!;
    const length = bytes.readUInt16BE(offset + 2);
    // C0-CF are the start-of-frame markers, except C4/C8/CC which are tables.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error("not a JPEG with a readable frame header");
}

describe("social and search metadata", () => {
  const html = read("src/app/+html.tsx");
  const readme = read("README.md");
  const siteUrl = /const SITE_URL = "([^"]+)"/.exec(html)?.[1];
  const ogImage = /const OG_IMAGE = "([^"]+)"/.exec(html)?.[1];

  it("points canonical and og:url at the address README sends people to", () => {
    expect(siteUrl, "SITE_URL must stay parseable").toBeTruthy();
    expect(readme, `README must link ${siteUrl}`).toContain(siteUrl!);
    expect(siteUrl!.endsWith("/"), "the base is a directory, so every asset URL below it concatenates").toBe(true);
  });

  it("serves the card image from the published root at the size the tags claim", () => {
    // `public/` is copied verbatim into the export; `assets/` is hashed and
    // renamed, so a card image kept there would be advertised under a name
    // that does not exist.
    const file = resolve(process.cwd(), "public", ogImage!);
    expect(existsSync(file), `public/${ogImage} must exist`).toBe(true);
    // Read out of the file rather than trusted from its name: the tags below
    // promise 1200x630 to every crawler, and a card whose real size disagrees
    // is cropped or rejected by the very services the tags exist for.
    expect(jpegSize(readFileSync(file))).toEqual({ width: 1200, height: 630 });
    expect(html).toContain('content="1200"');
    expect(html).toContain('content="630"');
  });

  it("declares the tags a link preview and a search result actually read", () => {
    for (const tag of [
      'rel="canonical"',
      'property="og:title"',
      'property="og:description"',
      'property="og:url"',
      'property="og:image"',
      'name="twitter:card"',
      'name="theme-color"',
      'type="application/ld+json"',
    ]) {
      expect(html, `+html.tsx is missing ${tag}`).toContain(tag);
    }
  });

  it("describes itself as the kind of application it is", () => {
    expect(html).toContain('"@type": "SoftwareApplication"');
    expect(html).toContain('applicationCategory: "FinanceApplication"');
  });

  it("gives the page a title that means something on its own", () => {
    const layout = read("src/app/_layout.tsx");
    expect(layout, "the tab title must not be the bare product name").toContain("<title>{tr.meta.title}</title>");
    const tr = read("src/i18n/tr.ts");
    const title = /title: "(Helix[^"]*)"/.exec(tr)?.[1] ?? "";
    expect(title.length, "a title of one word says nothing to a stranger").toBeGreaterThan("Helix".length);
  });
});
