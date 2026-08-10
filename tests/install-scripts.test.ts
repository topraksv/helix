/**
 * Which dependencies are allowed to run code at install time.
 *
 * `npm ci` executes `preinstall`, `install` and `postinstall` from every
 * package in the tree, with the developer's own credentials and no sandbox.
 * That is the vector both Shai-Hulud waves used, and the one the April 2026
 * axios compromise used after valid SLSA provenance had already been produced —
 * a signature proves who built a tarball, not what its install hook does.
 *
 * `--ignore-scripts` is the obvious answer and it is the wrong one here:
 * esbuild's postinstall is what validates the platform binary its
 * optionalDependency installed, and turning it off trades a supply-chain risk
 * for a build that fails in a way nobody can read. What is actionable is the
 * SET: it is small, it is stable, and it should never grow without somebody
 * looking. A dependency that quietly gains an install hook in a patch release
 * is exactly the event worth a red build.
 *
 * The allowlist is deliberately by name only. Pinning versions here would fail
 * on every routine bump and get deleted within a month, which is worse than not
 * having it — what matters is that no NEW package started running code.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const INSTALL_HOOKS = ["preinstall", "install", "postinstall"] as const;

/**
 * Every package in the installed tree that runs a script at install time.
 *
 * The lockfile is not the source: it records `hasInstallScript` only for
 * packages npm has resolved that way, while the manifest on disk is what npm
 * actually executes.
 */
function packagesWithInstallScripts(root = "node_modules"): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".bin") continue;
      const path = join(directory, entry.name);
      // A scope is a folder of packages, not a package.
      if (entry.name.startsWith("@")) {
        walk(path);
        continue;
      }
      try {
        const manifest = JSON.parse(readFileSync(join(path, "package.json"), "utf8")) as {
          name?: string;
          scripts?: Record<string, string>;
        };
        const scripts = manifest.scripts ?? {};
        if (INSTALL_HOOKS.some((hook) => scripts[hook])) found.push(manifest.name ?? entry.name);
      } catch {
        // Not a package directory; keep walking.
      }
      walk(join(path, "node_modules"));
    }
  };
  walk(root);
  return [...new Set(found)].sort();
}

/**
 * Measured on 2026-08-07, and every entry is a build tool rather than anything
 * the app ships:
 *
 * - `esbuild`      — validates that the platform binary from its own
 *                    optionalDependency matches the host. Four copies in the
 *                    tree, all through the toolchain.
 * - `unrs-resolver` — the native resolver behind `eslint-plugin-import`.
 *
 * `dtrace-provider` used to sit here: a native addon compiled at install time
 * on the machine that publishes the OTA, which is the most sensitive place a
 * build script can run and the reason this test exists. It arrived only
 * through `eas-cli → @expo/logger → bunyan`, and the publisher is no longer
 * installed at all — see release-config's EAS pinning test.
 */
const ALLOWED = ["esbuild", "unrs-resolver"];

describe("install-time code execution", () => {
  it("runs install scripts only from the packages that are meant to", () => {
    const found = packagesWithInstallScripts();
    // A run against an empty or half-installed tree would pass this test while
    // proving nothing at all.
    expect(found.length, "an installed dependency tree").toBeGreaterThan(0);
    expect(found, "a dependency started running code at install time").toEqual(
      ALLOWED.filter((name) => found.includes(name)),
    );
  });

  it("keeps the allowlist honest about what is still installed", () => {
    const found = packagesWithInstallScripts();
    const gone = ALLOWED.filter((name) => !found.includes(name));
    // An allowlist nobody prunes is an allowlist that will one day re-admit a
    // package on its way back in.
    expect(gone, "allowlisted but no longer installed — remove it").toEqual([]);
  });
});
