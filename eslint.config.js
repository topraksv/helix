// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Deno's, with remote imports the app's toolchain cannot resolve.
    ignores: ["dist/*", "dist-e2e/*", "test-results/*", "reports/*", "coverage/*", ".expo/**", ".stryker-tmp/**", "supabase/functions/**"],
  },
  {
    files: ["scripts/**/*.mjs", "scripts/**/*.js", ".claude/**/*.mjs"],
    languageOptions: {
      globals: { Buffer: "readonly", process: "readonly", console: "readonly", URL: "readonly" },
    },
  },
  {
    // A signal, not a gate: "warn" never fails `expo lint`, and the ratchet in
    // `scripts/check-lint-ratchet.mjs` is what stops the count growing. Raise a
    // file to "error" once its real complexity has been read and settled.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      complexity: ["warn", 15],
    },
  },
  {
    // Rules eslint-config-expo 57 made errors are demoted to signals; raise one
    // per file once that file has been reviewed.
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
