/**
 * Local notification scheduling, driven for real.
 *
 * Every suite that touched `services/notifications.ts` replaced it with a mock,
 * so nothing checked what it plans, what it keeps off a lock screen, or when it
 * clears the queue — its mutation score was zero. Here the real module runs over
 * the real schema with the real device preferences; only the operating system's
 * notification API and the device key-value store are stand-ins.
 */
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface ScheduledRequest {
  content: { title: string; body: string; data: Record<string, unknown> };
  trigger: { type: string; date: Date; channelId?: string };
}

const os = vi.hoisted(() => ({
  platform: { OS: "ios" as "ios" | "android" | "web" },
  permission: {} as Record<string, unknown>,
  requested: {} as Record<string, unknown>,
  scheduled: [] as ScheduledRequest[],
  calls: [] as string[],
  store: new Map<string, string>(),
  refuseWrites: false,
  db: null as DatabaseSync | null,
}));

vi.mock("react-native", () => ({ Platform: os.platform }));
vi.mock("expo-notifications", () => ({
  IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: "date" },
  setNotificationHandler: () => undefined,
  getPermissionsAsync: async () => os.permission,
  requestPermissionsAsync: async () => {
    os.calls.push("request");
    os.permission = os.requested;
    return os.requested;
  },
  setNotificationChannelAsync: async (id: string) => {
    os.calls.push(`channel:${id}`);
  },
  cancelAllScheduledNotificationsAsync: async () => {
    os.calls.push("cancel");
    os.scheduled.length = 0;
  },
  dismissAllNotificationsAsync: async () => {
    os.calls.push("dismiss");
  },
  scheduleNotificationAsync: async (request: ScheduledRequest) => {
    os.scheduled.push(request);
    return String(os.scheduled.length);
  },
}));
vi.mock("../src/services/kv", () => ({
  kv: {
    get: async (key: string) => os.store.get(key) ?? null,
    set: async (key: string, value: string) => {
      if (os.refuseWrites) throw new Error("storage refused");
      os.store.set(key, value);
    },
  },
}));
vi.mock("../src/db/client", async () => {
  const { sqliteClientMock } = await import("./helpers");
  return sqliteClientMock(() => os.db!);
});
vi.mock("../src/db/ids", () => ({ newId: () => "id", deterministicId: async (key: string) => key, naturalKeys: {} }));
vi.mock("../src/sync/engine", () => ({ scheduleSync: () => undefined }));

import { todayISO } from "../src/domain/dates";
import { formatMinorCompact } from "../src/domain/money";
import { dateLabel, tr } from "../src/i18n/tr";
import { migrationStatements } from "./helpers";

type Service = typeof import("../src/services/notifications");

const USER = "notify-user";
const STAMP = "2026-08-01T00:00:00.000Z";
const NOTIFICATIONS = "helix.notifications";
const DETAILS = "helix.notification-details";
const AUTHORIZED = { granted: true, ios: { status: 2 } };

function run(sql: string, ...args: unknown[]): void {
  os.db!.prepare(sql).run(...(args as never[]));
}

function expected(id: string, direction: "in" | "out", refId: string, dueDate: string, amountMinor: number, extra: { status?: string; estimated?: boolean; deleted?: boolean } = {}): void {
  run(
    `INSERT INTO expected_payments (id, user_id, created_at, updated_at, deleted_at, direction, kind, ref_id, due_date, amount_minor, currency, status, amount_is_estimated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TRY', ?, ?)`,
    id, USER, STAMP, STAMP, extra.deleted ? STAMP : null, direction, direction === "in" ? "recurring_income" : "subscription",
    refId, dueDate, amountMinor, extra.status ?? "pending", extra.estimated ? 1 : 0,
  );
}

