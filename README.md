<div align="center">

# Helix

**Local-first personal finance — monthly cash flow, installment tracking, and subscription management in one place.**

*Your spreadsheet, grown up: works fully offline, syncs when you're back online, and never makes you wait for the network.*

[![Expo SDK 54](https://img.shields.io/badge/Expo-SDK%2054-000020?logo=expo&logoColor=white)](https://docs.expo.dev/versions/v54.0.0/)
[![React Native](https://img.shields.io/badge/React%20Native-0.81-61DAFB?logo=react&logoColor=white)](https://reactnative.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-sync%20%2B%20auth-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![Tests](https://img.shields.io/badge/tests-64%20passing-brightgreen)](tests/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**iOS + Web from a single codebase** · [Live web app](https://topraksv.github.io/helix/)

</div>

---

## What it does

Helix replaces the monthly income/expense spreadsheet with an app that actually understands your money:

- 📊 **Monthly cash flow** — chained month-over-month balances, category matrix on wide screens, and year-to-date analytics that reconcile to the kuruş.
- 💳 **Installment engine** — enter "6 installments, 2 already paid" once; Helix spreads the amounts across the right months, tracks `2/6` progress, and totals your obligation for the current month.
- 🔁 **Subscriptions & recurring rules** — salaries, rent, streaming services; month-end-aware recurrence (a rule on the 31st lands on Feb 28), expected vs. confirmed amounts.
- 👀 **Watch-only tracking** — follow someone else's installments (they show up and notify, but never touch your balance).
- 📅 **Future-dated & catch-up flows** — tomorrow's expense doesn't hit today's balance; skip a few days and a reconciliation screen walks you through what came due.
- 🔔 **Upcoming-payment notifications** with a configurable lead time (iOS).

## How it's built

**Local-first, sync-second.** The UI never waits on the network — everything works in airplane mode.

| Layer | Choice |
|---|---|
| App | [Expo SDK 54](https://docs.expo.dev/versions/v54.0.0/) + expo-router, React Native 0.81, React 19, TypeScript strict |
| Local store | `expo-sqlite` **async** API + Drizzle (via the `sqlite-proxy` driver) — the single source of truth on device, non-blocking on every platform |
| Sync | Supabase (Postgres + Auth) via an outbox pattern: push → pull → last-write-wins merge, tombstone deletes (no hard deletes) |
| Security | Row Level Security on every table (`auth.uid() = user_id`), Face ID app lock on iOS, parameterized SQL, secrets only in `.env` / CI |
| Money | All amounts stored as integer kuruş — no floats, ever. FX rates: TCMB `today.xml` → Frankfurter fallback → cache. Live gold/FX from Harem Altın's socket feed |
| Tables | A cross-platform sticky-column matrix ([src/ui/sticky-table.tsx](src/ui/sticky-table.tsx)) — pinned first column + optional pinned extra column, months-as-rows/columns pivot, on web and iOS alike |
| Domain logic | Pure TypeScript engines in [src/domain/](src/domain/) — balance chaining (incl. prior-year back-anchoring), installments, recurrence, expected payments, YTD analytics — covered by 64 unit tests including a golden balance chain validated against the original spreadsheet |

## Getting started

> **Node 22 required.** Expo SDK 54's build tooling is incompatible with
> Node 24+ native TypeScript stripping. Use Node 22 (LTS).

```bash
git clone https://github.com/topraksv/helix.git
cd helix
npm install
cp .env.example .env    # add Supabase URL + anon key (leave empty for local-only mode)

npm run web             # web
npm run ios             # iOS dev build (npx expo run:ios --device for a real phone)

npm test                # 64 domain unit tests
npm run typecheck
```

> **No Supabase project?** Leave `.env` empty — Helix runs fully local with no account or network.

### Supabase setup (one-time, for sync)

1. Create a free project at [supabase.com](https://supabase.com).
2. Run [supabase/migrations/00000000000001_init.sql](supabase/migrations/00000000000001_init.sql) in the SQL Editor.
3. Copy the project URL and publishable (anon) key from **Settings → API** into `.env`:
   `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
4. Add two repo secrets under **Settings → Secrets and variables → Actions**: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the `sb_secret_…` key — it powers the keep-alive cron and must **never** appear in `.env` or client code).
5. Trigger the `supabase-keepalive` workflow once from the Actions tab to verify. It pings the database every 3 days so the free-tier project never pauses.

### Web deployment

Every push to `main` runs [deploy-web.yml](.github/workflows/deploy-web.yml): `npx expo export -p web` builds a static site (per-route HTML, `baseUrl: /helix`) and publishes it to GitHub Pages. Deep links to dynamic routes are handled by a `404.html` fallback that hands the URL back to the client-side router.

## Project structure

```
src/
├── app/        # expo-router routes (tabs: dashboard, cash flow, subscriptions, settings)
├── domain/     # pure TS money engines — no I/O, fully unit-tested
├── db/         # Drizzle schema + expo-sqlite setup
├── sync/       # outbox, push/pull, LWW merge
├── services/   # FX rates, notifications, backup (JSON export/import)
├── auth/       # Supabase auth + Face ID lock
└── ui/         # shared components, theming (light/dark)
```

Manual test scenarios for the critical flows live in [docs/TESTING.md](docs/TESTING.md).

## Known limitations (Phase 1)

- No scheduled notifications on web (platform limitation) — in-app indicators instead.
- FX conversion is snapshotted at entry time; TCMB publishes no weekend rates, so the last known rate is used with a ⚠ badge.
- Installments post to calendar months; card statement periods (cut-off dates) are Phase 2 (schema field already in place).
- CSV import/reconciliation, budget alerts, calendar view, and widgets → Phase 2.

## License

[MIT](LICENSE)
