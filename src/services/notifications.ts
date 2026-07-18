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
import { loadDevicePreferences, notificationsEnabled, setNotificationDetailsEnabled, setNotificationsEnabled } from "../lib/device-preferences";
import { boundedScheduledNotifications, normalizeReminderDays, privateNotificationContent, uniqueNotifications } from "../domain/notifications";

const HORIZON_DAYS = 30;
/** iOS keeps at most 64 pending local notifications and silently drops the
 *  rest; schedule the soonest ones only — the next app open replans anyway. */
const MAX_SCHEDULED = 60;
const ANDROID_CHANNEL_ID = "helix-reminders";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function permissionGranted(status: Notifications.NotificationPermissionsStatus): boolean {
  if (Platform.OS !== "ios") return status.granted;
  const ios = status.ios?.status;
  return ios === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    ios === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    ios === Notifications.IosAuthorizationStatus.EPHEMERAL;
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: tr.settings.notifications,
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/** Request permission only from an explicit settings action. */
export async function enableNotifications(userId: string): Promise<boolean> {
  if (Platform.OS === "web") return false;
  await ensureAndroidChannel();
  const current = await Notifications.getPermissionsAsync();
  const finalStatus = permissionGranted(current) ? current : await Notifications.requestPermissionsAsync();
  if (!permissionGranted(finalStatus)) {
    await disableNotifications();
    return false;
  }
  await setNotificationsEnabled(true);
  await rescheduleAll(userId);
  return true;
}

export async function disableNotifications(): Promise<void> {
  try {
    await setNotificationsEnabled(false);
  } finally {
    // Even a device-storage failure must not leave a detailed OS preview
    // scheduled after the user turns notifications off.
    await clearAccountNotifications(true);
  }
}

/** Privacy-off is fail-closed: detailed pending previews are removed before
 * neutral reminders are rebuilt, so a transient DB error cannot leave them. */
export async function updateNotificationDetails(userId: string, enabled: boolean): Promise<void> {
  if (enabled) await setNotificationDetailsEnabled(true);
  else {
    await clearAccountNotifications();
    await setNotificationDetailsEnabled(false);
  }
  await rescheduleAll(userId);
}

/** Remove both future and already-presented account details from the device. */
export async function clearAccountNotifications(resetDetails = false): Promise<void> {
  try {
    if (Platform.OS !== "web") {
      await Promise.all([
        Notifications.cancelAllScheduledNotificationsAsync(),
        Notifications.dismissAllNotificationsAsync(),
      ]);
    }
  } finally {
    if (resetDetails) await setNotificationDetailsEnabled(false);
  }
}

interface PlannedNotification {
  date: string; // ISO date; fires at 09:00 local
  title: string;
  body: string;
}

/** Collect everything worth notifying within the horizon. */
async function planNotifications(userId: string): Promise<PlannedNotification[]> {
  const sqlite = await getSqliteAsync();
  const today = todayISO();
  const horizonIso = addDaysISO(today, HORIZON_DAYS);
  const rawReminderDays = (await readSetting<number>(userId, "reminder_days")) ?? 3;
  const reminderDays = normalizeReminderDays(rawReminderDays, HORIZON_DAYS);
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
    [userId, horizonIso],
  );
  const subNames = new Map(
    (await sqlite.getAllAsync<{ id: string; name: string }>(
      `SELECT id, name FROM subscriptions WHERE user_id = ? AND deleted_at IS NULL`,
      [userId],
    )).map(
      (s) => [s.id, s.name] as const,
    ),
  );
  const incomeNames = new Map(
    (
      await sqlite.getAllAsync<{ id: string; name: string }>(
        `SELECT id, name FROM recurring_incomes WHERE user_id = ? AND deleted_at IS NULL`,
        [userId],
      )
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
    [userId, today, horizonIso],
  );
  for (const t of trials) {
    planned.push({ date: t.trial_end_date, title: tr.notif.trialTitle, body: tr.notif.trialBody(t.name, dateLabel(t.trial_end_date)) });
  }

  // Final installments finishing within the horizon
  const finals = await sqlite.getAllAsync<{ title: string; effective_date: string }>(
    `SELECT ip.title, t.effective_date FROM transactions t
     JOIN installment_plans ip ON ip.id = t.installment_plan_id
     WHERE t.user_id = ? AND t.deleted_at IS NULL AND ip.deleted_at IS NULL
       AND t.status = 'pending' AND t.installment_no = ip.installment_count
       AND t.effective_date BETWEEN ? AND ?`,
    [userId, today, horizonIso],
  );
  for (const f of finals) {
    planned.push({ date: f.effective_date, title: tr.notif.lastInstallmentTitle, body: tr.notif.lastInstallmentBody(f.title) });
  }

  return planned;
}

/** Cancel + reschedule everything (idempotent, run on each app open). */
export async function rescheduleAll(userId: string): Promise<void> {
  if (Platform.OS === "web") return;
  if (!(await notificationsEnabled())) {
    await clearAccountNotifications();
    return;
  }
  await ensureAndroidChannel();
  const permission = await Notifications.getPermissionsAsync();
  if (!permissionGranted(permission)) return;
  const now = Date.now();
  const detailsEnabled = (await loadDevicePreferences()).notificationDetails;
  const neutral = { title: tr.notif.privateTitle, body: tr.notif.privateBody };
  const planned = uniqueNotifications((await planNotifications(userId)).map((notification) => ({
    ...notification,
    ...privateNotificationContent(detailsEnabled, notification, neutral),
  })))
    .map((notification) => ({ ...notification, fireAt: new Date(`${notification.date}T09:00:00`) }))
    .filter((notification) => notification.fireAt.getTime() > now);
  const upcoming = boundedScheduledNotifications(planned, MAX_SCHEDULED);
  // Plan/query first: a transient database error must not erase working
  // reminders. Once the full replacement is ready, swap the app-owned queue.
  await Notifications.cancelAllScheduledNotificationsAsync();
  for (const n of upcoming) {
    await Notifications.scheduleNotificationAsync({
      content: { title: n.title, body: n.body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: n.fireAt,
        ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
      },
    });
  }
}
