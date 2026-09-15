#!/usr/bin/env node
/**
 * Ask what was actually published, rather than whether a request succeeded.
 *
 *   node scripts/check-published.mjs entry <export-dir>
 *   node scripts/check-published.mjs web <base-url> [--entry <path>] [--wait <seconds>]
 *   node scripts/check-published.mjs ota <eas-update.json>
 *   node scripts/check-published.mjs expo-go
 *
 * `entry` prints the export's entry bundle as `path=…`, for $GITHUB_OUTPUT.
 * That name is a content hash, so no other build carries it, and `web` asks
 * the live site for exactly that name with the same code. A 200 would not do:
 * Pages answers 200 with the previous deploy while a new one propagates, and a
 * half-published artifact answers 200 for a shell whose bundle is gone.
 * Without `--entry`, `web` checks what the nightly can know — that the live
 * bundle declares the version `app.json` names.
 *
 * `ota` verifies and records one `eas update --json` publication. `expo-go`
 * asks whether the Expo Go the stores carry can open this project at all;
 * `.github/workflows/nightly.yml` records why that is a question.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The entry bundle a page references, as a path below the site's base. */
export function entryOf(html) {
  return /\/_expo\/static\/js\/web\/entry-[\w-]+\.js/.exec(html)?.[0] ?? null;
}

/**
 * The version the app config inside a bundle declares.
 *
 * Expo embeds that config as a JSON string, so every quote in it arrives
 * escaped: a search for `"version":"1.8.0"` finds nothing whether the version
 * matches or not, which is a check that fails the same way on a healthy site.
 * Backslashes go first. The version is read from the object that carries the
 * app's own slug — `[^{}]` keeps both keys in one object — because a library
 * in the same bundle may declare a version of its own.
 */
export function appVersionOf(bundle, slug) {
  // Expo slugs are URL-safe words, and holding the slug to that shape is what
  // lets it sit in a pattern without an escape that could be incomplete.
  if (!/^[a-z0-9-]+$/i.test(slug)) throw new Error(`not an Expo slug: ${slug}`);
  const flat = bundle.replaceAll("\\", "");
  const after = new RegExp(`"slug":"${slug}"[^{}]*?"version":"(\\d+\\.\\d+\\.\\d+)"`).exec(flat);
  const before = new RegExp(`"version":"(\\d+\\.\\d+\\.\\d+)"[^{}]*?"slug":"${slug}"`).exec(flat);
  return after?.[1] ?? before?.[1] ?? null;
}

/**
 * The newest SDK the stores' Expo Go runs, from Expo's own version list.
 *
 * That list names a preview SDK before any store carries its client: on
 * 2026-09-15 it listed 58.0.0, client builds included, while its `expoVersion`
 * still read `~58.0.0-preview.1`. So "newest" means newest released — an
 * `expoVersion` with no prerelease tag.
 */
export function storeSdkMajor(sdkVersions) {
  const released = Object.entries(sdkVersions ?? {})
    .filter(([, sdk]) => typeof sdk?.expoVersion === "string" && !sdk.expoVersion.includes("-") && sdk.beta !== true)
    .map(([version]) => Number.parseInt(version, 10))
    .filter((major) => Number.isInteger(major));
  return released.length > 0 ? Math.max(...released) : null;
}

/** The SDK major a dependency range such as `~57.0.20` pins. */
export const sdkMajorOf = (range) => Number.parseInt(String(range).replace(/^\D*/, ""), 10);

/**
 * One `eas update --platform all` publication, verified and written down.
 *
 * It is two updates in one group, and each must name the runtime Expo Go loads
 * for this SDK; anything else was published for a client that does not exist
 * here. The group and both ids are what a rollback republishes from, so they
 * are recorded where the run keeps them rather than copied out by hand.
 */
export function otaRecord(updates, sdkMajor) {
  const list = Array.isArray(updates) ? updates : [];
  const runtime = `exposdk:${sdkMajor}.0.0`;
  const problems = [];
  const platforms = list.map((update) => update.platform).sort().join(",");
  if (platforms !== "android,ios") problems.push(`expected one update per platform, got [${platforms}]`);
  const groups = new Set(list.map((update) => update.group));
  if (groups.size !== 1) problems.push(`expected one update group, got ${groups.size}`);
  for (const update of list) {
    if (update.runtimeVersion !== runtime) {
      problems.push(`the ${update.platform} update targets ${update.runtimeVersion}, not ${runtime}`);
    }
  }
  const [first] = list;
  const summary = [
    "### Expo Go preview update",
    "",
    `- **Group:** \`${first?.group ?? "none"}\``,
    `- **Runtime:** \`${first?.runtimeVersion ?? "none"}\``,
    `- **Message:** ${first?.message ?? "none"}`,
    "",
    "| Platform | Update | Manifest |",
    "|---|---|---|",
    ...list.map((update) => `| ${update.platform} | \`${update.id}\` | ${update.manifestPermalink} |`),
  ];
  return { problems, summary };
}

