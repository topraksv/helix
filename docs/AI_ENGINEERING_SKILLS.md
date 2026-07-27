# Engineering Skills

This file records the source, purpose and boundaries of the engineering skills
installed for Helix. The canonical instructions live in
`.agents/skills/<skill>/SKILL.md`.

The project has 23 installed skills: 16 engineering skills and 7 UI/UX and
accessibility skills.

| Skill | Source repository | Primary purpose | Typical trigger | Usage mode |
|---|---|---|---|---|
| `repo-cleanup` | `NickCrew/Claude-Cortex` | Repository hygiene | Broad or periodic cleanup | Periodic cleanup |
| `improve-codebase-architecture` | `mattpocock/skills` | Architecture assessment | Explicit deep architecture review | Manual/deep audit |
| `code-review-and-quality` | `addyosmani/agent-skills` | Multi-axis code review | Pre-merge review | Review gate |
| `code-simplification` | `addyosmani/agent-skills` | Behaviour-preserving simplification | Focused clarity refactor | Task-specific |
| `performance-optimization` | `addyosmani/agent-skills` | Measured performance work | Proven performance problem | Task-specific |
| `source-driven-development` | `addyosmani/agent-skills` | Version-aware official guidance | Framework-specific implementation | Task-specific |
| `receiving-code-review` | `obra/superpowers` | Review feedback evaluation | Actionable review feedback | Review gate |
| `systematic-debugging` | `obra/superpowers` | Root-cause investigation | Bug, failure or unexpected behaviour | Task-specific |
| `verification-before-completion` | `obra/superpowers` | Evidence before completion claims | Before commit or delivery | Review gate |
| `tdd` | `mattpocock/skills` | Public-behaviour test-first work | Requested red-green development | Task-specific |
| `codebase-design` | `mattpocock/skills` | Module and seam design | Explicit interface design work | Task-specific |
| `vercel-react-best-practices` | `vercel-labs/agent-skills` | React performance guidance | Measured React performance work | Task-specific |
| `vercel-react-native-skills` | `vercel-labs/agent-skills` | React Native and Expo guidance | Native performance or platform work | Task-specific |
| `expo-data-fetching` | `expo/skills` | Expo networking guidance | Expo request or caching work | Task-specific |
| `playwright-best-practices` | `currents-dev/playwright-best-practices-skill` | Playwright test guidance | E2E test work | Task-specific |
| `supabase-postgres-best-practices` | `supabase/agent-skills` | Postgres and RLS guidance | Database query or schema work | Task-specific |

## UI/UX and accessibility

| Skill | Source and resolved commit | Primary purpose | Typical trigger | Usage mode | Helix boundary | Vendor patch |
|---|---|---|---|---|---|---|
| `frontend-design` | `anthropics/skills` at `b29e7cf65e5cb78a5ac33d582270551bc74a14eb` | Intentional visual direction | New screen or meaningful visual redesign | Task-specific | Starts from Helix's existing identity; cannot invent a replacement aesthetic | Unchanged |
| `frontend-ui-engineering` | `addyosmani/agent-skills` at `7829ffd90d973b6325f5f12f1b1226dcace74443` | Responsive, state-aware production UI | Implementing a chosen UI direction | Task-specific | Its example folder structure cannot override Helix's structure | Unchanged |
| `web-design-guidelines` | `vercel-labs/agent-skills` at `7c180d9044c9ae2b442b567aad4e42a28dd5ed62` | Web UI/UX review | Explicit broad web review | Manual/deep audit | Findings remain subordinate to Helix's tested UX and repository rules | Locally hardened to use a pinned reference |
| `expo-native-ui` | `expo/skills` at `09eb052410e7f609624cb161ea4cd9576c69cd5d` | Native-feeling Expo UI and interaction | Expo screen or platform interaction work | Task-specific | Limited to the current Expo SDK and installed packages; cannot add packages on its own | Unchanged |
| `expo-router` | `expo/skills` at `09eb052410e7f609624cb161ea4cd9576c69cd5d` | Navigation and back behaviour | Navigation or route behaviour change | Task-specific | Cannot restructure routes or alter behaviour without auditing all existing conventions | Unchanged |
| `prototype` | `mattpocock/skills` at `ed37663cc5fbef691ddfecd080dff42f7e7e350d` | Temporary design or state options | Explicit design question | Manual/throwaway | Never promoted directly to production; all unused prototype code is removed | Unchanged |
| `mobile-accessibility` | `Community-Access/accessibility-agents` at `0872b4a7763145fc0e5847d8357fb446a857c683` | React Native/Expo accessibility audit | Explicit deep mobile accessibility review | Manual/deep audit | Mobile only; cannot install or delegate to missing accessibility agents | Unchanged |

`web-design-guidelines` reads
`references/web-interface-guidelines.md`, pinned from
`vercel-labs/web-interface-guidelines` commit
`4e799d45c17aec1498c269287a83b9dba22b966b`. Its SHA-256 is
`eea73cb6dd46fee9faec9973e8e7fe198b5f07ec326f14d276a56e50287e1cab`.
The local patch removes the mutable runtime `main` fetch without changing the
rules or output format; revalidate and reapply it after any vendor update.

- Use `frontend-design` for a new screen or meaningful redesign, not every
  small UI bug.
- Use `frontend-ui-engineering` to implement the selected design responsively,
  with complete UI states and production quality.
- `web-design-guidelines` uses the pinned local reference; it never reads
  upstream `main` at runtime.
- Limit `expo-native-ui` to Helix's current Expo SDK and installed packages.
- Use `expo-router` when navigation or route behaviour changes.
- `prototype` creates disposable options for a decision; delete every
  unselected or unused prototype.
- `mobile-accessibility` applies only to React Native/Expo mobile surfaces, and
  automated review does not replace real assistive-technology testing.
- Do not update skills automatically. Review source diffs, new scripts and
  instruction changes in a separate PR.
- Build a comprehensive shared workflow only after both UI/UX and cybersecurity
  skill sets are complete.

Vendor audit notes:

- All canonical names and descriptions are present. Vendor frontmatter supplies
  both version and license only for the Expo skills; `frontend-design` supplies
  a license, `web-design-guidelines` a version, and the other vendors omit
  those optional fields.
- No new skill contains scripts, assets or executables, automatic hook/agent
  installation, credential access or automatic repository-external writes.
  Expo references contain manual package/build/feedback commands, the
  accessibility guide contains a manual `adb` setting command, and prototype
  guidance can create temporary code; none runs automatically.
- `frontend-ui-engineering` names a missing optional
  `references/accessibility-checklist.md`. `mobile-accessibility` also names
  uninstalled handoff agents. Do not follow either reference; only the isolated
  `mobile-accessibility` skill was installed.
- Vendor package, folder, copy and interaction preferences are advisory.
  Conflicts—including the pinned web rules' truncation/copy preferences—resolve
  in favour of `AGENTS.md`, tested Helix behaviour and official version-matched
  documentation.

- Use only the skills needed at the same time.
- Reducing line count is not quality by itself.
- Performance changes require measurement.
- Verify framework advice against the project's actual version and official
  documentation.
- Tests must preserve public behaviour, not merely produce a green result.
- Do not update vendor skills automatically; updates require normal code review
  and a PR.
- Do not apply Next.js-specific React rules unless Helix adopts Next.js.
- React Native, Expo and Supabase skills cannot redesign the existing
  architecture merely to match their own preferences.
- Cybersecurity skills will be added to this inventory later.
