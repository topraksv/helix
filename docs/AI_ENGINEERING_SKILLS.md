# Helix Engineering Skill Tree

This is the canonical routing, provenance and update policy for project skills.
Stable product rules remain in the documents linked from `AGENTS.md`; skills
provide task workflows and must link to those rules instead of copying them.

The inventory has 26 skills: 19 pinned specialist skills from established
sources and 7 small Helix adapters. A task loads one relevant path, never the
whole tree.

## Routing tree

```text
Task
├─ bug or unexpected behavior
│  └─ systematic-debugging
├─ framework/API decision
│  └─ source-driven-development
├─ security boundary
│  └─ security-and-hardening
│     ├─ dependency-security
│     ├─ supabase-postgres-best-practices
│     └─ financial-data-integrity
├─ ledger, sync, import, backup, recovery
│  └─ financial-data-integrity
│     ├─ property-based-testing
│     ├─ supabase-postgres-best-practices
│     └─ security-and-hardening
├─ UI or product experience
│  └─ visual-system
│     ├─ frontend-design (meaningful new direction only)
│     ├─ expo-native-ui
│     ├─ expo-router
│     ├─ native-interaction
│     ├─ mobile-accessibility
│     ├─ web-design-guidelines (explicit web audit only)
│     ├─ playwright-best-practices
│     └─ prototype (explicit throwaway question only)
├─ performance claim
│  └─ performance-optimization
├─ module boundary or interface design
│  └─ codebase-design
├─ data fetching
│  └─ expo-data-fetching
└─ release or platform-specific proof
   └─ platform-release-acceptance
      ├─ expo-router / expo-native-ui
      ├─ native-interaction / mobile-accessibility
      └─ playwright-best-practices

Implementation loop
├─ tdd when requested or required by the task
├─ property-based-testing for high-dimensional transformations
├─ receiving-code-review when addressing review feedback
├─ code-simplification for an explicit behavior-preserving clarity pass
├─ code-review-and-quality before merge
├─ verification-before-completion before a completion claim
└─ repo-cleanup on the task delta
```

The same skill can appear on two paths because it is a leaf used by distinct
orchestrators. That is routing, not duplicate ownership. For example,
`security-and-hardening` owns threat-boundary reasoning while
`supabase-postgres-best-practices` owns PostgreSQL/RLS implementation detail.

## Helix adapters

| Skill | Owns | Routes to |
|---|---|---|
| `security-and-hardening` | Threat modeling, exploitability, vulnerability verification, variant search, secure patch evidence | dependency, Supabase, financial, debugging and verification leaves |
| `dependency-security` | npm/Expo graph, advisories, overrides, Actions, vendored skills, provenance and residual risk | source-driven development and verification |
| `financial-data-integrity` | Money, ledger, sync, import/export, backup, recovery and atomicity | property testing, Supabase and security |
| `platform-release-acceptance` | Web/native/database/release evidence and delivery-boundary classification | Expo, interaction, accessibility and browser leaves |
| `visual-system` | Helix visual language, semantic color, density, responsive states and Turkish copy | design, Expo UI, accessibility and visual tests |
| `native-interaction` | Current-stack motion, gestures, drag/reorder, press feedback and haptics | platform acceptance and performance |
| `mobile-accessibility` | React Native semantics, focus, Dynamic Type, gesture alternatives and assistive-technology acceptance | visual system and platform acceptance |

These are intentionally small. They translate mature external methods into
Helix's repository contracts without vendoring an unrelated framework.

## Pinned external specialists

Every GitHub source below is locked to a full commit SHA in
`skills-lock.json`; `computedHash` pins the exact local snapshot after the
documented Helix patches.

| Source | Installed specialists |
|---|---|
| `anthropics/skills` | `frontend-design` |
| `trailofbits/skills` | `property-based-testing` |
| `expo/skills` | `expo-data-fetching`, `expo-native-ui`, `expo-router` |
| `supabase/agent-skills` | `supabase-postgres-best-practices` |
| `obra/superpowers` | `systematic-debugging`, `receiving-code-review`, `verification-before-completion` |
| `mattpocock/skills` | `tdd`, `codebase-design`, `prototype` |
| `addyosmani/agent-skills` | `code-review-and-quality`, `code-simplification`, `performance-optimization`, `source-driven-development` |
| `currents-dev/playwright-best-practices-skill` | `playwright-best-practices` |
| `NickCrew/Claude-Cortex` | `repo-cleanup` |
| `vercel-labs/agent-skills` | `web-design-guidelines` only |

Popularity is a discovery signal, not a trust decision. Selection also required
stack fit, readable instructions, bounded scope, no hidden runtime dependency,
and a useful role not already owned by another skill.