const fail = (message) => {
  console.log(`::error::${message}`);
  process.exitCode = 1;
};

const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

/** A network error is asked again; an HTTP status is an answer and returned as one. */
async function get(url) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      return { status: response.status, body: await response.text() };
    } catch (error) {
      if (attempt === 3) throw error;
      await pause(5_000);
    }
  }
}

async function checkWeb(base, { expected, waitSeconds, version, slug }) {
  const site = base.replace(/\/+$/, "");
  const deadline = Date.now() + waitSeconds * 1_000;
  let shell = await get(`${site}/`);
  let entry = shell.status === 200 ? entryOf(shell.body) : null;
  while (expected && entry !== expected && Date.now() < deadline) {
    console.log(`the site still serves ${entry ?? `HTTP ${shell.status}`}; asking again`);
    await pause(15_000);
    shell = await get(`${site}/`);
    entry = shell.status === 200 ? entryOf(shell.body) : null;
  }
  if (shell.status !== 200) return fail(`${site}/ answered HTTP ${shell.status}`);
  if (!entry) return fail(`${site}/ references no entry bundle`);
  if (expected && entry !== expected) {
    return fail(`production serves ${entry} after ${waitSeconds}s of asking; this run built ${expected}`);
  }
  const bundle = await get(`${site}${entry}`);
  if (bundle.status !== 200) return fail(`the shell references ${entry} and the site answers HTTP ${bundle.status} for it`);
  const served = appVersionOf(bundle.body, slug);
  if (served !== version) return fail(`production is not serving ${version}: the live bundle declares ${served ?? "no app version"}`);
  // A static route below the root, so a publication that carried only the
  // shell is caught too.
  const route = await get(`${site}/upcoming`);
  if (route.status !== 200) return fail(`${site}/upcoming answered HTTP ${route.status}`);
  const record = `production serves ${entry}, declaring ${version}`;
  console.log(record);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Web publication\n\n${record}\n`);
}

async function checkExpoGo(projectMajor) {
  const answer = await get("https://api.expo.dev/v2/versions/latest");
  if (answer.status !== 200) return fail(`api.expo.dev answered HTTP ${answer.status}; the store client could not be read`);
  const sdkVersions = JSON.parse(answer.body).data?.sdkVersions ?? {};
  const store = storeSdkMajor(sdkVersions);
  if (store == null) return fail("Expo's version list names no released SDK");
  const client = Object.entries(sdkVersions).find(([version]) => Number.parseInt(version, 10) === store)[1];
  const clients = `iOS ${client.iosClientVersion}, Android ${client.androidClientVersion}`;
  if (projectMajor !== store) {
    return fail(
      `the stores' Expo Go runs SDK ${store} (${clients}) and this project is on SDK ${projectMajor}: ` +
        "a preview update still publishes, and no up-to-date phone can open it. Move one SDK at a time.",
    );
  }
  console.log(`Expo Go (${clients}) opens SDK ${projectMajor}`);
  const ahead = new Set(Object.keys(sdkVersions).map((version) => Number.parseInt(version, 10)).filter((major) => major > store));
  for (const major of ahead) {
    console.log(`::notice::SDK ${major} is listed ahead of the stores; the day it is released, this check fails until the project moves to it`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const [command, target] = args;
  const option = (name) => (args.includes(name) ? (args[args.indexOf(name) + 1] ?? "") : undefined);
  const projectMajor = () => sdkMajorOf(JSON.parse(readFileSync("package.json", "utf8")).dependencies.expo);

  if (command === "entry" && target) {
    const entry = entryOf(readFileSync(join(target, "index.html"), "utf8"));
    if (!entry) throw new Error(`${target}/index.html references no entry bundle`);
    process.stdout.write(`path=${entry}\n`);
  } else if (command === "web" && target) {
    const expected = option("--entry");
    if (expected === "") return fail("--entry was given no bundle to look for");
    const { version, slug } = JSON.parse(readFileSync("app.json", "utf8")).expo;
    await checkWeb(target, { expected, waitSeconds: Number(option("--wait") ?? 0), version, slug });
  } else if (command === "ota" && target) {
    const { problems, summary } = otaRecord(JSON.parse(readFileSync(target, "utf8")), projectMajor());
    console.log(summary.join("\n"));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join("\n")}\n`);
    for (const problem of problems) fail(problem);
  } else if (command === "expo-go") {
    await checkExpoGo(projectMajor());
  } else {
    console.error("usage: check-published.mjs entry <dir> | web <base-url> [--entry <path>] [--wait <seconds>] | ota <file> | expo-go");
    process.exitCode = 1;
  }
}

// An unreachable site or an unreadable answer is a finding with a sentence, not
// a stack trace: "the site is down" and "the site is stale" need different work.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => fail(`could not complete the check: ${error.message}`));
}