/** Today is 10 August 2026; the horizon therefore ends on 9 September. */
function seed(): void {
  run(`INSERT INTO persons (id, user_id, created_at, updated_at, name, is_self) VALUES ('self', ?, ?, ?, 'Ben', 1)`, USER, STAMP, STAMP);
  run(
    `INSERT INTO subscriptions (id, user_id, created_at, updated_at, name, amount_minor, cycle, billing_day, next_due_date, person_id, is_active, trial_end_date)
     VALUES ('netflix', ?, ?, ?, 'Netflix', 22999, 'monthly', 15, '2026-08-15', 'self', 1, '2026-08-20'),
            ('gym', ?, ?, ?, 'Spor', 90000, 'monthly', 21, '2026-08-21', 'self', 0, '2026-08-21')`,
    USER, STAMP, STAMP, USER, STAMP, STAMP,
  );
  run(
    `INSERT INTO recurring_incomes (id, user_id, created_at, updated_at, name, default_amount_minor, pay_day, person_id)
     VALUES ('salary', ?, ?, ?, 'Maaş', 5000000, 25, 'self')`,
    USER, STAMP, STAMP,
  );
  run(`INSERT INTO settings (id, user_id, created_at, updated_at, key, value) VALUES ('reminder', ?, ?, ?, 'reminder_days', '3')`, USER, STAMP, STAMP);
  expected("today", "out", "netflix", "2026-08-10", 22999, { estimated: true });
  expected("netflix-aug", "out", "netflix", "2026-08-15", 22999);
  expected("salary-aug", "in", "salary", "2026-08-25", 5000000);
  expected("unknown", "out", "ghost", "2026-08-30", 10000);
  expected("horizon-edge", "out", "netflix", "2026-09-09", 22999);
  // Past the horizon, already paid, deleted, and already gone by: none of these remind.
  expected("beyond", "out", "netflix", "2026-09-10", 22999);
  expected("paid", "out", "netflix", "2026-08-18", 22999, { status: "paid" });
  expected("deleted", "out", "netflix", "2026-08-22", 22999, { deleted: true });
  expected("late-income", "in", "salary", "2026-08-05", 5000000);
  expected("late-bill", "out", "netflix", "2026-08-05", 22999);
  run(
    `INSERT INTO installment_plans (id, user_id, created_at, updated_at, title, kind, installment_count, start_month, person_id)
     VALUES ('phone', ?, ?, ?, 'Telefon', 'card_installment', 3, '2026-06', 'self')`,
    USER, STAMP, STAMP,
  );
  const instalment = (id: string, no: number, date: string, status: string) => run(
    `INSERT INTO transactions (id, user_id, created_at, updated_at, type, amount_minor, amount_try_minor, entry_date, effective_date, status, person_id, installment_plan_id, installment_no)
     VALUES (?, ?, ?, ?, 'expense', 10000, 10000, '2026-06-01', ?, ?, 'self', 'phone', ?)`,
    id, USER, STAMP, STAMP, date, status, no,
  );
  instalment("phone-2", 2, "2026-08-27", "pending");
  instalment("phone-3", 3, "2026-08-28", "pending");
}

const amount = (minor: number) => formatMinorCompact(minor, "TRY");
const target = (value: unknown) => ({ helixTarget: value });