## Security research decision

Anthropic's
[`defending-code-reference-harness`](https://github.com/anthropics/defending-code-reference-harness)
was reviewed at commit `6de8141b971d917a461bce4193c8b535a6b6cfc1`.
Its strongest ideas are now in `security-and-hardening`: map the attack surface
before scanning, separate noisy discovery from skeptical verification, rank by
preconditions and impact, search variants, write a regression before patching,
and re-check with evidence independent of the original finding.

The harness itself is not installed because its repository states that it is
not maintained, its autonomous runner is primarily configured for C/C++ memory
vulnerabilities, and its isolation model requires Docker/gVisor and restricted
egress. Prompt instructions alone are not a sandbox. Installing the runner in
an Expo/TypeScript repository would add attack surface without improving the
actual product gate.

Anthropic's
[`claude-code-security-review`](https://github.com/anthropics/claude-code-security-review)
was also reviewed but not installed as a GitHub Action: its own documentation
warns that it is not hardened against prompt injection, and it would add an API
secret and advisory false-positive surface. Helix already has pinned CodeQL,
dependency review, Dependabot and a repository-specific security matrix.

Security guidance is grounded in
[OWASP MASVS](https://mas.owasp.org/MASVS/),
[OWASP MASTG](https://mas.owasp.org/MASTG/), Expo's version-matched
documentation, Supabase's RLS guidance, and the controls in
`docs/SECURITY.md`. Automated findings remain hypotheses until their reachable
path is proven.

## Deliberately removed

| Removed skill | Reason |
|---|---|
| `vercel-react-best-practices` | Next.js, RSC and server guidance for a static Expo Router app |
| `vercel-react-native-skills` | Overlapped Expo/native guidance and recommended uninstalled libraries and patterns |
| `react-native-best-practices` | Broad bundle included Reanimated, Gesture Handler, Skia, WebGPU, JSI, audio, rich text and on-device AI that Helix does not use |
| `color-expert` | A 2.3 MB color-history/research archive for a token-and-contrast workflow already defined by Helix |
| `frontend-ui-engineering` | Tailwind/HTML/web implementation guidance plus a missing local reference; not Helix's RN-first implementation layer |
| `improve-codebase-architecture` | Referenced missing skills and context files and required report/delegation machinery absent from this repository |
| previous `mobile-accessibility` package | Overbroad trigger and missing handoff agents; replaced by the bounded Helix adapter |

The retained `web-design-guidelines` has a real consumer: Helix ships a static
web app and has Playwright browser/visual acceptance. It remains an explicit
audit leaf, not a default implementation skill.

## Local vendor patches

- `repo-cleanup`: repaired its broken internal references and removed a link to
  an absent vendor testing guide.
- `code-review-and-quality`: replaced two missing checklist links with the
  installed security and performance skills.
- `performance-optimization`: removed a missing checklist link and points to
  Helix's measured budgets.
- `source-driven-development`: citations belong in delivery notes or canonical
  documentation; routine source URLs are not added as code comments.
- `property-based-testing`: pinned Trail of Bits snapshot, repaired portable
  relative links, and narrowed the trigger text from smart contracts to Helix
  transformations.
- `playwright-best-practices`: repaired seven broken cross-directory reference
  links discovered by the integrity gate.
- `web-design-guidelines`: retains the existing pinned local rules instead of a
  mutable runtime fetch.

Reapply or retire these patches deliberately during an upstream update; never
overwrite them with a blind `skills update`.

## Integrity and update policy

`npm run verify:skills` checks:

- lock inventory equals the physical skill directories;
- every `SKILL.md` has matching name and completed description;
- local Markdown references resolve inside the skill;
- GitHub sources use full commit SHAs and local adapters use exact local paths;
- every directory hash matches `skills-lock.json`;
- no skill is a symlink.

The command is part of `npm run verify` and the required CI `quality` job.

To update or add a skill:

1. Review the upstream diff, resolved commit, `SKILL.md`, scripts, executables,
   hooks, assets, tools, credential access and external-write instructions.
2. Confirm the role is absent from this tree and fits the current stack.
3. Install only the required skill at an immutable commit.
4. Apply the smallest Helix compatibility patch and record it here.
5. Update the lock entry, then run
   `node scripts/check-skills.mjs --write`.
6. Run `npm run verify:skills`, `npm run verify`, and the task-specific gate.
7. Review the complete diff. Skill updates receive the same PR scrutiny as
   executable dependencies.

Do not auto-update skills, install them globally for this project, or add a
security scanner that needs secrets or external writes without a separate
owner decision.
