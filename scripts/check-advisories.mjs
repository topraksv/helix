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
    checkedOn: "2026-07-29",
    // An acceptance is a decision about a shape of the dependency tree, not a
    // permanent pass for a package name. These are the only consumers proven
    // to be build-time; if the advisory turns up under anything else, that
    // path has not been examined and the gate must stop.
    expectedPaths: ["babel-preset-expo", "eslint", "eslint-config-expo", "expo", "react-native"],
    // Re-examine on this date whether upstream now has a compatible fix.
    // Reachability cannot be re-proven automatically here — that needs a
    // production export — so expiry is a deliberate, controlled failure that
    // asks a human to look again rather than a silent renewal.
    recheckAfter: "2026-10-29",
    reason: [
      "DoS via unbounded brace expansion. The advisory covers <=5.0.7 with no",
      "backport: 5.0.8 is the only patched release, and it is not a drop-in.",
      "v1/v2 export the expand function as module.exports; v5 exports an object",
      "({ expand, EXPANSION_MAX, EXPANSION_MAX_LENGTH }), so forcing it into the",
      "two consumers below makes `expand(pattern)` throw and breaks both.",
      "",
      "Every root is build-time tooling and none has a fixed release:",
      "  eslint / eslint-config-expo > minimatch@3.1.5 — eslint is already the",
      "    newest 9.x, and @eslint/eslintrc@3.3.6 (latest) still pins",
      "    minimatch@^3.1.5. Lint only; never bundled.",
      "  expo / react-native / babel-preset-expo > @expo/cli, @react-native/*",
      "    > minimatch@9.0.9 — pinned by the SDK 54 matrix; bumping it belongs",
      "    to the coordinated BACKLOG-SDK-01 upgrade. Metro and the CLI run at",
      "    build time; the transform output contains none of it.",
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

/**
 * Every distinct advisory reported at a blocking severity, with the packages it
 * affects and the DIRECT dependencies it reaches them through.
 *
 * The roots are what an acceptance is really about. `npm audit` reports an
 * advisory once against the vulnerable package and then a chain of "depends on
 * a vulnerable X" edges; the question that matters is which of this project's
 * own dependencies sit at the top of those chains, because that is what decides
 * whether the code can run at all.
 */
export function blockingAdvisories(report) {
  const entries = report.vulnerabilities ?? {};
  const found = new Map();
  const carriers = new Map(); // advisory id -> Set of package names carrying it

  for (const [name, entry] of Object.entries(entries)) {
    for (const via of entry.via ?? []) {
      // A string `via` is a transitive edge, not an advisory of its own.
      if (typeof via !== "object" || !BLOCKING.has(via.severity)) continue;
      const id = via.url?.split("/").pop() ?? String(via.source);
      if (!found.has(id)) found.set(id, { id, title: via.title, package: via.name, affected: new Set(), roots: new Set() });
      found.get(id).affected.add(name);
      if (!carriers.has(id)) carriers.set(id, new Set());
      carriers.get(id).add(name);
    }
  }

  // Walk each direct dependency's `via` edges down to the packages that carry
  // the advisory. Depth is bounded by the visited set, so a cycle terminates.
  const reaches = (start, targets) => {
    const seen = new Set();
    const stack = [start];
    while (stack.length > 0) {
      const name = stack.pop();
      if (seen.has(name)) continue;
      seen.add(name);
      if (targets.has(name)) return true;
      for (const via of entries[name]?.via ?? []) {
        if (typeof via === "string") stack.push(via);
        else if (via?.name) stack.push(via.name);
      }
    }
    return false;
  };

  for (const [name, entry] of Object.entries(entries)) {
    if (!entry.isDirect) continue;
    for (const [id, targets] of carriers) {
      if (reaches(name, targets)) found.get(id).roots.add(name);
    }
  }
  return found;
}

/**
 * The failure modes, as data: an advisory nobody has looked at, one that has
 * appeared through a consumer nobody examined, a tree that moved under an
 * acceptance, an acceptance past its re-examination date, and one that has
 * outlived the advisory it describes.
 *
 * @param {{ vulnerabilities?: Record<string, any> }} report
 * @param {{ id: string, package: string, checkedOn: string, reason: string,
 *           expectedPaths?: string[], recheckAfter?: string }[]} [acknowledgements]
 * @param {string} [today] ISO date; injected so expiry is testable.
 */
export function evaluate(report, acknowledgements = ACKNOWLEDGED, today = new Date().toISOString().slice(0, 10)) {
  const advisories = blockingAdvisories(report);
  const acknowledged = new Map(acknowledgements.map((entry) => [entry.id, entry]));
  const problems = [];
  const accepted = [];

  for (const [id, advisory] of advisories) {
    const entry = acknowledged.get(id);
    if (entry) {
      // The acceptance covers a known tree. A root outside it is a consumer
      // nobody examined, and it may well be one that reaches runtime.
      const unexpected = [...advisory.roots].filter((root) => !(entry.expectedPaths ?? []).includes(root));
      if (unexpected.length > 0) {
        problems.push(
          `UNEXPECTED PATH ${id} (${entry.package}) now reaches through: ${unexpected.sort().join(", ")}\n` +
            `  Examined roots: ${(entry.expectedPaths ?? []).join(", ") || "(none)"}.\n` +
            `  Prove this consumer cannot reach runtime, or fix the advisory.`,
        );
      }
      const missing = (entry.expectedPaths ?? []).filter((root) => !advisory.roots.has(root));
      if (missing.length > 0) {
        problems.push(
          `TREE CHANGED ${id} (${entry.package}) no longer reaches through: ${missing.sort().join(", ")}\n` +
            `  The dependency tree moved under the acceptance. Re-examine and update expectedPaths.`,
        );
      }
      if (entry.recheckAfter && today >= entry.recheckAfter) {
        problems.push(
          `EXPIRED ${id} (${entry.package}) was due for re-examination on ${entry.recheckAfter}.\n` +
            `  Check upstream for a compatible fix and re-prove it cannot reach runtime,\n` +
            `  then move checkedOn and recheckAfter forward.`,
        );
      }
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
