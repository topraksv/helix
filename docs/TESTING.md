# Manual test scenarios (critical flows)

Automated coverage lives in `tests/` (`npm test`, 56 domain unit tests). The flows below
cross UI, local DB, and sync, so they are verified by hand before a release.

1. **Onboarding:** sign up → pick a template → set starting month + opening balance → add
   person/payment source → finish.
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
12. **Theme/notifications:** walk every screen in dark and light theme; grant notification
    permission and verify an upcoming-payment notification is scheduled (Settings → lead days).
