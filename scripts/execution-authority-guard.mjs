#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fstatSync,
  mkdirSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  constants as fsConstants,
} from "node:fs";
import { join, resolve } from "node:path";

const AUTHORIZATION_ENV = "HELIX_USER_AUTHORIZATION";
const HOOKS = ["pre-commit", "pre-push"];
const LEGACY_HOOKS = {
  "pre-commit":
    "#!/bin/sh\nexec node \"$(git rev-parse --show-toplevel)/scripts/execution-authority-guard.mjs\" git-commit\n",
  "pre-push":
    "#!/bin/sh\nexec node \"$(git rev-parse --show-toplevel)/scripts/execution-authority-guard.mjs\" git-push \"$@\"\n",
};

const GIT_ACTIONS = {
  commit: "git-commit",
  push: "git-push",
  pull: "git-external",
  fetch: "git-external",
  "ls-remote": "git-external",
  remote: "git-external",
  reset: "git-history",
  restore: "git-history",
  rebase: "git-history",
  merge: "git-history",
  revert: "git-history",
  "cherry-pick": "git-history",
  clean: "git-history",
  checkout: "git-history",
  "update-ref": "git-history",
  "filter-repo": "git-history",
  "filter-branch": "git-history",
};
const GITHUB_RELEASE_SEQUENCES = [
  ["gh", "workflow", "run"],
  ["gh", "release", "create"],
  ["gh", "release", "upload"],
  ["gh", "release", "delete"],
  ["gh", "pr", "create"],
  ["gh", "pr", "merge"],
  ["gh", "pr", "close"],
  ["gh", "pr", "reopen"],
];
const EXPO_RELEASE_ACTIONS = new Set(["update", "build", "submit"]);
const RELEASE_COMMAND_SEQUENCES = [
  ["expo", "publish"],
  ["npx", "expo", "publish"],
  ["vercel", "deploy"],
  ["netlify", "deploy"],
  ["firebase", "deploy"],
];
const DATABASE_RELEASE_SEQUENCES = [
  ["supabase", "db", "push"],
  ["supabase", "db", "migration", "up"],
  ["npx", "supabase", "db", "push"],
  ["npx", "supabase", "migration", "up"],
];
const SHELL_SEPARATORS = new Set([";", "&", "|", "<", ">", "`"]);

function commandTokens(command) {
  return command.match(/[^\s;&|<>`]+|[;&|<>`]/g) || [];
}

function isOption(token) {
  return token.startsWith("-") && token.length > 1;
}

function isEasCli(token) {
  const normalized = token.toLowerCase();
  return normalized === "eas-cli" || normalized.startsWith("eas-cli@");
}

function hasSequence(tokens, sequence) {
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (sequence.every((part, offset) => tokens[index + offset].toLowerCase() === part.toLowerCase())) return true;
  }
  return false;
}

function hasGitAction(tokens, actions) {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].toLowerCase() !== "git") continue;

    const pending = [index + 1];
    const visited = new Set();
    for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex += 1) {
      const position = pending[pendingIndex];
      if (visited.has(position) || position >= tokens.length) continue;
      visited.add(position);

      const token = tokens[position];
      if (SHELL_SEPARATORS.has(token)) continue;
      const action = GIT_ACTIONS[token.toLowerCase()];
      if (action && actions.has(action)) return true;
      if (!isOption(token)) continue;

      pending.push(position + 1);
      if (position + 1 < tokens.length && !SHELL_SEPARATORS.has(tokens[position + 1])) {
        pending.push(position + 2);
      }
    }
  }
  return false;
}

function hasGitDelete(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].toLowerCase() !== "git") continue;

    const pending = [index + 1];
    const visited = new Set();
    for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex += 1) {
      const position = pending[pendingIndex];
      if (visited.has(position) || position >= tokens.length) continue;
      visited.add(position);

      const token = tokens[position];
      if (SHELL_SEPARATORS.has(token)) continue;
      if (token.toLowerCase() === "branch" || token.toLowerCase() === "tag") {
        for (let argument = position + 1; argument < tokens.length && !SHELL_SEPARATORS.has(tokens[argument]); argument += 1) {
          if (["-d", "-D", "--delete"].includes(tokens[argument])) return true;
        }
        continue;
      }
      if (!isOption(token)) continue;

      pending.push(position + 1);
      if (position + 1 < tokens.length && !SHELL_SEPARATORS.has(tokens[position + 1])) {
        pending.push(position + 2);
      }
    }
  }
  return false;
}

