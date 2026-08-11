#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const MEMORY_PATH = ".ai/AI_HANDOFF.md";
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function parseMemory(text) {
  const sections = [];
  let section = null;
  let readingSourcePaths = false;

  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      section = { title: heading[1], updatedAt: null, verifiedAtCommit: null, sourcePaths: [] };
      sections.push(section);
      readingSourcePaths = false;
      continue;
    }
    if (!section) continue;

    const updatedAt = line.match(/^updated_at:\s*(\S+)\s*$/);
    if (updatedAt) {
      section.updatedAt = updatedAt[1];
      continue;
    }
    const verifiedAtCommit = line.match(/^verified_at_commit:\s*(\S+)\s*$/);
    if (verifiedAtCommit) {
      section.verifiedAtCommit = verifiedAtCommit[1];
      continue;
    }
    if (/^source_paths:\s*$/.test(line)) {
      readingSourcePaths = true;
      continue;
    }
    if (readingSourcePaths) {
      const sourcePath = line.match(/^\s+-\s+(.+?)\s*$/);
      if (sourcePath) {
        section.sourcePaths.push(sourcePath[1]);
      } else if (line.trim() !== "") {
        readingSourcePaths = false;
      }
    }
  }

  return sections;
}

function trackedFiles() {
  return git(["ls-files", "-z"]).split("\0").filter(Boolean);
}

function changedFilesSince(commit) {
  return git(["diff", "--name-only", commit, "--"])
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
}

function packageScriptsOnlySince(commit) {
  try {
    const previous = JSON.parse(git(["show", `${commit}:package.json`]));
    const current = JSON.parse(readFileSync("package.json", "utf8"));
    const withoutScripts = (value) => {
      const copy = { ...value };
      delete copy.scripts;
      return JSON.stringify(copy);
    };
    return withoutScripts(previous) === withoutScripts(current);
  } catch {
    return false;
  }
}

function isControlPlaneChange(file, commit) {
  if (["AGENTS.md", "CLAUDE.md", ".gitignore", ".github/workflows/ci.yml", "quality/audit.json", "scripts/quality-audit.mjs"]
    .includes(file)) return true;
  if (file.startsWith(".ai/") || file.startsWith(".agents/") || file.startsWith(".claude/")) return true;
  return file === "package.json" && packageScriptsOnlySince(commit);
}

function matchesSourcePath(file, sourcePath) {
  const normalized = sourcePath.replaceAll("\\", "/");
  return normalized.endsWith("/") ? file.startsWith(normalized) : file === normalized;
}

function validateSourcePath(sourcePath, tracked) {
  if (!sourcePath || isAbsolute(sourcePath) || sourcePath.startsWith("../")) {
    return `invalid source_path: ${sourcePath || "<empty>"}`;
  }
  if (!tracked.some((file) => matchesSourcePath(file, sourcePath))) {
    return `source_path does not match a tracked file: ${sourcePath}`;
  }
  return null;
}

function checkFreshness() {
  const memoryPath = resolve(MEMORY_PATH);
  if (!existsSync(memoryPath)) {
    return { ok: false, errors: [`memory file not found: ${MEMORY_PATH}`] };
  }

  let sections;
  try {
    sections = parseMemory(readFileSync(memoryPath, "utf8"));
  } catch (error) {
    return { ok: false, errors: [`cannot read memory file: ${error.message}`] };
  }

  const errors = [];
  const seenTitles = new Set();
  const tracked = trackedFiles();
  const results = [];

  if (sections.length === 0) errors.push("memory file has no level-two sections");

  for (const section of sections) {
    if (seenTitles.has(section.title)) errors.push(`duplicate section: ${section.title}`);
    seenTitles.add(section.title);

    if (!section.updatedAt || !DATE_PATTERN.test(section.updatedAt)) {
      errors.push(`${section.title}: invalid updated_at`);
    }
    if (!section.verifiedAtCommit || !COMMIT_PATTERN.test(section.verifiedAtCommit)) {
      errors.push(`${section.title}: invalid verified_at_commit`);
    }
    if (section.sourcePaths.length === 0) errors.push(`${section.title}: source_paths is empty`);
    for (const sourcePath of section.sourcePaths) {
      const error = validateSourcePath(sourcePath, tracked);
      if (error) errors.push(`${section.title}: ${error}`);
    }

    if (section.verifiedAtCommit && COMMIT_PATTERN.test(section.verifiedAtCommit)) {
      try {
        git(["cat-file", "-e", `${section.verifiedAtCommit}^{commit}`]);
        const changed = changedFilesSince(section.verifiedAtCommit);
        const affected = changed.filter((file) => !isControlPlaneChange(file, section.verifiedAtCommit)
          && section.sourcePaths.some((sourcePath) => matchesSourcePath(file, sourcePath)));
        results.push({ title: section.title, stale: affected.length > 0, changed: affected });
      } catch {
        errors.push(`${section.title}: commit is unavailable (${section.verifiedAtCommit})`);
      }
    }
  }

  return { ok: errors.length === 0 && results.every((result) => !result.stale), errors, results };
}

const report = checkFreshness();
const fresh = report.results.filter((result) => !result.stale).length;
const stale = report.results.filter((result) => result.stale).length;

console.log(`memory: ${MEMORY_PATH}`);
console.log(`sections: ${report.results.length}`);
console.log(`fresh: ${fresh}`);
console.log(`stale: ${stale}`);
for (const result of report.results.filter((item) => item.stale)) {
  console.log(`stale section: ${result.title}`);
  for (const file of result.changed) console.log(`  changed source: ${file}`);
}
for (const error of report.errors) console.error(`error: ${error}`);
process.exitCode = report.ok ? 0 : 1;
