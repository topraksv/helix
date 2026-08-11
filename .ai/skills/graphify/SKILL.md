---
name: graphify
description: Navigates the Helix codebase with a fresh, source-verifiable Graphify map. Use when a codebase architecture, file relationship, or call-flow question benefits from graphify-out navigation.
---

# Graphify navigation

## Read-only procedure

1. If `graphify-out/graph.json` exists, run
   `node .ai/scripts/check-graphify-freshness.mjs --required` first.
2. Use the narrowest read-only command: `graphify query`, `graphify path`, or
   `graphify explain`. Prefer `graphify-out/wiki/index.md` when it exists for
   broad navigation.
3. Open the cited source files and call sites. Treat graph edges as extracted
   or inferred navigation, never proof of ownership, correctness, dead code,
   security, or reachability.
4. Report truncation, missing/stale output and unresolved directionality. Do
   not save generated memory unless the answer and cited nodes were checked.

## Mutating procedure

`graphify update .` is a separate, visible step after source edits. It may
rewrite ignored generated output and is allowed only when the user task or the
Helix completion workflow requires a refresh. Never rebuild merely to answer a
question, and never run update from a read-only query path.

## Acceptance

The answer cites a fresh graph command and verified source/test evidence, or
clearly says that Graphify was unavailable/stale and falls back to direct source
inspection.