function hasGithubRelease(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].toLowerCase() !== "gh") continue;
    const pending = [index + 1];
    const visited = new Set();
    for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex += 1) {
      const position = pending[pendingIndex];
      if (visited.has(position) || position >= tokens.length) continue;
      visited.add(position);

      const token = tokens[position];
      if (SHELL_SEPARATORS.has(token)) continue;
      if (GITHUB_RELEASE_SEQUENCES.some((sequence) => hasSequence(tokens.slice(position), sequence.slice(1)))) {
        return true;
      }
      if (!isOption(token)) continue;

      pending.push(position + 1);
      if (position + 1 < tokens.length && !SHELL_SEPARATORS.has(tokens[position + 1])) {
        pending.push(position + 2);
      }
    }
  }
  return false;
}

function hasEasRelease(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    const launcher = tokens[index].toLowerCase();
    let position = index + 1;
    if (launcher === "npx") {
      while (position < tokens.length && tokens[position].startsWith("--")) position += 1;
      if (!isEasCli(tokens[position] || "")) continue;
      position += 1;
    } else if (launcher === "npm") {
      if (tokens[position]?.toLowerCase() === "exec") position += 1;
      if (!isEasCli(tokens[position] || "")) continue;
      position += 1;
    } else if (launcher === "eas") {
      // `eas` is already the CLI executable; scan its arguments below.
    } else {
      continue;
    }

    while (position < tokens.length && !SHELL_SEPARATORS.has(tokens[position])) {
      if (EXPO_RELEASE_ACTIONS.has(tokens[position].toLowerCase())) return true;
      position += 1;
    }
  }
  return false;
}

function hasReleaseCommand(tokens) {
  return RELEASE_COMMAND_SEQUENCES.some((sequence) => hasSequence(tokens, sequence))
    || ["deploy", "release", "ota", "publish", "ship"].some((action) => hasSequence(tokens, ["npm", "run", action]));
}

function hasDatabaseRelease(tokens) {
  return DATABASE_RELEASE_SEQUENCES.some((sequence) => hasSequence(tokens, sequence));
}

