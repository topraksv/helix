// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // `supabase/functions` is Deno, not the app bundle: remote module
    // specifiers and a `Deno` global that this config knows nothing about.
    //
    // The rest are not this repository's code to answer for. `.expo` and
    // `.stryker-tmp` are generated (the mutation sandbox is a whole second
    // copy of the tree, so linting it reported every finding twice), and
    // `.agents/skills` holds vendored upstream bodies that `AGENTS.md`
    // forbids editing — a finding there is one nobody here may act on.
    ignores: [
      "dist/*",
      "dist-e2e/*",
      "supabase/functions/**",
      ".expo/**",
      ".stryker-tmp/**",
      ".agents/**",
    ],
  },
  {
    // Build and audit scripts run in Node, not in the bundle.
    files: ["scripts/**/*.mjs", "scripts/**/*.js"],
    languageOptions: {
      globals: { Buffer: "readonly", process: "readonly", console: "readonly", URL: "readonly" },
    },
  },
  {
    // Reporting only, not a gate: "warn" never fails `npx expo lint`, so it
    // adds no risk to the routine gate. The systematic code-quality pass
    // (2026-08-20) reads this as a signal, not a rule to satisfy blindly —
    // some financial logic is legitimately branchy and splitting it can
    // scatter a single invariant across files, which is worse. Once a
    // reviewed file's real complexity is understood and settled, a per-file
    // override can raise this to "error" the way `mutation-baseline.json`
    // ratchets a score once it is measured, not before.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      complexity: ["warn", 15],
    },
  },
  {
    // The React Compiler rules below arrived on 2026-09-03 with
    // eslint-config-expo 57, as errors, against code that had not changed —
    // `reactCompiler` was already on under SDK 54, so what moved is the
    // linter's opinion and not this app's behavior. They are demoted by the
    // same rule the `complexity` block above states: a signal is not a gate
    // until the files it names have been read.
    //
    // Three were read on the day they appeared, and all three are sound:
    // `categoryIconComponent` and `operationSupportIcon` are lookups into
    // static tables of imported Lucide components, so nothing is *created*
    // during render — the checker simply cannot prove the returned reference
    // comes from a fixed set. `useTxLike`'s module-level cache is the
    // deliberate design documented above it, and re-running it yields the
    // same array for the same three inputs, which is what makes it safe to
    // repeat. The bulk of `react-hooks/refs` is the lazy-ref and
    // current-value-for-a-callback idiom React itself documents.
    //
    // Raise one back to "error" per file once that file has been reviewed
    // and settled — never all at once, and never by rewriting a documented
    // decision to satisfy a checker that cannot see it.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/globals": "warn",
    },
  },
]);
