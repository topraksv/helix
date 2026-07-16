# Manual test scenarios (critical flows)

Automated coverage lives in `tests/` (`npm test`, 198 unit tests). The flows below
cross UI, local DB, and sync, so they are verified by hand before a release.

1. **Onboarding:** sign up → pick a template → set starting month + opening balance → add
   two watched people and assign payment sources → delete the first watched person → verify
   their source returns to “Ben”, the later person's source keeps its owner → finish.
2. **Bulk history entry:** back-fill 3 past months with category totals → compare the Cash
   Flow cards, the wide-screen matrix, and the Analytics YTD totals 1:1 against the spreadsheet.
3. **Installments:** add an expense as "6 installments, 2 paid" → distribution across months,
   `2/6` progress, and end month are correct; hand-compute this month's total obligation and
   compare with the Installments screen.
4. **Future-dated payment (§2.7):** add an expense dated tomorrow → today's balance is
   unchanged; opening the app the next day (or advancing the device clock) marks it as
   occurred and it hits the balance.
5. **Watch-only (§2.8):** add an installment for a second person → balance is unchanged; it
   appears under "Watched" on the Installments screen and its notification fires.
6. **Salary rule:** Settings → Recurring incomes → add a salary → the Dashboard's "expected
   income" reflects it; confirm with a different amount → the actual amount posts to the balance.
7. **Catch-up:** open the app after several days of no entries → "Last entry: X (n days ago)"
   banner → on the Reconciliation screen confirm/skip/adjust the items that came due in between.
8. **Offline:** open in airplane mode → lock screen, sign-in, every screen, and writes all
   work; when the network returns, Settings → Sync shows "Up to date".
9. **Multi-device:** sign in on two clients → add/edit/delete/undo on one → after sync the
   other shows the identical state (including deletions).
10. **RLS:** create a second Supabase user → no query ever returns the first user's data.
11. **Backup:** export JSON → import into a clean install → data matches 1:1.
12. **Theme/notifications:** walk every screen in dark and light theme; confirm
    cold start does not request permission, enable notifications in Settings,
    and verify an upcoming-payment notification is scheduled. Sign out and
    confirm scheduled/presented account details are removed.
13. **Credit-card statements:** create a card with cut-off 25 / due 5 → add
    purchases on the 25th and 26th → verify they land in consecutive statement
    periods and affect the ledger on 5 August / 5 September, not on purchase
    day. The dashboard must show one total per persisted statement. Edit the
    card cycle and confirm old periods/dates stay unchanged. A legacy card with
    missing dates must block new charges without inventing an upcoming date.
14. **External data/privacy:** open Subscriptions and confirm known public
    domains load cached favicons automatically, while utility/unknown/invalid or
    local domains keep their local mark without a broken image. Background the
    app for over 60 seconds and confirm market prices disappear rather than
    remaining live. With FX offline, foreign subscriptions must be reported as
    excluded from totals, never added as raw TRY.
15. **Navigation/UI regression:** open every Settings and Cash Flow child route
    both from its parent and as a direct link. The header back button must return
    to history when present and its deterministic parent otherwise. At 320/390
    px verify month cards keep three centred stats; installment progress and
    card cycle dates remain readable; USD/EUR stay listed in Live Markets.
