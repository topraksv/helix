import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const guard = resolve(root, "scripts/execution-authority-guard.mjs");

function run(args: string[], input = "", env: Record<string, string | undefined> = {}) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.HELIX_USER_AUTHORIZATION;
  return spawnSync(process.execPath, [guard, ...args], {
    cwd: root,
    input,
    encoding: "utf8",
    env: { ...cleanEnv, ...env },
  });
}

function command(
  executable: string,
  args: string[],
  cwd: string,
  input = "",
  env: Record<string, string | undefined> = {},
) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.HELIX_USER_AUTHORIZATION;
  return spawnSync(executable, args, {
    cwd,
    input,
    encoding: "utf8",
    env: { ...cleanEnv, ...env },
  });
}

function git(cwd: string, args: string[], input = "", env: Record<string, string | undefined> = {}) {
  return command("git", args, cwd, input, env);
}

function gitOutput(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function runInRepo(repo: string, args: string[], env: Record<string, string | undefined> = {}, input = "") {
  return command(process.execPath, [join(repo, "scripts/execution-authority-guard.mjs"), ...args], repo, input, env);
}

function runGuardFrom(cwd: string, repo: string, args: string[]) {
  return command(process.execPath, [join(repo, "scripts/execution-authority-guard.mjs"), ...args], cwd);
}

function commitToken(repo: string) {
  const branch = gitOutput(repo, ["symbolic-ref", "--short", "HEAD"]) || "HEAD";
  const diff = execFileSync("git", ["diff", "--cached", "--binary"], { cwd: repo, encoding: "buffer" });
  const digest = createHash("sha256").update(diff).digest("hex");
  return `commit:${branch}:${digest}`;
}

function pushToken(remoteRef: string, localSha: string) {
  return `push:origin:${remoteRef}:${localSha}`;
}

function expectSuccess(result: ReturnType<typeof command>) {
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}

function createSeedRepository() {
  const temp = mkdtempSync(join(tmpdir(), "helix-guard-"));
  const repo = join(temp, "repo");
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, "scripts"), { recursive: true });
  cpSync(resolve(root, "scripts/execution-authority-guard.mjs"), join(repo, "scripts/execution-authority-guard.mjs"));
  cpSync(resolve(root, ".githooks"), join(repo, ".githooks"), { recursive: true });
  expectSuccess(git(repo, ["init", "-b", "main"]));
  expectSuccess(git(repo, ["config", "user.name", "Helix isolated test"]));
  expectSuccess(git(repo, ["config", "user.email", "helix-isolated@example.test"]));
  expectSuccess(git(repo, ["config", "commit.gpgSign", "false"]));
  writeFileSync(join(repo, "state.txt"), "initial\n");
  expectSuccess(git(repo, ["add", "state.txt", "scripts", ".githooks"]));
  expectSuccess(git(repo, ["-c", "core.hooksPath=/dev/null", "commit", "-m", "bootstrap"]));
  expectSuccess(runInRepo(repo, ["install"]));
  expectSuccess(runInRepo(repo, ["check"]));
  return { temp, repo };
}

