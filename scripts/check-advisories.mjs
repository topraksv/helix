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
import { readFileSync } from "node:fs";

/**
 * Every field here is a claim someone checked, not a note someone copied.
 * Before extending this list: confirm the advisory has no compatible fix,
 * prove the package is absent from the export, and date the check.
 *
 * Empty is a state this list is allowed to be in, and reaching it is the point
 * of the check rather than a sign the check stopped working. The two
 * `image-size` entries that lived here were closed by the SDK 57 upgrade, which
 * carried Metro past the version they described: `npm ls image-size --all` now
 * resolves nothing at all. Leaving a closed acknowledgement behind is how a
 * list like this turns into the place advisories go to be forgotten, which is
 * why a stale entry is reported as loudly as an unacknowledged advisory.
 */
const ACKNOWLEDGED = [];

/**
 * Dependencies the registry audit cannot see, and the review that replaces it.
 *
 * `npm audit` and Dependabot both work from the npm registry. A dependency
 * installed from a tarball URL has no registry record to match, so it is not
 * that it comes back clean — it is that nobody asked. Measured on 2026-09-02:
 * the audit reported 25 advisories across the tree and `xlsx` was not among
 * them, which is the same answer it would give for a version with a known
 * critical hole.
 *
 * SheetJS is the deliberate case. It left npm in 2023 and publishes from its
 * own CDN, and the package is kept on that terms rather than swapped: the
 * spreadsheet import is the feature this app was built around. What it costs
 * is this list.
 *
 * Every entry is a claim someone checked, on the same terms as ACKNOWLEDGED
 * above. `reviewed` is the set of advisories that were read and found not to
 * apply to the pinned version — the CLI below fetches the publisher's own page
 * and fails on anything that is not in it, so a newly published advisory
 * reaches the owner the same week rather than whenever somebody thinks to look.
 */
const UNAUDITED = [
  {
    package: "xlsx",
    version: "0.20.3",
    advisories: "https://cdn.sheetjs.com/advisories/",
    reviewed: ["CVE-2023-30533", "CVE-2024-22363"],
    checkedOn: "2026-09-02",
    recheckAfter: "2026-12-02",
    reason:
      "SheetJS publishes from its own CDN, so neither `npm audit` nor Dependabot has a registry record to match and neither will ever report it. Both advisories the publisher lists are fixed below the pinned version: CVE-2023-30533 (prototype pollution) in 0.19.3 and CVE-2024-22363 (ReDoS) in 0.20.2, against 0.20.3 here. The tarball is pinned by URL and by sha512 in package-lock.json, so the bytes cannot change under the pin. Re-read the publisher's advisory page and re-check the pinned version before expiry.",
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

/**
 * Which installed packages came from somewhere other than the npm registry.
 *
 * Read from the lockfile rather than listed by hand, because the point is to
 * notice a blind spot that GREW. A second tarball dependency added later is
 * exactly the case a hand-written list cannot catch.
 *
 * @param {{ packages?: Record<string, { resolved?: string, version?: string }> }} lock
 */
export function unregisteredPackages(lock) {
  const found = new Map();
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    const resolved = entry?.resolved;
    if (!path.startsWith("node_modules/") || typeof resolved !== "string") continue;
    let host;
    try {
      host = new URL(resolved).host;
    } catch {
      continue;
    }
    if (host === "registry.npmjs.org") continue;
    found.set(path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length), {
      host,
      version: entry.version,
      resolved,
    });
  }
  return found;
}

/**
 * The failure modes, again as data: a blind spot nobody has written down, an
 * entry for a package that is no longer outside the registry, an entry that
 * describes a version other than the installed one, and one past its date.
 *
 * @param {Map<string, { host: string, version?: string }>} unregistered
 * @param {{ package: string, version: string, recheckAfter?: string }[]} [entries]
 * @param {string} [today]
 */
