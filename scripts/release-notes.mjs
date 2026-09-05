#!/usr/bin/env node
/**
 * The release notes for one version, taken from `CHANGELOG.md`.
 *
 * A GitHub Release and a changelog entry are the same text for the same
 * audience, and keeping them as two documents is how they come apart: the tag
 * page ends up either empty or holding a summary nobody updated. So the
 * changelog stays the single source and this reads a section out of it.
 *
 * Exact heading match, not a prefix. `## 1.4.1` must not be found by a search
 * for `## 1.4` — and `## 1.4.10` must not be found by a search for `## 1.4.1`,
 * which is the version of that mistake that survives a review because it is
 * two years away from mattering.
 *
 *   node scripts/release-notes.mjs 1.4.2
 *
 * Exits 1 when the version has no section, because a release published with
 * empty notes is worse than a release that failed loudly.
 */
import { readFileSync } from "node:fs";

/** @param {string} changelog @param {string} version */
export function notesFor(changelog, version) {
  const lines = changelog.split("\n");
  const heading = `## ${version}`;
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## \d/.test(line));
  const body = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
  return body.length > 0 ? body : null;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const version = (process.argv[2] ?? "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error("usage: node scripts/release-notes.mjs <version>");
    process.exit(1);
  }
  const notes = notesFor(readFileSync("CHANGELOG.md", "utf8"), version);
  if (!notes) {
    console.error(`CHANGELOG.md has no section for ${version}.`);
    process.exit(1);
  }
  process.stdout.write(`${notes}\n`);
}