function repoGit(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function repositoryRoot() {
  const root = repoGit("rev-parse", "--show-toplevel");
  if (!root) throw new Error("Not inside a Git worktree.");
  return root;
}

function activeHooksDirectory(root) {
  const hooksPath = repoGit("rev-parse", "--git-path", "hooks");
  if (!hooksPath) throw new Error("Git could not resolve the active hooks directory.");
  return resolve(process.cwd(), hooksPath);
}

function trackedHookPath(root, hook) {
  return join(root, ".githooks", hook);
}

function readRegularHook(path) {
  const descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    if (!fstatSync(descriptor).isFile()) throw new Error(`active ${path} is not a regular file`);
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

function isExecutable(path) {
  return (statSync(path).mode & 0o111) !== 0;
}

function hookState(root, hook) {
  const source = trackedHookPath(root, hook);
  const target = join(activeHooksDirectory(root), hook);
  const problems = [];

  if (!existsSync(source)) {
    problems.push(`tracked ${source} is missing`);
    return { source, target, problems };
  }
  if (!isExecutable(source)) problems.push(`tracked ${source} is not executable`);

  let targetStat;
  try {
    targetStat = lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") problems.push(`active ${target} is missing`);
    else problems.push(`active ${target} could not be inspected: ${error.message}`);
    return { source, target, problems };
  }
  if (targetStat.isSymbolicLink()) {
    if (realpathSync(target) !== realpathSync(source)) {
      problems.push(`active ${target} is not a symlink to tracked ${source}`);
    }
  } else if (readRegularHook(target) !== readFileSync(source, "utf8")) {
    problems.push(`active ${target} does not match tracked ${source}`);
  }
  if (!isExecutable(target)) problems.push(`active ${target} is not executable`);

  return { source, target, problems };
}

function printHookProblems(problems) {
  for (const problem of problems) process.stderr.write(`Helix execution guard: ${problem}.\n`);
}

function checkHooks() {
  try {
    const root = repositoryRoot();
    const problems = HOOKS.flatMap((hook) => hookState(root, hook).problems);
    if (problems.length > 0) {
      printHookProblems(problems);
      process.stderr.write("Run `npm run control:setup` to install the tracked Git guard wiring.\n");
      process.exitCode = 1;
      return;
    }
    process.stdout.write("Execution guard hooks: current (pre-commit, pre-push).\n");
  } catch (error) {
    process.stderr.write(`Helix execution guard: ${error.message}\n`);
    process.exitCode = 1;
  }
}

function installHooks() {
  try {
    const root = repositoryRoot();
    const hooksDirectory = activeHooksDirectory(root);
    mkdirSync(hooksDirectory, { recursive: true });

    for (const hook of HOOKS) {
      const source = trackedHookPath(root, hook);
      if (!existsSync(source)) throw new Error(`tracked ${source} is missing`);
      if (!isExecutable(source)) throw new Error(`tracked ${source} is not executable`);

      const target = join(hooksDirectory, hook);
      if (resolve(target) === resolve(source)) {
        chmodSync(source, 0o755);
        continue;
      }

      let targetStat;
      try {
        targetStat = lstatSync(target);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        copyFileSync(source, target, fsConstants.COPYFILE_EXCL);
        chmodSync(target, 0o755);
        continue;
      }

      if (targetStat.isSymbolicLink()) {
        if (realpathSync(target) !== realpathSync(source)) {
          throw new Error(`refusing to replace existing non-Helix symlink ${target}`);
        }
        continue;
      }

      const current = readRegularHook(target);
      const expected = readFileSync(source, "utf8");
      if (current !== expected && current !== LEGACY_HOOKS[hook]) {
        throw new Error(`refusing to replace existing non-Helix hook ${target}`);
      }

      copyFileSync(source, target);
      chmodSync(target, 0o755);
    }

    process.stdout.write("Execution guard hooks: installed (pre-commit, pre-push).\n");
  } catch (error) {
    process.stderr.write(`Helix execution guard: ${error.message}\n`);
    process.exitCode = 1;
  }
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stagedDiffHash() {
  try {
    const diff = execFileSync("git", ["diff", "--cached", "--binary"], {
      encoding: "buffer",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return hash(diff);
  } catch {
    return "unavailable";
  }
}

function commitAuthorization() {
  return `commit:${repoGit("symbolic-ref", "--short", "HEAD") || "HEAD"}:${stagedDiffHash()}`;
}

function pushAuthorization(command) {
  const match = command.match(/\bgit\s+push(?:\s+(?:-[^\s]+|--[^\s]+))*\s+([^\s;&|]+)(?:\s+([^\s;&|]+))?/i);
  const remote = match?.[1] || "origin";
  const branch = repoGit("branch", "--show-current") || "HEAD";
  const refspec = match?.[2] || branch;
  const remoteRef = refspec.includes(":")
    ? refspec.slice(refspec.lastIndexOf(":") + 1)
    : refspec.startsWith("refs/")
      ? refspec
      : `refs/heads/${refspec}`;
  return `push:${remote}:${remoteRef}:${repoGit("rev-parse", "HEAD") || "unavailable"}`;
}

function commandAuthorization(action, command) {
  if (action === "git-commit") return commitAuthorization();
  if (action === "git-push") return pushAuthorization(command);
  return `command:${hash(`${repoGit("rev-parse", "HEAD")}\n${command}`)}`;
}

function stripAuthorization(command) {
  return command
    .replace(new RegExp(`\\b${AUTHORIZATION_ENV}=(?:"[^"]*"|'[^']*'|[^\\s;&|]+)`, "g"), "")
    .replace(/\s+/g, " ")
    .trim();
}

function inlineAuthorization(command) {
  const match = command.match(
    new RegExp(`(?:^|[;&|]\\s*)${AUTHORIZATION_ENV}=(?:"([^"]*)"|'([^']*)'|([^\\s;&|]+))`),
  );
  return match?.[1] || match?.[2] || match?.[3] || "";
}

function isSingleCommand(command) {
  return !/[;&|<>`\n]/.test(command);
}

function detectedActions(command) {
  const tokens = commandTokens(command);
  const actions = [];
  if (hasGitAction(tokens, new Set(["git-commit"]))) actions.push("git-commit");
  if (hasGitAction(tokens, new Set(["git-push"]))) actions.push("git-push");
  if (hasGitAction(tokens, new Set(["git-external"]))) actions.push("git-external");
  if (hasGitAction(tokens, new Set(["git-history"])) || hasGitDelete(tokens)) actions.push("git-history");
  if (GITHUB_RELEASE_SEQUENCES.some((sequence) => hasSequence(tokens, sequence)) || hasGithubRelease(tokens)) actions.push("github-release");
  if (hasEasRelease(tokens)) actions.push("expo-release");
  if (hasReleaseCommand(tokens)) actions.push("release-command");
  if (hasDatabaseRelease(tokens)) actions.push("database-release");
  return actions;
}

function hookDecision(decision, reason) {
  process.stdout.write(
    `${JSON.stringify({
      continue: decision === "deny" ? false : true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    })}\n`,
  );
}

function runToolHook() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    hookDecision("deny", "Helix execution guard could not inspect the tool request.");
    return;
  }

  const toolInput = input?.tool_input ?? input;
  const command = typeof toolInput?.command === "string" ? toolInput.command : "";
  if (!command) return;

  const normalized = stripAuthorization(command);
  const actions = [...new Set(detectedActions(normalized))];
  if (actions.length === 0) return;

  if (actions.length !== 1 || !isSingleCommand(normalized)) {
    hookDecision(
      "deny",
      "Helix default-deny: chained or compound Git/release commands require separate user-run commands.",
    );
    return;
  }

  const expected = commandAuthorization(actions[0], normalized);
  const supplied = inlineAuthorization(command);
  if (supplied !== expected) {
    hookDecision(
      "deny",
      `Helix default-deny: this exact ${actions[0]} action needs explicit user authorization. ` +
        `The user must rerun the exact command with ${AUTHORIZATION_ENV}=${expected}.`,
    );
    return;
  }

  hookDecision("ask", `Exact ${actions[0]} authorization is present; user approval is still required.`);
}

function failGitHook(expected, action) {
  process.stderr.write(
    `Helix default-deny: ${action} is blocked. User must rerun the exact action with ` +
      `${AUTHORIZATION_ENV}=${expected}.\n`,
  );
  process.exitCode = 1;
}

function rejectGitHook(reason, action) {
  process.stderr.write(`Helix default-deny: ${action} is blocked: ${reason}.\n`);
  process.exitCode = 1;
}

function runCommitHook() {
  const expected = commitAuthorization();
  if (process.env[AUTHORIZATION_ENV] !== expected) failGitHook(expected, "git commit");
}

function runPushHook() {
  const remote = process.argv[3] || "unknown";
  const lines = readFileSync(0, "utf8").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) {
    rejectGitHook("push authorization covers exactly one ref update; push one ref at a time", "git push");
    return;
  }
  const [, localSha, remoteRef] = lines[0].split(/\s+/);
  const expected = `push:${remote}:${remoteRef || "unknown"}:${localSha || "unknown"}`;
  if (process.env[AUTHORIZATION_ENV] !== expected) failGitHook(expected, "git push");
}

const mode = process.argv[2];
if (mode === "install") installHooks();
else if (mode === "check") checkHooks();
else if (mode === "tool-hook") runToolHook();
else if (mode === "git-commit") runCommitHook();
else if (mode === "git-push") runPushHook();
else {
  process.stderr.write(
    "Usage: execution-authority-guard.mjs <install|check|tool-hook|git-commit|git-push>\n",
  );
  process.exitCode = 2;
}