export function evaluateUnaudited(unregistered, entries = UNAUDITED, today = new Date().toISOString().slice(0, 10)) {
  const problems = [];
  const tracked = new Map(entries.map((entry) => [entry.package, entry]));

  for (const [name, installed] of unregistered) {
    const entry = tracked.get(name);
    if (!entry) {
      problems.push(
        `UNTRACKED ${name}@${installed.version} installs from ${installed.host}, not the npm registry.\n` +
          `  Neither \`npm audit\` nor Dependabot can see it, so nothing is watching it.\n` +
          `  Add it to UNAUDITED in this file with its advisory source and a review date.`,
      );
      continue;
    }
    if (installed.version !== entry.version) {
      problems.push(
        `VERSION MOVED ${name} is installed at ${installed.version}; the review covers ${entry.version}.\n` +
          `  Read the publisher's advisories for the installed version, then update the entry.`,
      );
    }
    if (entry.recheckAfter && today >= entry.recheckAfter) {
      problems.push(
        `EXPIRED ${name} was due for re-examination on ${entry.recheckAfter}.\n` +
          `  Re-read the publisher's advisory page, confirm the pinned version, then move the dates forward.`,
      );
    }
  }

  for (const entry of entries) {
    if (!unregistered.has(entry.package)) {
      problems.push(
        `STALE ${entry.package} is tracked here but no longer installs from outside the registry.\n` +
          `  The ordinary audit covers it now. Delete the entry.`,
      );
    }
  }

  return problems;
}

/**
 * Advisory identifiers on a publisher's page that nobody has read yet.
 *
 * Deliberately a plain scan of the fetched text for CVE identifiers rather
 * than a parse of the page's markup: the shape of somebody else's HTML is not
 * something this repository can hold stable, and a parser that silently
 * matched nothing would report "no new advisories" for ever — the one answer
 * this check must never give by accident. That is also why an empty result is
 * treated as a failure by the caller.
 *
 * @param {string} pageText
 * @param {readonly string[]} reviewed
 */
export function newAdvisories(pageText, reviewed) {
  const seen = [...new Set(pageText.match(/CVE-\d{4}-\d{4,7}/g) ?? [])];
  return { seen, unreviewed: seen.filter((id) => !reviewed.includes(id)) };
}

/**
 * Read a publisher's advisory page and say what has appeared on it.
 *
 * Fails closed, in three directions. A page that will not load is not "no news"
 * — it is no answer, and a security check that passes when it cannot reach its
 * source is worse than not having it. A page that yields no identifiers at all
 * means its shape changed under the scan, which reads identically to "nothing
 * is wrong" and must not. And anything unreviewed fails by definition.
 */
async function reviewPublisherAdvisories(entry) {
  let text;
  try {
    const response = await fetch(entry.advisories, { redirect: "follow" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    text = await response.text();
  } catch (error) {
    return [
      `UNREACHABLE ${entry.package}: could not read ${entry.advisories} (${error}).\n` +
        `  Nothing is watching this dependency, so this cannot be treated as clean.`,
    ];
  }
  const { seen, unreviewed } = newAdvisories(text, entry.reviewed);
  if (seen.length === 0) {
    return [
      `UNREADABLE ${entry.package}: ${entry.advisories} listed no advisory identifiers.\n` +
        `  The page's shape changed, and an empty scan reads exactly like a clean one.\n` +
        `  Read it by hand and adjust the scan.`,
    ];
  }
  if (unreviewed.length > 0) {
    return [
      `NEW ADVISORY ${entry.package}: ${unreviewed.join(", ")} appeared on ${entry.advisories}.\n` +
        `  Read it, check whether ${entry.version} is affected, upgrade if it is,\n` +
        `  then add the identifier to \`reviewed\` with the dates moved forward.`,
    ];
  }
  return [];
}

// Only audit when run as a command; importing this file must not shell out.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const report = audit();
  const { advisories, accepted, problems } = evaluate(report);

  // The other half of the same question, from the source the registry cannot
  // answer for. Same job, same report: "is anything unreviewed reaching this
  // app" does not become two questions because the answers live in two places.
  const unregistered = unregisteredPackages(JSON.parse(readFileSync("package-lock.json", "utf8")));
  problems.push(...evaluateUnaudited(unregistered));
  for (const entry of UNAUDITED) {
    if (!unregistered.has(entry.package)) continue;
    console.log(`tracked ${entry.package}@${entry.version} from ${new URL(entry.advisories).host}, last read ${entry.checkedOn}`);
    problems.push(...(await reviewPublisherAdvisories(entry)));
  }

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
