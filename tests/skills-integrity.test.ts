import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(process.cwd(), "scripts/check-skills.mjs");
const fixtures: string[] = [];

function run(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "helix-skills-"));
  fixtures.push(root);
  const skillDir = join(root, ".agents", "skills", "example-skill");
  mkdirSync(join(skillDir, "references"), { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    [
      "---",
      "name: example-skill",
      "description: Verifies the integrity fixture.",
      "---",
      "",
      "# Example",
      "",
      "[Reference](references/example.md)",
      "",
    ].join("\n"),
  );
  writeFileSync(join(skillDir, "references", "example.md"), "# Reference\n");
  writeFileSync(
    join(root, "skills-lock.json"),
    `${JSON.stringify(
      {
        version: 1,
        skills: {
          "example-skill": {
            source: ".",
            sourceType: "local",
            skillPath: ".agents/skills/example-skill/SKILL.md",
            computedHash: "pending",
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  return { root, skillDir };
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

describe("skill integrity gate", () => {
  it("writes a compatible snapshot hash and verifies it", () => {
    const { root } = createFixture();

    expect(run(root, "--write").status).toBe(0);
    const lock = JSON.parse(
      readFileSync(join(root, "skills-lock.json"), "utf8"),
    );
    expect(lock.skills["example-skill"].computedHash).toMatch(/^[0-9a-f]{64}$/);

    const verification = run(root);
    expect(verification.status).toBe(0);
    expect(verification.stdout).toContain("Verified 1 pinned skill");
  });

  it("rejects content drift and missing local references", () => {
    const { root, skillDir } = createFixture();
    expect(run(root, "--write").status).toBe(0);

    writeFileSync(
      join(skillDir, "SKILL.md"),
      `${readFileSync(join(skillDir, "SKILL.md"), "utf8")}\n[Missing](references/missing.md)\n`,
    );

    const verification = run(root);
    expect(verification.status).toBe(1);
    expect(verification.stderr).toContain("missing link");
    expect(verification.stderr).toContain("hash differs");
  });
});
