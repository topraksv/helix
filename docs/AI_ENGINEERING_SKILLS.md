# Engineering Skills

This file records the source, purpose and boundaries of the engineering skills
installed for Helix. The canonical instructions live in
`.agents/skills/<skill>/SKILL.md`.

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
- UI/UX and security skills will be added to this inventory later.
