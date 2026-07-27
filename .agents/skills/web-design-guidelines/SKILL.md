---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Read the pinned guidelines from the local reference below
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in the pinned guidelines
4. Output findings in the terse `file:line` format

## Guidelines Source

Read the project-local reference pinned from
`vercel-labs/web-interface-guidelines` commit
`4e799d45c17aec1498c269287a83b9dba22b966b`:

```
references/web-interface-guidelines.md
```

Do not fetch instructions from a mutable upstream branch at runtime. The pinned
reference contains all the rules and output format instructions.

## Usage

When a user provides a file or pattern argument:
1. Read the pinned local guidelines above
2. Read the specified files
3. Apply all rules from the pinned guidelines
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.
