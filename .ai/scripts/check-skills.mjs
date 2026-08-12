#!/usr/bin/env node
/**
 * Validate the installed skill package and the Claude discovery bridge.
 *
 * Skills are vendored, unmodified, from upstream publishers via the `skills`
 * CLI. `.agents/skills` holds the real directories, `.claude/skills` holds one
 * symlink per skill, and `skills-lock.json` records the upstream source of
 * each. Nothing here validates skill prose: the body belongs to its publisher,
 * so asserting local style rules against it would only guarantee drift.
 */

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const skillsRoot = join(root, ".agents/skills");
const bridgeRoot = join(root, ".claude/skills");
const lockPath = join(root, "skills-lock.json");

const problems = [];
const report = (message) => problems.push(message);

if (!existsSync(skillsRoot)) report(`missing skill root: .agents/skills`);

const names = existsSync(skillsRoot)
  ? readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  : [];

for (const name of names) {
  const skillFile = join(skillsRoot, name, "SKILL.md");
  const fail = (message) => report(`${name}: ${message}`);
  if (!existsSync(skillFile)) {
    fail("no SKILL.md");
    continue;
  }
  const raw = readFileSync(skillFile, "utf8");
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!frontmatter) {
    fail("no YAML frontmatter");
    continue;
  }
  const block = frontmatter[1] ?? "";
  const declared = /(?:^|\n)name:\s*(.+)/.exec(block)?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!declared) fail("no name");
  else if (declared !== name) fail(`frontmatter name "${declared}" does not match directory "${name}"`);
  if (!/(?:^|\n)description:\s*\S/.test(block)) fail("no description");
}

// Every skill directory must be reachable by Claude through a symlink, and the
// bridge must not invent skills that no longer exist upstream.
if (!existsSync(bridgeRoot)) {
  report("missing discovery bridge: .claude/skills");
} else {
  for (const name of names) {
    const path = join(bridgeRoot, name);
    if (!existsSync(path)) {
      report(`.claude/skills: missing bridge for ${name}`);
      continue;
    }
    try {
      if (!lstatSync(path).isSymbolicLink()) report(`.claude/skills/${name}: must be a symlink, not a copy`);
      else if (realpathSync(path) !== realpathSync(join(skillsRoot, name))) {
        report(`.claude/skills/${name}: symlink target is not the installed skill`);
      }
    } catch (error) {
      report(`.claude/skills/${name}: cannot resolve symlink (${error.message})`);
    }
  }
  for (const entry of readdirSync(bridgeRoot).filter((entry) => !entry.startsWith("."))) {
    if (!names.includes(entry)) report(`.claude/skills: unexpected entry ${entry}`);
  }
}

// The lockfile is what makes a fresh clone reproducible; an unlocked skill has
// no recorded upstream and cannot be reinstalled or updated.
if (!existsSync(lockPath)) {
  report("missing skills-lock.json");
} else {
  let locked = {};
  try {
    locked = JSON.parse(readFileSync(lockPath, "utf8")).skills ?? {};
  } catch (error) {
    report(`skills-lock.json is not readable JSON (${error.message})`);
  }
  for (const name of names) if (!locked[name]) report(`skills-lock.json: no entry for ${name}`);
  for (const name of Object.keys(locked)) {
    if (!names.includes(name)) report(`skills-lock.json: locked skill ${name} is not installed`);
  }
}

// An empty directory is always leftover state: the installer never creates one.
const emptyDirs = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const child = join(dir, entry.name);
    if (readdirSync(child).length === 0) emptyDirs.push(child.slice(root.length + 1));
    else walk(child);
  }
};
if (existsSync(skillsRoot)) walk(skillsRoot);
for (const dir of emptyDirs) report(`empty directory: ${dir}`);

console.log(`Checked ${names.length} installed skills, the Claude bridge and the lockfile.`);
if (problems.length > 0) {
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log("Skills are vendored unmodified, bridged and locked.");
