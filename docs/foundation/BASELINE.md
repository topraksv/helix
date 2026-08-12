```text
$ /usr/bin/time -p npx vitest run

 RUN  v4.1.10 /Users/topraksavli/helix

 Test Files  110 passed (110)
      Tests  970 passed (970)
   Start at  18:50:24
   Duration  5.23s (transform 2.11s, setup 0ms, import 8.47s, tests 8.70s, environment 7ms)

real 5.57
user 29.23
sys 3.56
```

```text
$ /usr/bin/time -p npx tsc --noEmit
real 4.40
user 8.75
sys 0.42
```

```text
$ /usr/bin/time -p npm run test:coverage

> helix@1.0.0 test:coverage
> vitest run --config vitest.coverage.config.ts


 RUN  v4.1.10 /Users/topraksavli/helix
      Coverage enabled with v8

 Test Files  110 passed (110)
      Tests  970 passed (970)
   Start at  18:50:42
   Duration  6.17s (transform 2.03s, setup 0ms, import 8.61s, tests 10.45s, environment 8ms)

 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |   97.88 |    95.29 |     100 |   99.71 |
 balance.ts        |   97.34 |    91.04 |     100 |     100 | ...52,178,299,338
 ...-statements.ts |   93.75 |    94.44 |     100 |     100 | 45
 money.ts          |   98.05 |    93.68 |     100 |   98.85 | 112
 recurrence.ts     |   95.12 |    90.62 |     100 |     100 | 64,104,113
 ...ction-draft.ts |   95.45 |    96.96 |     100 |     100 | 83
-------------------|---------|----------|---------|---------|-------------------

=============================== Coverage summary ===============================
Statements   : 97.88% ( 417/426 )
Branches     : 95.29% ( 344/361 )
Functions    : 100% ( 67/67 )
Lines        : 99.71% ( 355/356 )
================================================================================
real 6.51
user 32.99
sys 3.66
```

```text
$ node --input-type=module -e 'const c=(await import("./vitest.coverage.config.ts")).default; console.log(JSON.stringify({include:c.test.coverage.include,thresholds:c.test.coverage.thresholds},null,2))'
{
  "include": [
    "src/domain/money.ts",
    "src/domain/balance.ts",
    "src/domain/card-statements.ts",
    "src/domain/recurrence.ts",
    "src/domain/transaction-draft.ts",
    "src/domain/investments.ts"
  ],
  "thresholds": {
    "perFile": true,
    "branches": 90,
    "functions": 100,
    "lines": 95,
    "statements": 90
  }
}
```

```text
$ node --input-type=module -e 'const c=(await import("./stryker.config.mjs")).default; console.log(JSON.stringify({mutate:c.mutate,vitestTests:(await import("./vitest.mutation.config.ts")).default.test.include,thresholds:c.thresholds},null,2))'
{
  "mutate": [
    "src/domain/investments.ts",
    "src/data/repo/investment-validation.ts",
    "src/auth/recovery.ts"
  ],
  "vitestTests": [
    "tests/auth.test.ts",
    "tests/investment-domain.test.ts",
    "tests/investment-validation.test.ts",
    "tests/repository-model.test.ts"
  ],
  "thresholds": {
    "high": 99,
    "low": 98,
    "break": 98
  }
}
```

