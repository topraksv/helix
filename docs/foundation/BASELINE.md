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
real 0.20
user 0.14
sys 0.03
```
