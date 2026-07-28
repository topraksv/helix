import { createHash } from "node:crypto";
import {
  access,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const skillsRoot = path.join(root, ".agents", "skills");
const lockPath = path.join(root, "skills-lock.json");
const writeMode = process.argv.includes("--write");
const errors = [];

async function collectFiles(baseDir, currentDir, results) {
  const entries = await readdir(currentDir, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isSymbolicLink()) {
        errors.push(
          `${path.relative(root, fullPath)} is a symlink; skills must be vendored files.`,
        );
        return;
      }

      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") return;
        await collectFiles(baseDir, fullPath, results);
        return;
      }

      if (entry.isFile()) {
        results.push({
          relativePath: path
            .relative(baseDir, fullPath)
            .split(path.sep)
            .join("/"),
          content: await readFile(fullPath),
        });
      }
    }),
  );
}

async function readSkillSnapshot(skillDir) {
  const files = [];
  await collectFiles(skillDir, skillDir, files);
  files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );

  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }
  return { files, hash: hash.digest("hex") };
}

function readFrontmatter(skillName, content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    errors.push(`${skillName}/SKILL.md has no YAML frontmatter.`);
    return null;
  }

  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (field) fields[field[1]] = field[2].replace(/^['"]|['"]$/g, "");
  }
  return fields;
}

async function checkMarkdownLinks(
  skillName,
  skillDir,
  markdownPath,
  content,
) {
  const source = `${skillName}/${path
    .relative(skillDir, markdownPath)
    .split(path.sep)
    .join("/")}`;
  const links = content.matchAll(/\[[^\]]*]\(([^)]+)\)/g);

  for (const match of links) {
    let target = match[1].trim().replace(/^<|>$/g, "");
    if (
      !target ||
      target.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/i.test(target) ||
      target.includes("{")
    ) {
      continue;
    }

    target = target.split("#", 1)[0];
    let resolved;
    try {
      resolved = path.resolve(
        path.dirname(markdownPath),
        decodeURIComponent(target),
      );
    } catch {
      errors.push(`${source} has an invalid link: ${target}`);
      continue;
    }

    if (
      resolved !== skillDir &&
      !resolved.startsWith(`${skillDir}${path.sep}`)
    ) {
      errors.push(`${source} link escapes its skill: ${target}`);
      continue;
    }

    try {
      await access(resolved);
    } catch {
      errors.push(`${source} has a missing link: ${target}`);
    }
  }
}

const lock = JSON.parse(await readFile(lockPath, "utf8"));
if (lock.version !== 1 || typeof lock.skills !== "object" || !lock.skills) {
  errors.push("skills-lock.json must use version 1 and contain a skills object.");
}

const directoryEntries = await readdir(skillsRoot, { withFileTypes: true });
const skillNames = directoryEntries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const lockNames = Object.keys(lock.skills ?? {}).sort();

for (const name of skillNames.filter((name) => !lockNames.includes(name))) {
  errors.push(`${name} exists on disk but is missing from skills-lock.json.`);
}
for (const name of lockNames.filter((name) => !skillNames.includes(name))) {
  errors.push(`${name} is locked but missing from .agents/skills.`);
}

for (const skillName of skillNames) {
  const skillDir = path.join(skillsRoot, skillName);
  const skillPath = path.join(skillDir, "SKILL.md");
  let content;
  try {
    content = await readFile(skillPath, "utf8");
  } catch {
    errors.push(`${skillName} has no SKILL.md.`);
    continue;
  }

  const fields = readFrontmatter(skillName, content);
  if (fields?.name !== skillName) {
    errors.push(
      `${skillName}/SKILL.md name is ${fields?.name ?? "missing"}, expected ${skillName}.`,
    );
  }
  if (!fields?.description || fields.description.includes("TODO")) {
    errors.push(`${skillName}/SKILL.md needs a completed description.`);
  }
  if (content.includes("[TODO")) {
    errors.push(`${skillName}/SKILL.md still contains a TODO placeholder.`);
  }

  const snapshot = await readSkillSnapshot(skillDir);
  for (const file of snapshot.files) {
    if (!file.relativePath.endsWith(".md")) continue;
    await checkMarkdownLinks(
      skillName,
      skillDir,
      path.join(skillDir, file.relativePath),
      file.content.toString("utf8"),
    );
  }

  const metadataPath = path.join(skillDir, "agents", "openai.yaml");
  try {
    const metadata = await readFile(metadataPath, "utf8");
    if (
      metadata.includes("default_prompt:") &&
      !metadata.includes(`$${skillName}`)
    ) {
      errors.push(
        `${skillName}/agents/openai.yaml default_prompt must mention $${skillName}.`,
      );
    }
  } catch {
    // Vendor skills may not provide product metadata.
  }

  const entry = lock.skills?.[skillName];
  if (!entry) continue;
  if (
    !entry.source ||
    !entry.sourceType ||
    !entry.skillPath ||
    !entry.computedHash
  ) {
    errors.push(`${skillName} has an incomplete lock entry.`);
  }

  if (entry.sourceType === "github" && !/^[0-9a-f]{40}$/.test(entry.ref ?? "")) {
    errors.push(`${skillName} must pin its GitHub source to a full commit SHA.`);
  }

  if (entry.sourceType === "local") {
    const expectedPath = `.agents/skills/${skillName}/SKILL.md`;
    if (entry.source !== "." || entry.skillPath !== expectedPath || entry.ref) {
      errors.push(`${skillName} has an invalid local lock source.`);
    }
  }

  if (writeMode) {
    entry.computedHash = snapshot.hash;
  } else if (entry.computedHash !== snapshot.hash) {
    errors.push(
      `${skillName} hash differs: expected ${entry.computedHash}, got ${snapshot.hash}.`,
    );
  }
}

const sortedSkills = Object.fromEntries(
  Object.entries(lock.skills ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  ),
);
if (
  JSON.stringify(Object.keys(lock.skills ?? {})) !==
  JSON.stringify(Object.keys(sortedSkills))
) {
  errors.push("skills-lock.json skill keys must be sorted.");
}

if (errors.length > 0) {
  console.error(`Skill integrity failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else if (writeMode) {
  await writeFile(
    lockPath,
    `${JSON.stringify({ version: 1, skills: sortedSkills }, null, 2)}\n`,
  );
  console.log(`Updated hashes for ${skillNames.length} skills.`);
} else {
  console.log(`Verified ${skillNames.length} pinned skills and local references.`);
}