```text
$ /usr/bin/time -p npx expo export -p web --clear
env: load .env
env: export EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY

Using (experimental) base path: /helix
Using src/app as the root directory for Expo Router.
React Compiler enabled
Starting Metro Bundler
warning: Bundler cache is empty, rebuilding (this may take a minute)
Static rendering is enabled. Learn more: https://docs.expo.dev/router/reference/static-rendering/
| (node:83512) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
| (Use `node --trace-warnings ...` to show where the warning was created)
| (node:83511) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
| (Use `node --trace-warnings ...` to show where the warning was created)
| (node:83515) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
| (Use `node --trace-warnings ...` to show where the warning was created)
| (node:83513) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
| (Use `node --trace-warnings ...` to show where the warning was created)
| (node:83514) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
| (Use `node --trace-warnings ...` to show where the warning was created)
| (node:83516) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
| (Use `node --trace-warnings ...` to show where the warning was created)
| (node:83517) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
| (Use `node --trace-warnings ...` to show where the warning was created)
Web node_modules/expo-router/entry.js ▓▓▓▓░░░░░░░░░░░░ 25.0% ( 8/16)
λ node_modules/expo-router/node/render.js ▓▓▓░░░░░░░░░░░░░ 23.4% (206/521)
Web node_modules/expo-router/entry.js ▓▓▓▓░░░░░░░░░░░░ 25.0% (188/477)
λ node_modules/expo-router/node/render.js ▓▓▓▓▓▓▓▓▓░░░░░░░ 59.6% (653/846)
Web node_modules/expo-router/entry.js ▓▓▓▓▓▓▓░░░░░░░░░ 44.7% (495/740)
λ node_modules/expo-router/node/render.js ▓▓▓▓▓▓▓▓▓▓▓░░░░░ 73.6% ( 886/1033)
Web node_modules/expo-router/entry.js ▓▓▓▓▓▓▓▓▓▓▓░░░░░ 68.9% ( 878/1063)
λ node_modules/expo-router/node/render.js ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░ 92.2% (1297/1351)
λ Bundled 14719ms node_modules/expo-router/node/render.js (1495 modules)
[expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect.
Web node_modules/expo-router/entry.js ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░ 94.7% (1441/1518)
Web Bundled 19609ms node_modules/expo-router/entry.js (1541 modules)

› web bundles (3):
_expo/static/js/web/entry-2e966d2b247195422eab6407cd2dba11.js (3.38 MB)
_expo/static/js/web/worker-c4cbc88f58707e2fd922b98b9b485cdf.js (132 kB)
_expo/static/js/web/xlsx-ac68e69a3ceff3ab062b053e840c720d.js (493 kB)

› Static routes (66):
/setup (20.6 kB)
/ (index) (20.6 kB)
/budgets (20.6 kB)
/incomes (20.6 kB)
/sign-in (20.6 kB)
/upcoming (20.6 kB)
/_sitemap (20.4 kB)
/analytics (20.6 kB)
/bulk-entry (20.6 kB)
/+not-found (20.4 kB)
/cell-editor (20.6 kB)
/transaction (20.6 kB)
/(tabs) (20.6 kB)
/import-wizard (20.6 kB)
/subscriptions (20.6 kB)
/columns-editor (20.6 kB)
/reconciliation (20.6 kB)
/reset-password (20.6 kB)
/(auth)/sign-in (20.6 kB)
/cash-flow/item (20.6 kB)
/settings (20.6 kB)
/settings/tools (20.6 kB)
/installment-new (20.6 kB)
/opening-balance (20.6 kB)
/payment-sources (20.6 kB)
/cash-flow (20.6 kB)
/account-security (20.6 kB)
/settings/budgets (20.6 kB)
/settings/incomes (20.6 kB)
/settings/persons (20.6 kB)
/subscription-form (20.6 kB)
/cash-flow/[month] (20.6 kB)
/investments (20.6 kB)
/investments/setup (20.6 kB)
/workspace-template (20.6 kB)
/(onboarding)/setup (20.6 kB)
/cash-flow/analytics (20.6 kB)
/investments/product (20.6 kB)
/settings/categories (20.6 kB)
/(tabs)/subscriptions (20.6 kB)
/(auth)/reset-password (20.6 kB)
/(tabs)/cash-flow/item (20.6 kB)
/investments/operation (20.6 kB)
/(tabs)/settings (20.6 kB)
/(tabs)/settings/tools (20.6 kB)
/(tabs)/cash-flow (20.6 kB)
/cash-flow/installments (20.6 kB)
/investments/correction (20.6 kB)
/(tabs)/settings/budgets (20.6 kB)
/(tabs)/settings/incomes (20.6 kB)
/(tabs)/settings/persons (20.6 kB)
/(tabs)/cash-flow/[month] (20.6 kB)
/(tabs)/investments (20.6 kB)
/(tabs)/investments/setup (20.6 kB)
/settings/opening-balance (20.6 kB)
/settings/payment-sources (20.6 kB)
/settings/computed-columns (20.6 kB)
/(tabs)/cash-flow/analytics (20.6 kB)
/(tabs)/investments/product (20.6 kB)
/(tabs)/settings/categories (20.6 kB)
/(tabs)/investments/operation (20.6 kB)
/(tabs)/cash-flow/installments (20.6 kB)
/(tabs)/investments/correction (20.6 kB)
/(tabs)/settings/opening-balance (20.6 kB)
/(tabs)/settings/payment-sources (20.6 kB)
/(tabs)/settings/computed-columns (20.6 kB)

Exported: dist
real 25.62
user 140.37
sys 6.34
```

```text
$ /usr/bin/time -p npm run bundle:check

> helix@1.0.0 bundle:check
> node scripts/check-web-budget.mjs dist --require-supabase-config

entryJavaScript: 3380216 bytes (budget 3398000 bytes)
totalJavaScript: 4009981 bytes (budget 4034000 bytes)
totalExport: 7376506 bytes (budget 7500000 bytes)
fontFiles: 5 (budget 6)
fontBytes: 791272 bytes (budget 800000 bytes)
sourceMapFiles: 0 (budget 0)
sourceMapReferences: 0 (budget 0)
supabaseOriginTrusted: true (expected true)
supabaseConfigInlined: true (expected true)
Web export is within its release budget.
real 0.17
user 0.13
sys 0.02
```
