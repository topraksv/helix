#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
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

const dangerousMatchers = [
  {
    action: "git-commit",
    pattern: /\bgit\b(?:\s+(?:(?:-[^\s]+|--[\w-]+)(?:\s+[^\s;&|]+)?))*\s+commit\b/i,
  },
  {
    action: "git-push",
    pattern: /\bgit\b(?:\s+(?:(?:-[^\s]+|--[\w-]+)(?:\s+[^\s;&|]+)?))*\s+push\b/i,
  },
  {
    action: "git-external",
    pattern: /\bgit\b(?:\s+(?:(?:-[^\s]+|--[\w-]+)(?:\s+[^\s;&|]+)?))*\s+(?:pull|fetch|ls-remote|remote)\b/i,
  },
  {
    action: "git-history",
    pattern: /\bgit\b(?:\s+(?:(?:-[^\s]+|--[\w-]+)(?:\s+[^\s;&|]+)?))*\s+(?:reset|restore|rebase|merge|revert|cherry-pick|clean|checkout|update-ref|filter-repo|filter-branch)\b/i,
  },
  { action: "git-history", pattern: /\bgit\s+(?:branch\s+-[dD]|tag\s+-d)\b/i },
  {
    action: "github-release",
    pattern: /\bgh\s+(?:workflow\s+run|release\s+(?:create|upload|delete)|pr\s+(?:create|merge|close|reopen))\b/i,
  },
  {
    action: "expo-release",
    pattern: /\b(?:eas|npx\s+(?:--\S+\s+)*eas-cli(?:@\S+)?|npm\s+(?:exec\s+)?eas-cli(?:@\S+)?)\s+(?:\S+\s+)*(?:update|build|submit)\b/i,
  },
  {
    action: "release-command",
    pattern: /\b(?:npm\s+run\s+(?:deploy|release|ota|publish|ship)|(?:npx\s+)?expo\s+publish|(?:vercel|netlify|firebase)\s+deploy)\b/i,
  },
  {
    action: "database-release",
    pattern: /\b(?:npx\s+)?supabase\s+(?:db\s+push|migration\s+up)\b/i,
  },
];

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

function hookBytes(path) {
  return readFileSync(path);
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

  if (!existsSync(target)) {
    problems.push(`active ${target} is missing`);
    return { source, target, problems };
  }

  const targetStat = lstatSync(target);
  if (targetStat.isSymbolicLink()) {
    if (realpathSync(target) !== realpathSync(source)) {
      problems.push(`active ${target} is not a symlink to tracked ${source}`);
    }
  } else if (!hookBytes(target).equals(hookBytes(source))) {
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

      if (existsSync(target)) {
        const targetStat = lstatSync(target);
        if (targetStat.isSymbolicLink()) {
          if (realpathSync(target) !== realpathSync(source)) {
            throw new Error(`refusing to replace existing non-Helix symlink ${target}`);
          }
          chmodSync(target, 0o755);
          continue;
        }

        const current = readFileSync(target, "utf8");
        const expected = readFileSync(source, "utf8");
        if (current !== expected && current !== LEGACY_HOOKS[hook]) {
          throw new Error(`refusing to replace existing non-Helix hook ${target}`);
        }
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
  return dangerousMatchers.filter(({ pattern }) => pattern.test(command)).map(({ action }) => action);
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

function runCommitHook() {
  const expected = commitAuthorization();
  if (process.env[AUTHORIZATION_ENV] !== expected) failGitHook(expected, "git commit");
}

function runPushHook() {
  const remote = process.argv[3] || "unknown";
  const lines = readFileSync(0, "utf8").trim().split(/\r?\n/).filter(Boolean);
  const [, localSha, remoteRef] = (lines[0] || "").split(/\s+/);
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