/** Every detailed reminder the seed produces, soonest first. */
const DETAILED = [
  ["2026-08-10", tr.notif.dueTitle, tr.notif.dueBody("Netflix", `${tr.subs.estimatedAmount} · ${amount(22999)}`), target({ kind: "expected" })],
  ["2026-08-12", tr.notif.upcomingTitle, tr.notif.upcoming("Netflix", dateLabel("2026-08-15"), amount(22999)), target({ kind: "expected" })],
  ["2026-08-15", tr.notif.dueTitle, tr.notif.dueBody("Netflix", amount(22999)), target({ kind: "expected" })],
  ["2026-08-20", tr.notif.trialTitle, tr.notif.trialBody("Netflix", dateLabel("2026-08-20")), target({ kind: "subscription", id: "netflix" })],
  ["2026-08-25", tr.notif.salaryTitle, tr.notif.salaryBody("Maaş", amount(5000000)), target({ kind: "expected" })],
  ["2026-08-27", tr.notif.upcomingTitle, tr.notif.upcoming(tr.common.paymentFallback, dateLabel("2026-08-30"), amount(10000)), target({ kind: "expected" })],
  ["2026-08-28", tr.notif.lastInstallmentTitle, tr.notif.lastInstallmentBody("Telefon"), target({ kind: "installmentPlan", id: "phone" })],
  ["2026-08-30", tr.notif.dueTitle, tr.notif.dueBody(tr.common.paymentFallback, amount(10000)), target({ kind: "expected" })],
  ["2026-09-06", tr.notif.upcomingTitle, tr.notif.upcoming("Netflix", dateLabel("2026-09-09"), amount(22999)), target({ kind: "expected" })],
  ["2026-09-09", tr.notif.dueTitle, tr.notif.dueBody("Netflix", amount(22999)), target({ kind: "expected" })],
];

const scheduled = () => os.scheduled.map((request) => [
  todayISO(request.trigger.date),
  request.content.title,
  request.content.body,
  request.content.data,
]);

