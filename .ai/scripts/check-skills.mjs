#!/usr/bin/env node
/**
 * Validate the source-owned skill package and both discovery bridges.
 *
 * The `.ai/skills` tree is canonical. `.agents/skills` and `.claude/skills`
 * must contain only symlinks to it, so a tool cannot silently drift by editing
 * a second copy.
 */

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const skillsRoot = join(root, ".ai/skills");
const bridgeRoots = [".agents/skills", ".claude/skills"].map((path) => join(root, path));
const reserved = ["anthropic", "claude"];
const knownKeys = new Set(["name", "description", "allowed-tools", "license", "compatibility", "version", "metadata"]);

const problems = [];
const report = (message) => problems.push(message);

if (!existsSync(skillsRoot)) report(`missing canonical skill root: ${skillsRoot}`);

const canonicalEntries = existsSync(skillsRoot)
  ? readdirSync(skillsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  : [];
const canonicalNames = canonicalEntries.map((entry) => entry.name).sort();

for (const bridge of bridgeRoots) {
  if (!existsSync(bridge)) {
    report(`missing discovery bridge: ${bridge}`);
    continue;
  }
  const entries = readdirSync(bridge, { withFileTypes: true }).filter((entry) => !entry.name.startsWith("."));
  const names = entries.map((entry) => entry.name).sort();
  for (const name of canonicalNames) {
    const path = join(bridge, name);
    if (!existsSync(path)) {
      report(`${bridge}: missing bridge for ${name}`);
      continue;
    }
    try {
      if (!lstatSync(path).isSymbolicLink()) report(`${bridge}/${name}: must be a symlink`);
      else if (realpathSync(path) !== realpathSync(join(skillsRoot, name))) {
        report(`${bridge}/${name}: symlink target differs from canonical skill`);
      }
    } catch (error) {
      report(`${bridge}/${name}: cannot resolve symlink (${error.message})`);
    }
  }
  for (const name of names) if (!canonicalNames.includes(name)) report(`${bridge}: unexpected skill ${name}`);
}

const markdownLinks = (text) => [...text.matchAll(/\]\((?!https?:)([^)#][^)]*\.md)\)/g)].map((match) => match[1]);

for (const dir of canonicalNames) {
  const skillFile = join(skillsRoot, dir, "SKILL.md");
  const fail = (message) => report(`${dir}: ${message}`);
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
  const body = raw.slice(frontmatter[0].length);
  const name = /(?:^|\n)name:\s*(.+)/.exec(block)?.[1]?.trim();
  if (!name) fail("no name");
  else {
    if (name.length > 64) fail(`name is ${name.length} characters (max 64)`);
    if (!/^[a-z0-9-]+$/.test(name)) fail(`name "${name}" must be lowercase letters, numbers and hyphens`);
    if (reserved.some((word) => name.toLowerCase().includes(word))) fail(`name "${name}" uses a reserved word`);
    if (name !== dir) fail(`name "${name}" does not match directory "${dir}"`);
  }
  const description = /(?:^|\n)description:\s*([\s\S]*?)(?=\n[a-z-]+:|$)/.exec(block)?.[1]?.trim().replace(/\s+/g, " ");
  if (!description) fail("no description");
  else {
    if (description.length > 1024) fail(`description is ${description.length} characters (max 1024)`);
    if (/<[a-z][^>]*>/i.test(description)) fail("description contains an XML tag");
    if (/\bI (can|will|help)\b|\byou can\b/i.test(description)) fail("description is not in the third person");
    if (!/\bUse (this skill )?(when|for|before|after|during)\b/i.test(description)) {
      fail("description never says WHEN to use the skill (use `Use when …`)");
    }
  }
  for (const key of block.split("\n").flatMap((line) => /^([a-z-]+):/.exec(line)?.[1] ?? [])) {
    if (!knownKeys.has(key)) fail(`frontmatter key "${key}" is not part of the shared contract`);
  }
  const bodyLines = body.split("\n").length;
  if (bodyLines > 500) fail(`SKILL.md body is ${bodyLines} lines (max 500)`);

  const direct = markdownLinks(body);
  const reachable = new Set(direct.map((link) => resolve(skillsRoot, dir, link)));
  for (const link of direct) {
    if (link.includes("\\")) fail(`reference "${link}" uses backslashes`);
    const target = join(skillsRoot, dir, link);
    if (!existsSync(target)) {
      fail(`reference "${link}" does not exist`);
      continue;
    }
    const reference = readFileSync(target, "utf8");
    if (reference.split("\n").length > 100 && !/^#{1,3}\s*(Contents|Table of contents)/im.test(reference)) {
      fail(`reference "${link}" is over 100 lines and has no table of contents`);
    }
    for (const nested of markdownLinks(reference)) {
      const nestedTarget = resolve(resolve(skillsRoot, dir, link), "..", nested);
      if (nestedTarget !== resolve(skillFile) && !reachable.has(nestedTarget)) {
        fail(`"${link}" points at "${nested}", which SKILL.md does not link directly`);
      }
    }
  }
}

console.log(`Checked ${canonicalNames.length} canonical skills and ${bridgeRoots.length} discovery bridges.`);
if (problems.length > 0) {
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log("Every canonical skill and bridge matches the shared Agent Skills contract.");
