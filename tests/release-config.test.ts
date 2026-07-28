import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const app = JSON.parse(read("app.json"));
const eas = JSON.parse(read("eas.json"));
const ci = read(".github/workflows/ci.yml");
const security = read(".github/workflows/security.yml");
const nightly = read(".github/workflows/nightly.yml");
const keepalive = read(".github/workflows/keepalive.yml");
const easPreview = read(".eas/workflows/deploy-preview.yml");
const dependabot = read(".github/dependabot.yml");
const packageJson = JSON.parse(read("package.json"));

function dependabotRule(dependency: string) {
  const marker = `      - dependency-name: "${dependency}"`;
  const start = dependabot.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = dependabot.indexOf("\n      - dependency-name:", start + marker.length);
  return dependabot.slice(start, next === -1 ? undefined : next);
}

describe("release contract", () => {
  it("ties OTA compatibility to the native fingerprint, not a version string", () => {
    // `appVersion` let an update reach a binary whose native side no longer
    // matched it. The EAS workflow's build-or-update decision is only sound
    // while the runtime version is derived from the native project itself.
    expect(app.expo.runtimeVersion).toEqual({ policy: "fingerprint" });
    expect(app.expo.updates.requestHeaders["expo-channel-name"]).toBe("preview");
    expect(app.expo.ios.bundleIdentifier).toBe("com.toprak.helix");
    expect(app.expo.android.package).toBe("com.toprak.helix");
    expect(eas.build.preview).toMatchObject({ channel: "preview", distribution: "internal" });
    expect(eas.build.production).toMatchObject({ channel: "production" });
  });

  it("builds a binary or publishes an update, never both, and never submits", () => {
    expect(easPreview).toContain("type: fingerprint");
    expect(easPreview).toContain("type: get-build");
    expect(easPreview).toMatch(/if: \$\{\{ !needs\.get_ios_build\.outputs\.build_id \}\}\n\s+type: build/);
    expect(easPreview).toMatch(/if: \$\{\{ needs\.get_ios_build\.outputs\.build_id \}\}\n\s+type: update/);
    expect(easPreview).not.toContain("type: submit");
    // Dispatch-only: an OTA must follow the GitHub gate, never race it.
    expect(easPreview).toMatch(/on:\n\s+workflow_dispatch/);
    expect(easPreview).not.toContain("push:");
  });

  it("runs every release check somewhere in CI, and each of them once", () => {
    for (const command of [
      "npm run typecheck",
      "npx expo lint",
      "npm test",
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

  it("splits the browser suite by risk and shards the full run", () => {
    expect(ci).toContain("npm run test:e2e:smoke");
    expect(ci).toContain("--shard=${{ matrix.shard }}/2");
    expect(ci).toContain("npx playwright install chromium --with-deps");
    // Sharding across runners is the only parallelism: this suite drives one
    // browser against one static server and goes flaky with two workers.
    expect(ci).not.toMatch(/workers:\s*[2-9]/);
    expect(nightly).toContain("--shard=${{ matrix.shard }}/2");
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

  it("keeps advisory scanners off the delivery path", () => {
    expect(security).toContain("github/codeql-action/init");
    expect(security).toContain("npm audit --audit-level=high");
    expect(security).toContain("cron:");
    expect(security).toContain("package-lock.json");
    // A README or Markdown edit must not wake a scanner: the push trigger is
    // an allowlist of paths, and none of them is documentation.
    const paths = security.slice(security.indexOf("paths:")).split("\n").slice(1);
    const listed = paths.filter((line) => line.trim().startsWith("- ")).map((line) => line.trim());
    expect(listed.length).toBeGreaterThan(0);
    for (const entry of listed) expect(entry, entry).not.toMatch(/\.md|README/);
    // And no scanner sits on the delivery path.
    expect(ci).not.toContain("codeql");
  });

  it("pins every third-party action to a full commit SHA", () => {
    for (const [name, workflow] of Object.entries({ ci, security, nightly, keepalive })) {
      const refs = [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
      for (const ref of refs) expect(ref, `${name}: ${ref}`).toMatch(/@[0-9a-f]{40}$/);
    }
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
