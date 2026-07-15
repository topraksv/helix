<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/horizontal-dark.png">
  <img src="assets/brand/horizontal-light.png" alt="Helix" width="540">
</picture>

<h3>Local-first personal finance for people who outgrew the spreadsheet.</h3>

Monthly cash flow, installment tracking, and subscriptions in one app that
works fully offline, syncs when you're back online, and never makes you wait
for the network.

[![Open the live web app](https://img.shields.io/badge/▶_Open_the_live_web_app-C9623F?style=for-the-badge&logo=expo&logoColor=white)](https://topraksv.github.io/helix/)

[![Expo SDK 54](https://img.shields.io/badge/Expo-SDK%2054-181817?logo=expo&logoColor=white)](https://docs.expo.dev/versions/v54.0.0/)
[![React Native 0.81](https://img.shields.io/badge/React%20Native-0.81-181817?logo=react&logoColor=61DAFB)](https://reactnative.dev)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-181817?logo=typescript&logoColor=3178C6)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-sync%20%2B%20auth-181817?logo=supabase&logoColor=3FCF8E)](https://supabase.com)
[![64 tests passing](https://img.shields.io/badge/tests-64%20passing-7D8370)](tests/)
[![Proprietary](https://img.shields.io/badge/license-proprietary-C5A07F)](#license)

*iOS + Web from a single codebase.*

</div>

---

## Why Helix

You already track your money in a spreadsheet. It works — until a column
formula breaks, a future-dated expense throws off today's balance, or you
lose track of which installment you're on. Helix keeps the mental model of a
spreadsheet (months, running balances, a category grid) but makes the numbers
**correct by construction** and the app **usable from your phone**.

- **Offline-first.** Every screen reads from the on-device database. Airplane
  mode changes nothing; sync happens quietly in the background when there's a
  connection.
- **Correct to the kuruş.** All money is stored as integer minor units — no
  floating-point drift, ever. Balances chain month over month and reconcile
  against a golden dataset in the test suite.
- **Yours alone.** Row-level security on every table, Face ID lock on iOS, and
  a fully local mode that needs no account at all.

## What it does

- 📊 **Monthly cash flow** — chained month-over-month balances with a
  category matrix on wide screens. Pivot months between rows and columns, pin
  the columns that matter, and drill into any month (past or future) for its
  detail.
- 💳 **Installment engine** — enter "6 installments, 2 already paid" once;
  Helix spreads the amounts across the right months, tracks `2/6` progress,
  and totals what you owe this month. Card purchases are assigned to a stored
  statement period and affect cash on the real statement due date; prior
  statements remain available in payment-source settings.
- 🔁 **Subscriptions & recurring rules** — salaries, rent, streaming; recurrence
  that respects month-ends (a rule on the 31st lands on Feb 28), with expected
  vs. confirmed amounts and free-trial handling.
- 👀 **Watch-only tracking** — follow someone else's installments; they show up
  and notify, but never touch your balance.
- 📅 **Future-dated & catch-up flows** — tomorrow's expense doesn't hit today's
  balance; skip a few days and a reconciliation screen walks you through what
  came due.
- 📥 **Import & bulk entry** — pull history in from Excel/CSV with a guided
  wizard, or enter a whole month in one pass.
- 🧮 **Built-in calculator & computed columns** — do the math where you need it,
  and define spreadsheet-style derived columns without leaving the app.
- 🪙 **Live gold & FX** — real-time gold and currency rates from the Harem Altın
  feed, with TCMB as the reference source for conversions.
- 🔔 **Upcoming-payment notifications** with a configurable lead time (iOS).

## How it's built

**Local-first, sync-second.** The UI never waits on the network — everything
works in airplane mode, and the database on the device is the single source of
truth.

| Layer | Choice |
|---|---|
| **App** | [Expo SDK 54](https://docs.expo.dev/versions/v54.0.0/) + expo-router, React Native 0.81, React 19, TypeScript strict |
| **Local store** | `expo-sqlite` **async** API + Drizzle (via the `sqlite-proxy` driver) — non-blocking on every platform, the on-device source of truth |
| **Sync** | Supabase (Postgres + Auth) via an outbox: push → pull → last-write-wins merge, with tombstone deletes (no hard deletes) |
| **Security** | Row-Level Security on every table (`auth.uid() = user_id`), Face ID app lock on iOS, parameterized SQL, secrets only in `.env` / CI |
| **Money** | Integer kuruş everywhere — no floats. FX: TCMB `today.xml` → Frankfurter fallback → cache; live gold/FX from the Harem Altın socket feed |
| **Tables** | One cross-platform sticky-column matrix ([src/ui/sticky-table.tsx](src/ui/sticky-table.tsx)) — pinned first column + an optional pinned extra column, months-as-rows/columns pivot, identical on web and iOS |
| **Domain logic** | Pure TypeScript engines in [src/domain/](src/domain/) — balance chaining (incl. prior-year back-anchoring), installments, recurrence, expected payments, YTD analytics — covered by 64 unit tests, including a golden chain validated against the original spreadsheet |

## The look

Helix isn't styled like a fintech dashboard. Its design language is **Warm
Organic Editorial** — a linen-and-ink palette, serif headlines, and a botanical
double-helix mark, so your money feels less like a spreadsheet and more like a
well-set page.

![Linen](https://img.shields.io/badge/linen-F3EFE0?style=flat-square&labelColor=F3EFE0)
![Obsidian](https://img.shields.io/badge/obsidian-181817?style=flat-square&labelColor=181817)
![Terracotta](https://img.shields.io/badge/terracotta-C9623F?style=flat-square&labelColor=C9623F)
![Sage](https://img.shields.io/badge/sage-7D8370?style=flat-square&labelColor=7D8370)
![Camel](https://img.shields.io/badge/camel-C5A07F?style=flat-square&labelColor=C5A07F)

- **Type** — [Fraunces](https://fonts.google.com/specimen/Fraunces) for headings
  and figures, [Inter](https://fonts.google.com/specimen/Inter) for everything
  else. Numbers read like a printed ledger.
- **Motion** — spring physics only: every press, list change, and reveal eases
  with an interruptible `Animated.spring`, never a linear tween.
- **Light & dark** — one palette, both themes; the terracotta accent is shared,
  the ground swaps from linen to obsidian.
- **The mark** — a DNA helix wound with sage-and-terracotta foliage: *growth,
  compounding, the double strand of income and expense.* Full brand kit in
  [`assets/brand/`](assets/brand/).

## Screens

`Bütçe Özeti` (dashboard) · `Mali Tablo` (cash-flow matrix + analytics) ·
`Abonelikler` (subscriptions) · `Hesap` (calculator) · `Ayarlar` (settings).
The UI is in Turkish; the codebase is in English.

## Getting started

> **Node 22 required.** Expo SDK 54's build tooling is incompatible with the
> native TypeScript stripping in Node 24+. Use Node 22 (LTS).

```bash
git clone https://github.com/topraksv/helix.git
cd helix
npm install
cp .env.example .env    # add your Supabase URL + anon key — or leave empty for local-only mode

npm run web             # run on web
npm run ios             # iOS dev build (npx expo run:ios --device for a real phone)
```

No Supabase project? Leave `.env` empty and Helix runs fully local — no
account, no network, nothing leaves the device.

```bash
npm test                # 64 domain unit tests
npm run typecheck       # strict TypeScript
npx expo lint           # lint
```

### Connect Supabase (optional, for sync)

1. Create a free project at [supabase.com](https://supabase.com).
2. Run [the init migration](supabase/migrations/00000000000001_init.sql) in the
   SQL Editor.
3. Copy the project URL and **publishable (anon)** key from **Settings → API**
   into `.env` as `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
4. For CI only, add two repo secrets under **Settings → Secrets and variables →
   Actions**: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the `sb_secret_…`
   key — it powers the keep-alive cron and must **never** appear in `.env` or
   client code).
5. Run the `supabase-keepalive` workflow once from the Actions tab. It pings the
   database every 3 days so a free-tier project never pauses.
6. Under **Authentication → URL Configuration → Redirect URLs**, allow
   `https://topraksv.github.io/helix/**` for web and `helix://**` for the
   installed app. Password recovery uses Supabase's expiring, one-time PKCE
   links and routes both targets to `/reset-password`.

### Deploy the web app

Every push to `main` runs [the web deploy workflow](.github/workflows/deploy-web.yml):
`npx expo export -p web` builds a static site (per-route HTML, `baseUrl: /helix`)
and publishes it to GitHub Pages. Deep links to dynamic routes are handled by a
`404.html` fallback that hands the URL back to the client-side router.

## Project structure

```
src/
├── app/        # expo-router routes (dashboard, cash flow, subscriptions, calculator, settings)
├── domain/     # pure TS money engines — no I/O, fully unit-tested
├── db/         # Drizzle schema + expo-sqlite setup
├── sync/       # outbox, push/pull, last-write-wins merge
├── services/   # FX rates, notifications, backup (JSON export/import)
├── auth/       # Supabase auth + Face ID lock
├── i18n/       # Turkish UI strings (the only place UI copy lives)
└── ui/         # shared components (sticky table, calculator, forms) + theming
```

Contributor notes and architecture invariants live in [AGENTS.md](AGENTS.md);
manual test scenarios for the critical flows are in [docs/TESTING.md](docs/TESTING.md).

## Roadmap

Helix already handles the day-to-day. On the horizon:

- Budget alerts and a calendar view.
- Home-screen widgets and richer web notifications.

## License

**Proprietary — all rights reserved.** © 2026 Ömer Toprak Şavlı, sole developer
and maintainer. The source is published here for transparency and reference
only; it is *not* open-source. You may view the code and fork within GitHub to
propose contributions, but running, copying, modifying, redistributing, or
otherwise using the Software requires prior written permission. See the full
terms in [LICENSE](LICENSE), and contact the author for any licensing request.
