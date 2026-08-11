#!/usr/bin/env node

import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";

const execFile = promisify(execFileCallback);
const root = resolve(import.meta.dirname, "../..");
const graphPath = resolve(root, "graphify-out/graph.json");
const manifestPath = resolve(root, "graphify-out/manifest.json");
const required = process.argv.includes("--required");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(graphPath)) || !(await exists(manifestPath))) {
  const message = "Graphify output is absent; the navigation map is optional until a fresh graph is built.";
  if (required) {
    console.error(`Graphify freshness failed: ${message}`);
    process.exit(1);
  }
  console.log(`Graphify freshness: optional output absent (${message})`);
  process.exit(0);
}

const errors = [];
const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd: root });
const head = stdout.trim();
const graph = JSON.parse(await readFile(graphPath, "utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (graph.built_at_commit !== head) {
  errors.push(`built_at_commit ${graph.built_at_commit ?? "missing"} does not equal HEAD ${head}`);
}
const entries = Object.entries(manifest);
if (entries.length === 0) errors.push("manifest is empty");

let maxSourceMtime = 0;
let missing = 0;
for (const [relativePath, metadata] of entries) {
  const sourcePath = resolve(root, relativePath);
  if (!(await exists(sourcePath))) {
    missing += 1;
    continue;
  }
  const sourceStat = await stat(sourcePath);
  maxSourceMtime = Math.max(maxSourceMtime, sourceStat.mtimeMs, Number(metadata?.mtime ?? 0) * 1000);
}
if (missing > 0) errors.push(`${missing} manifest source file(s) are missing`);
const manifestStat = await stat(manifestPath);
if (manifestStat.mtimeMs + 1000 < maxSourceMtime) {
  errors.push(`manifest mtime ${new Date(manifestStat.mtimeMs).toISOString()} predates the newest manifest/source mtime ${new Date(maxSourceMtime).toISOString()}`);
}

if (errors.length > 0) {
  console.error("Graphify freshness: DATED");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Graphify freshness: CURRENT (${head.slice(0, 12)}, ${entries.length} manifest sources)`);
