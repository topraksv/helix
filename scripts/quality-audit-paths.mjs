/**
 * Paths that change the Helix control plane without changing product quality
 * evidence. Keep product and test paths outside this allowlist unless they
 * are part of the control-plane contract itself.
 */
const CONTROL_PLANE_PREFIXES = [
  ".ai/",
  ".agents/",
  ".claude/",
  ".githooks/",
];

const CONTROL_PLANE_PATHS = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  ".gitignore",
  ".github/workflows/ci.yml",
  "quality/audit.json",
  "scripts/quality-audit.mjs",
  "scripts/quality-audit-paths.mjs",
  "scripts/execution-authority-guard.mjs",
  "stryker.config.mjs",
  "tests/execution-authority.test.ts",
  "tests/release-config.test.ts",
]);

export function isControlPlanePath(path, packageScriptsOnly = false) {
  return CONTROL_PLANE_PATHS.has(path)
    || CONTROL_PLANE_PREFIXES.some((prefix) => path.startsWith(prefix))
    || (path === "package.json" && packageScriptsOnly);
}
