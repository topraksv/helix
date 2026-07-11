/**
 * Local notifications (spec §3.4). iOS: scheduled local notifications,
 * re-planned on every app open for the next 30 days. Web: no scheduled
 * notifications — the in-app dashboard covers the same information.
 */

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { getSqliteAsync } from "../db/client";
import { readSetting } from "../db/mutations";
import { addDaysISO, todayISO } from "../domain/dates";
import { formatMinor } from "../domain/money";
import { dateLabel, tr } from "../i18n/tr";

const HORIZON_DAYS = 30;
/** iOS keeps at most 64 pending local notifications and silently drops the
 *  rest; schedule the soonest ones only — the next app open replans anyway. */
const MAX_SCHEDULED = 60;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

interface PlannedNotification {
  date: string; // ISO date; fires at 09:00 local
  title: string;
  body: string;
}

/** Collect everything worth notifying within the horizon. */
export async function planNotifications(userId: string): Promise<PlannedNotification[]> {
  const sqlite = await getSqliteAsync();
  const today = todayISO();
  const horizonIso = addDaysISO(today, HORIZON_DAYS);
  const reminderDays = (await readSetting<number>(userId, "reminder_days")) ?? 3;
  const planned: PlannedNotification[] = [];

  const expected = await sqlite.getAllAsync<{
    due_date: string;
    amount_minor: number;
    currency: string;
    direction: string;
    kind: string;
    ref_id: string;
  }>(
    `SELECT due_date, amount_minor, currency, direction, kind, ref_id FROM expected_payments
     WHERE user_id = ? AND status = 'pending' AND due_date <= ? AND deleted_at IS NULL`,
    [userId, horizonIso] as never[],
  );
  const subNames = new Map(
    (await sqlite.getAllAsync<{ id: string; name: string }>(`SELECT id, name FROM subscriptions WHERE user_id = ?`, [userId] as never[])).map(
      (s) => [s.id, s.name] as const,
    ),
  );
  const incomeNames = new Map(
    (
      await sqlite.getAllAsync<{ id: string; name: string }>(`SELECT id, name FROM recurring_incomes WHERE user_id = ?`, [userId] as never[])
    ).map((s) => [s.id, s.name] as const),
  );

  for (const e of expected) {
    const name = subNames.get(e.ref_id) ?? incomeNames.get(e.ref_id) ?? tr.common.paymentFallback;
    const amount = formatMinor(e.amount_minor, e.currency);
    if (e.direction === "in") {
      if (e.due_date >= today) planned.push({ date: e.due_date, title: tr.notif.salaryTitle, body: tr.notif.salaryBody(name, amount) });
      continue;
    }
    // early "is the money ready" reminder
    const earlyIso = addDaysISO(e.due_date, -reminderDays);
    if (earlyIso > today) {
      planned.push({ date: earlyIso, title: tr.notif.upcomingTitle, body: tr.notif.upcoming(name, dateLabel(e.due_date), amount) });
    }
    if (e.due_date >= today) {
      planned.push({ date: e.due_date, title: tr.notif.dueTitle, body: tr.notif.dueBody(name, amount) });
    }
  }

  // Trial endings
  const trials = await sqlite.getAllAsync<{ name: string; trial_end_date: string }>(
    `SELECT name, trial_end_date FROM subscriptions
     WHERE user_id = ? AND is_active = 1 AND deleted_at IS NULL
       AND trial_end_date IS NOT NULL AND trial_end_date BETWEEN ? AND ?`,
    [userId, today, horizonIso] as never[],
  );
  for (const t of trials) {
    planned.push({ date: t.trial_end_date, title: tr.notif.trialTitle, body: tr.notif.trialBody(t.name, dateLabel(t.trial_end_date)) });
  }

  // Final installments finishing within the horizon
  const finals = await sqlite.getAllAsync<{ title: string; effective_date: string }>(
    `SELECT ip.title, t.effective_date FROM transactions t
     JOIN installment_plans ip ON ip.id = t.installment_plan_id
     WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.installment_no = ip.installment_count
       AND t.effective_date BETWEEN ? AND ?`,
    [userId, today, horizonIso] as never[],
  );
  for (const f of finals) {
    planned.push({ date: f.effective_date, title: tr.notif.lastInstallmentTitle, body: tr.notif.lastInstallmentBody(f.title) });
  }

  return planned;
}

/** Cancel + reschedule everything (idempotent, run on each app open). */
export async function rescheduleAll(userId: string): Promise<void> {
  if (Platform.OS === "web") return;
  const granted = await ensurePermission();
  if (!granted) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
  const now = Date.now();
  const upcoming = (await planNotifications(userId))
    .map((n) => ({ ...n, fireAt: new Date(`${n.date}T09:00:00`) }))
    .filter((n) => n.fireAt.getTime() > now)
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
    .slice(0, MAX_SCHEDULED);
  for (const n of upcoming) {
    await Notifications.scheduleNotificationAsync({
      content: { title: n.title, body: n.body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: n.fireAt },
    });
  }
}
