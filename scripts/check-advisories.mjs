#!/usr/bin/env node
/**
 * Fail on any high or critical advisory that has not been individually
 * examined and written down here.
 *
 * `npm audit --audit-level=high` was the whole check until one advisory with
 * no compatible fix turned the job permanently red. The two ways out of that
 * are both wrong: lowering the threshold hides the next real finding, and
 * `--omit=dev` hides nothing useful either, because Expo and React Native
 * declare their build tooling as ordinary dependencies.
 *
 * So the threshold stays at high, and each accepted advisory is named, with
 * the evidence that it cannot reach the running app and the date upstream was
 * last checked. A new high advisory fails the job. An acknowledgement that
 * stops matching also fails it, so an entry cannot outlive the problem it
 * describes.
 */
import { execFileSync } from "node:child_process";

/**
 * Every field here is a claim someone checked, not a note someone copied.
 * Before extending this list: confirm the advisory has no compatible fix,
 * prove the package is absent from the export, and date the check.
 */
const ACKNOWLEDGED = [
  {
    id: "GHSA-mh99-v99m-4gvg",
    package: "brace-expansion",
    checkedOn: "2026-07-28",
    reason: [
      "DoS via unbounded brace expansion. The advisory covers <=5.0.7 with no",
      "backport: 5.0.8 is the only patched release, and it is not a drop-in.",
      "v1/v2 export the expand function as module.exports; v5 exports an object",
      "({ expand, EXPANSION_MAX, EXPANSION_MAX_LENGTH }), so forcing it into the",
      "two consumers below makes `expand(pattern)` throw and breaks both.",
      "",
      "Both consumers are build-time only and neither has a fixed release:",
      "  eslint@9.39.5 > minimatch@3.1.5   — eslint is already the newest 9.x,",
      "    and @eslint/eslintrc@3.3.6 (latest) still requires minimatch@^3.1.5.",
      "  expo@54.0.36 > @expo/cli > minimatch@9.0.9 — pinned by the SDK 54",
      "    matrix; bumping it belongs to the coordinated BACKLOG-SDK-01 upgrade.",
      "",
      "Not reachable at runtime: a search of the production web export (4 JS",
      "files, 5.4 MB) returns zero occurrences of brace-expansion, minimatch,",
      "expandTop or EXPANSION_MAX. No application source imports either package.",
      "It runs in eslint and the Expo CLI on a developer machine and in CI, on",
      "patterns this repository writes itself.",
    ].join("\n      "),
  },
];

const BLOCKING = new Set(["high", "critical"]);

function audit() {
  try {
    // npm exits non-zero when it finds anything at or above the audit level,
    // which is the normal case here — the report on stdout is what matters.
    return JSON.parse(execFileSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  } catch (error) {
    if (typeof error.stdout === "string" && error.stdout.trim().startsWith("{")) return JSON.parse(error.stdout);
    throw error;
  }
}

/** Every distinct advisory id reported at a blocking severity, with its packages. */
export function blockingAdvisories(report) {
  const found = new Map();
  for (const [name, entry] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      // A string `via` is a transitive edge ("depends on a vulnerable X"), not
      // an advisory of its own. Only object entries carry a real advisory.
      if (typeof via !== "object" || !BLOCKING.has(via.severity)) continue;
      const id = via.url?.split("/").pop() ?? String(via.source);
      if (!found.has(id)) found.set(id, { id, title: via.title, package: via.name, affected: new Set() });
      found.get(id).affected.add(name);
    }
  }
  return found;
}

/**
 * The two failure modes, as data: an advisory nobody has looked at, and an
 * acknowledgement that has outlived the advisory it describes.
 */
export function evaluate(report, acknowledgements = ACKNOWLEDGED) {
  const advisories = blockingAdvisories(report);
  const acknowledged = new Map(acknowledgements.map((entry) => [entry.id, entry]));
  const problems = [];
  const accepted = [];

  for (const [id, advisory] of advisories) {
    const entry = acknowledged.get(id);
    if (entry) {
      accepted.push(entry);
      continue;
    }
    problems.push(
      `UNACKNOWLEDGED ${id} (${advisory.package}): ${advisory.title}\n` +
        `  reaches: ${[...advisory.affected].sort().join(", ")}\n` +
        `  Fix it, or add it to ACKNOWLEDGED in this file with evidence.`,
    );
  }

  for (const entry of acknowledgements) {
    if (!advisories.has(entry.id)) {
      problems.push(
        `STALE ${entry.id} (${entry.package}) is acknowledged but no longer reported.\n` +
          `  It was fixed upstream or dropped. Delete the entry.`,
      );
    }
  }

  return { advisories, accepted, problems };
}

// Only audit when run as a command; importing this file must not shell out.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const report = audit();
  const { advisories, accepted, problems } = evaluate(report);

  for (const entry of accepted) {
    console.log(`accepted ${entry.id} (${entry.package}), last checked ${entry.checkedOn}`);
    console.log(`      ${entry.reason}`);
  }

  const counts = report.metadata?.vulnerabilities ?? {};
  console.log(
    `\n${advisories.size} distinct high/critical advisories across ` +
      `${(counts.high ?? 0) + (counts.critical ?? 0)} affected packages; ` +
      `${ACKNOWLEDGED.length} acknowledged.`,
  );

  if (problems.length > 0) {
    console.error(`\n${problems.join("\n\n")}\n`);
    process.exit(1);
  }
  console.log("No unacknowledged high or critical advisories.");
}
