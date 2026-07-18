import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const app = JSON.parse(readFileSync(resolve(process.cwd(), "app.json"), "utf8"));
const eas = JSON.parse(readFileSync(resolve(process.cwd(), "eas.json"), "utf8"));
const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/deploy-web.yml"), "utf8");
const dependabot = readFileSync(resolve(process.cwd(), ".github/dependabot.yml"), "utf8");

describe("release contract", () => {
  it("embeds the preview channel for local CNG builds", () => {
    expect(app.expo.updates.requestHeaders["expo-channel-name"]).toBe("preview");
    expect(app.expo.runtimeVersion).toEqual({ policy: "appVersion" });
    expect(app.expo.ios.bundleIdentifier).toBe("com.toprak.helix");
    expect(app.expo.android.package).toBe("com.toprak.helix");
    expect(eas.build.preview).toMatchObject({ channel: "preview", distribution: "internal" });
    expect(eas.build.production).toMatchObject({ channel: "production" });
  });

  it("gates Pages deploys on every local release check", () => {
    for (const command of ["npm run typecheck", "npm test", "npx expo lint", "npx expo export -p web"]) {
      expect(workflow).toContain(command);
    }
    expect(workflow).toMatch(/deploy:\n[\s\S]*needs: quality/);
  });

  it("pins every third-party action to a full commit SHA", () => {
    const actionRefs = [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
    expect(actionRefs.length).toBeGreaterThan(0);
    for (const ref of actionRefs) expect(ref).toMatch(/@[0-9a-f]{40}$/);
  });

  it("keeps SDK-managed minor and major updates in the coordinated Expo backlog", () => {
    for (const dependency of [
      "expo*",
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
      expect(dependabot).toContain(`dependency-name: "${dependency}"`);
    }
    expect(dependabot).toContain("version-update:semver-minor");
    expect(dependabot).toContain("version-update:semver-major");
  });
});
