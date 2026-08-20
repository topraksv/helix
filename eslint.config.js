// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "dist-e2e/*"],
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
]);