describe("local notification scheduling", () => {
  let service: Service;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 10, 0, 30));
    os.platform.OS = "ios";
    os.permission = AUTHORIZED;
    os.requested = AUTHORIZED;
    os.scheduled.length = 0;
    os.calls.length = 0;
    os.store.clear();
    os.refuseWrites = false;
    os.db = new DatabaseSync(":memory:");
    for (const statement of migrationStatements) os.db.exec(statement);
    seed();
    // Device preferences are held per process, so every case starts a fresh one.
    vi.resetModules();
    service = await import("../src/services/notifications");
  });

  afterEach(() => {
    os.db?.close();
    vi.useRealTimers();
  });

  it("plans every reminder due within thirty days, soonest first, and only those", async () => {
    os.store.set(NOTIFICATIONS, "true");
    os.store.set(DETAILS, "true");

    await service.rescheduleAll(USER);

    expect(scheduled()).toEqual(DETAILED);
    expect(os.calls).toEqual(["cancel"]);
    expect(os.scheduled.every((request) => request.trigger.type === "date" && request.trigger.channelId === undefined)).toBe(true);
    expect(os.scheduled[0]!.trigger.date.getHours()).toBe(9);
  });

  it("keeps names and amounts off the lock screen unless details were chosen, one reminder a day", async () => {
    os.store.set(NOTIFICATIONS, "true");
    expected("same-day", "out", "ghost", "2026-08-15", 5000);

    await service.rescheduleAll(USER);

    expect(scheduled()).toEqual(DETAILED.map(([date]) => [date, tr.notif.privateTitle, tr.notif.privateBody, target({ kind: "expected" })]));
  });

  it("skips a reminder whose hour has already passed today", async () => {
    os.store.set(NOTIFICATIONS, "true");
    os.store.set(DETAILS, "true");
    vi.setSystemTime(new Date(2026, 7, 10, 9, 30));

    await service.rescheduleAll(USER);

    expect(scheduled()).toEqual(DETAILED.slice(1));
  });

  it("schedules at most sixty, soonest first", async () => {
    os.store.set(NOTIFICATIONS, "true");
    os.store.set(DETAILS, "true");
    for (let index = 0; index < 40; index += 1) {
      expected(`bulk-${index}`, "out", "ghost", `2026-09-0${1 + (index % 8)}`, 100 + index);
    }

    await service.rescheduleAll(USER);

    const dates = scheduled().map(([date]) => date as string);
    expect(dates).toHaveLength(60);
    expect(dates[0]).toBe("2026-08-10");
    expect([...dates].sort()).toEqual(dates);
  });

  it("clears the queue and schedules nothing while notifications are off", async () => {
    await service.rescheduleAll(USER);

    expect(os.calls).toEqual(["cancel", "dismiss"]);
    expect(os.scheduled).toEqual([]);
  });

  it("clears the queue when the operating system permission was withdrawn", async () => {
    os.store.set(NOTIFICATIONS, "true");
    os.permission = { granted: false, ios: { status: 1 } };

    await service.rescheduleAll(USER);

    expect(os.calls).toEqual(["cancel", "dismiss"]);
    expect(os.scheduled).toEqual([]);
  });

  it("accepts provisional and ephemeral iOS permission as granted, and only those beside authorised", async () => {
    os.store.set(NOTIFICATIONS, "true");
    for (const [status, granted] of [[3, true], [4, true], [0, false]] as const) {
      os.permission = { granted: !granted, ios: { status } };
      os.scheduled.length = 0;
      await service.rescheduleAll(USER);
      expect(os.scheduled.length > 0).toBe(granted);
    }
  });

  it("asks the operating system only when permission is not already granted", async () => {
    expect(await service.enableNotifications(USER)).toBe(true);
    expect(os.calls).not.toContain("request");

    os.permission = { granted: false, ios: { status: 0 } };
    os.calls.length = 0;
    expect(await service.enableNotifications(USER)).toBe(true);
    expect(os.calls[0]).toBe("request");
    expect(os.store.get(NOTIFICATIONS)).toBe("true");
    expect(os.scheduled).toHaveLength(DETAILED.length);
  });

  it("turns notifications off and clears everything when permission is refused", async () => {
    os.store.set(DETAILS, "true");
    os.permission = { granted: false, ios: { status: 0 } };
    os.requested = { granted: false, ios: { status: 1 } };

    expect(await service.enableNotifications(USER)).toBe(false);

    expect(os.store.get(NOTIFICATIONS)).toBe("false");
    expect(os.store.get(DETAILS)).toBe("false");
    expect(os.calls).toEqual(["request", "cancel", "dismiss"]);
    expect(os.scheduled).toEqual([]);
  });

  it("schedules on Android through its own channel, reading the plain granted flag", async () => {
    os.platform.OS = "android";
    os.permission = { granted: true };

    expect(await service.enableNotifications(USER)).toBe(true);

    expect(os.calls[0]).toBe("channel:helix-reminders");
    expect(os.scheduled.length).toBeGreaterThan(0);
    expect(os.scheduled.every((request) => request.trigger.channelId === "helix-reminders")).toBe(true);
  });

  it("does nothing at all on the web", async () => {
    os.platform.OS = "web";
    os.store.set(NOTIFICATIONS, "true");

    expect(await service.enableNotifications(USER)).toBe(false);
    await service.rescheduleAll(USER);
    await service.clearAccountNotifications();

    expect(os.calls).toEqual([]);
  });

  it("clears what is already on the lock screen before a rebuild without details", async () => {
    os.store.set(NOTIFICATIONS, "true");
    os.store.set(DETAILS, "true");

    await service.updateNotificationDetails(USER, false);

    expect(os.calls).toEqual(["cancel", "dismiss", "cancel"]);
    expect(os.store.get(DETAILS)).toBe("false");
    expect(os.scheduled[0]!.content.title).toBe(tr.notif.privateTitle);

    os.calls.length = 0;
    await service.updateNotificationDetails(USER, true);
    expect(os.calls).toEqual(["cancel"]);
    expect(os.store.get(DETAILS)).toBe("true");
    expect(scheduled()).toEqual(DETAILED);
  });

  it("still clears the queue when the device refuses to store the choice to turn off", async () => {
    os.store.set(NOTIFICATIONS, "true");
    os.refuseWrites = true;

    await expect(service.disableNotifications()).rejects.toThrow("storage refused");

    expect(os.calls).toEqual(["cancel", "dismiss"]);
  });
});