describe("execution authority guard", () => {
  it("blocks commit and push hooks without task-specific authorization", () => {
    const commit = run(["git-commit"]);
    expect(commit.status).toBe(1);
    expect(commit.stderr).toContain("git commit");
    expect(commit.stderr).toContain("HELIX_USER_AUTHORIZATION=commit:");

    const push = run(
      ["git-push", "origin"],
      "refs/heads/main 0123456789012345678901234567890123456789 refs/heads/main 0000000000000000000000000000000000000000\n",
    );
    expect(push.status).toBe(1);
    expect(push.stderr).toContain("git push");
    expect(push.stderr).toContain("HELIX_USER_AUTHORIZATION=push:origin:refs/heads/main:");
  });

  it("leaves ordinary test/control commands alone", () => {
    const safe = run(
      ["tool-hook"],
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "npm run control:check" } }),
    );
    expect(safe.status).toBe(0);
    expect(safe.stdout).toBe("");
  });

  it("denies release commands and asks only after the exact command token is supplied", () => {
    const command = "eas update --branch preview --platform all";
    const denied = run(["tool-hook"], JSON.stringify({ tool_input: { command } }));
    expect(denied.status).toBe(0);
    expect(JSON.parse(denied.stdout)).toMatchObject({
      continue: false,
      hookSpecificOutput: {
        permissionDecision: "deny",
      },
    });

    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const digest = createHash("sha256").update(`${head}\n${command}`).digest("hex");
    const authorized = run(
      ["tool-hook"],
      JSON.stringify({ tool_input: { command: `HELIX_USER_AUTHORIZATION=command:${digest} ${command}` } }),
    );
    expect(authorized.status).toBe(0);
    expect(JSON.parse(authorized.stdout)).toMatchObject({
      continue: true,
      hookSpecificOutput: {
        permissionDecision: "ask",
      },
    });
  });

  it("enforces commit/push authorization, staged-diff invalidation, and replay resistance in isolation", () => {
    const { temp, repo } = createSeedRepository();
    const remote = join(temp, "remote.git");
    try {
      expectSuccess(git(temp, ["init", "--bare", remote]));
      expectSuccess(git(repo, ["remote", "add", "origin", remote]));

      writeFileSync(join(repo, "first.txt"), "first\n");
      expectSuccess(git(repo, ["add", "first.txt"]));
      const firstCommit = commitToken(repo);
      const headBeforeUnauthorizedCommit = gitOutput(repo, ["rev-parse", "HEAD"]);
      const unauthorizedCommit = git(repo, ["commit", "-m", "first"]);
      expect(unauthorizedCommit.status).toBe(1);
      expect(unauthorizedCommit.stderr).toContain("default-deny");
      expect(gitOutput(repo, ["rev-parse", "HEAD"])).toBe(headBeforeUnauthorizedCommit);

      expectSuccess(git(repo, ["commit", "-m", "first"], "", { HELIX_USER_AUTHORIZATION: firstCommit }));

      writeFileSync(join(repo, "second.txt"), "second\n");
      expectSuccess(git(repo, ["add", "second.txt"]));
      const staleCommit = commitToken(repo);
      writeFileSync(join(repo, "second.txt"), "second changed after approval\n");
      expectSuccess(git(repo, ["add", "second.txt"]));
      const headBeforeStaleCommit = gitOutput(repo, ["rev-parse", "HEAD"]);
      const staleCommitResult = git(
        repo,
        ["commit", "-m", "stale commit authorization"],
        "",
        { HELIX_USER_AUTHORIZATION: staleCommit },
      );
      expect(staleCommitResult.status).toBe(1);
      expect(staleCommitResult.stderr).toContain("default-deny");
      expect(gitOutput(repo, ["rev-parse", "HEAD"])).toBe(headBeforeStaleCommit);

      const currentCommit = commitToken(repo);
      expectSuccess(git(repo, ["commit", "-m", "second"], "", { HELIX_USER_AUTHORIZATION: currentCommit }));
      const headAfterSecondCommit = gitOutput(repo, ["rev-parse", "HEAD"]);

      const commitAuthUsedForPush = git(
        repo,
        ["push", "--dry-run", "origin", "main"],
        "",
        { HELIX_USER_AUTHORIZATION: currentCommit },
      );
      expect(commitAuthUsedForPush.status).toBe(1);
      expect(commitAuthUsedForPush.stderr).toContain("git push");

      const unauthorizedPush = git(repo, ["push", "--dry-run", "origin", "main"]);
      expect(unauthorizedPush.status).toBe(1);
      expect(unauthorizedPush.stderr).toContain("default-deny");

      const firstPush = pushToken("refs/heads/main", headAfterSecondCommit);
      expectSuccess(
        git(repo, ["push", "--dry-run", "origin", "main"], "", { HELIX_USER_AUTHORIZATION: firstPush }),
      );
      expect(git(remote, ["show-ref", "--verify", "--quiet", "refs/heads/main"]).status).toBe(1);

      writeFileSync(join(repo, "third.txt"), "third\n");
      expectSuccess(git(repo, ["add", "third.txt"]));
      const thirdCommit = commitToken(repo);
      expectSuccess(git(repo, ["commit", "-m", "third"], "", { HELIX_USER_AUTHORIZATION: thirdCommit }));
      const headAfterStateChange = gitOutput(repo, ["rev-parse", "HEAD"]);
      expect(headAfterStateChange).not.toBe(headAfterSecondCommit);

      const replayedOldHead = git(
        repo,
        ["push", "--dry-run", "origin", "main"],
        "",
        { HELIX_USER_AUTHORIZATION: firstPush },
      );
      expect(replayedOldHead.status).toBe(1);

      const currentPush = pushToken("refs/heads/main", headAfterStateChange);
      expectSuccess(
        git(repo, ["push", "--dry-run", "origin", "main"], "", { HELIX_USER_AUTHORIZATION: currentPush }),
      );

      const replayedOldRef = git(
        repo,
        ["push", "--dry-run", "origin", "HEAD:refs/heads/feature"],
        "",
        { HELIX_USER_AUTHORIZATION: currentPush },
      );
      expect(replayedOldRef.status).toBe(1);
      const featurePush = pushToken("refs/heads/feature", headAfterStateChange);
      expectSuccess(
        git(repo, ["push", "--dry-run", "origin", "HEAD:refs/heads/feature"], "", {
          HELIX_USER_AUTHORIZATION: featurePush,
        }),
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("recovers tracked hooks in a fresh clone without existing local hooks", () => {
    const { temp, repo } = createSeedRepository();
    const clone = join(temp, "clone");
    try {
      expectSuccess(git(temp, ["clone", repo, clone]));
      const hooksDirectory = resolve(clone, gitOutput(clone, ["rev-parse", "--git-path", "hooks"]));
      rmSync(join(hooksDirectory, "pre-commit"), { force: true });
      rmSync(join(hooksDirectory, "pre-push"), { force: true });

      const missing = runInRepo(clone, ["check"]);
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain("control:setup");

      expectSuccess(runInRepo(clone, ["install"]));
      expectSuccess(runInRepo(clone, ["check"]));
      mkdirSync(join(clone, "nested"));
      expectSuccess(runGuardFrom(join(clone, "nested"), clone, ["check"]));

      const legacyPreCommit = readFileSync(join(clone, ".githooks", "pre-commit"), "utf8")
        .replace("# helix-execution-authority-hook:v1\n", "");
      writeFileSync(join(hooksDirectory, "pre-commit"), legacyPreCommit);
      chmodSync(join(hooksDirectory, "pre-commit"), 0o755);
      const stale = runInRepo(clone, ["check"]);
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain("does not match tracked");
      expectSuccess(runInRepo(clone, ["install"]));
      expectSuccess(runInRepo(clone, ["check"]));
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
