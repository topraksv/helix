import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  db: null as DatabaseSync | null,
  nextId: 0,
  dbAcquisitions: 0,
  cardStatementLookups: 0,
  repairCardStatementLinks: vi.fn(async () => {}),
  runMaintenance: vi.fn(async () => {}),
}));

vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => {
    harness.dbAcquisitions += 1;
    return {
      getFirstAsync: async (sql: string, args: unknown[] = []) => {
        if (sql.includes("SELECT created_at FROM credit_card_statements")) {
          harness.cardStatementLookups += 1;
        }
        return harness.db!.prepare(sql).get(...(args as never[])) ?? null;
      },
      getAllAsync: async (sql: string, args: unknown[] = []) =>
        harness.db!.prepare(sql).all(...(args as never[])),
      runAsync: async (sql: string, args: unknown[] = []) => ({
        changes: Number(harness.db!.prepare(sql).run(...(args as never[])).changes),
      }),
    };
  },
  withTransaction: async (task: () => Promise<void>) => {
    harness.db!.exec("BEGIN");
    try {
      await task();
      harness.db!.exec("COMMIT");
    } catch (error) {
      harness.db!.exec("ROLLBACK");
      throw error;
    }
  },
}));

vi.mock("../src/db/ids", () => ({
  newId: () => `account-${String(++harness.nextId).padStart(2, "0")}`,
  deterministicId: async (key: string) => `det:${key}`,
  naturalKeys: new Proxy(
    {},
    {
      get:
        (_target, property) =>
        (...parts: unknown[]) =>
          `${String(property)}|${parts.join("|")}`,
    },
  ),
}));

vi.mock("../src/data/repo/maintenance", () => ({
  repairCardStatementLinks: harness.repairCardStatementLinks,
  runMaintenance: harness.runMaintenance,
}));

vi.mock("../src/sync/engine", () => ({ scheduleSync: vi.fn() }));
vi.mock("../src/services/fx-fetch", () => ({ lookupRate: vi.fn() }));
vi.mock("../src/services/markets", () => ({ marketSellRateTry: vi.fn() }));

import {
  createPerson,
  deleteUnreferencedPaymentSource,
  deleteUnreferencedPerson,
  paymentSourceReferenceUsage,
  personReferenceUsage,
  reassignAndDeletePaymentSource,
  reassignAndDeletePerson,
  renamePerson,
  restorePaymentSource,
  restorePerson,
  upsertPaymentSource,
  type PaymentSourceInput,
} from "../src/data/repo/accounts";
import { fromDbShape } from "../src/db/mutations";
import { PAYMENT_SOURCE_TYPES, type PaymentSourceType } from "../src/domain/types";

const USER = "accounts-user";
const OTHER_USER = "other-user";
const NOW = "2026-08-13T09:00:00.000Z";
const DELETED_AT = "2026-08-12T09:00:00.000Z";
const migrationsDir = join(process.cwd(), "src/db/migrations");
const migrationSql = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
  .flatMap((name) =>
    readFileSync(join(migrationsDir, name), "utf8").split(
      "--> statement-breakpoint",
    ),
  )
  .map((statement) => statement.trim())
  .filter(Boolean);

function seedPerson(
  id: string,
  options: { userId?: string; isSelf?: boolean; deletedAt?: string | null; name?: string } = {},
): void {
  const userId = options.userId ?? USER;
  const deletedAt = options.deletedAt ?? null;
  harness.db!.prepare(
    `INSERT INTO persons
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version, name, is_self)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    NOW,
    NOW,
    deletedAt,
    deletedAt ? 1 : 0,
    options.name ?? id,
    options.isSelf ? 1 : 0,
  );
}

function seedSource(
  id: string,
  type: PaymentSourceType = "cash",
  options: {
    userId?: string;
    personId?: string;
    deletedAt?: string | null;
    statementDay?: number | null;
    dueDay?: number | null;
    name?: string;
    color?: string | null;
    logoSource?: "brand" | "favicon" | "manual" | "initials";
    logoRef?: string | null;
    isActive?: boolean;
  } = {},
): void {
  const userId = options.userId ?? USER;
  const deletedAt = options.deletedAt ?? null;
  harness.db!.prepare(
    `INSERT INTO payment_sources
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       name, type, person_id, due_day, statement_day, color, logo_source,
       logo_ref, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    NOW,
    NOW,
    deletedAt,
    deletedAt ? 1 : 0,
    options.name ?? id,
    type,
    options.personId ?? (userId === USER ? "self" : "other-self"),
    options.dueDay === undefined ? (type === "credit_card" ? 5 : null) : options.dueDay,
    options.statementDay === undefined ? (type === "credit_card" ? 25 : null) : options.statementDay,
    options.color ?? null,
    options.logoSource ?? "initials",
    options.logoRef ?? null,
    options.isActive === false ? 0 : 1,
  );
}

function seedPlan(
  id: string,
  options: {
    sourceId?: string | null;
    personId?: string;
    kind?: "card_installment" | "loan";
    dueDay?: number | null;
    deletedAt?: string | null;
    userId?: string;
  } = {},
): void {
  const userId = options.userId ?? USER;
  const deletedAt = options.deletedAt ?? null;
  harness.db!.prepare(
    `INSERT INTO installment_plans
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       title, kind, total_amount_minor, monthly_amount_minor, installment_count,
       currency, start_month, due_day, payment_source_id, person_id, category_id, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 12000, NULL, 3, 'TRY', '2026-07', ?, ?, ?, NULL, NULL)`,
  ).run(
    id,
    userId,
    NOW,
    NOW,
    deletedAt,
    deletedAt ? 1 : 0,
    id,
    options.kind ?? "loan",
    options.dueDay ?? 7,
    options.sourceId ?? null,
    options.personId ?? "self",
  );
}

function seedStatement(
  id: string,
  sourceId: string,
  periodMonth: string,
  options: { userId?: string; deletedAt?: string | null; statementDate?: string; dueDate?: string } = {},
): void {
  const userId = options.userId ?? USER;
  const deletedAt = options.deletedAt ?? null;
  harness.db!.prepare(
    `INSERT INTO credit_card_statements
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       payment_source_id, period_month, statement_date, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    NOW,
    NOW,
    deletedAt,
    deletedAt ? 1 : 0,
    sourceId,
    periodMonth,
    options.statementDate ?? `${periodMonth}-25`,
    options.dueDate ?? "2026-08-05",
  );
}

function seedTransaction(
  id: string,
  options: {
    sourceId?: string | null;
    personId?: string;
    type?: "expense" | "income" | "transfer";
    purchaseDate?: string | null;
    effectiveDate?: string;
    status?: "pending" | "realized";
    cardStatementId?: string | null;
    isAggregate?: boolean;
    deletedAt?: string | null;
    userId?: string;
  } = {},
): void {
  const userId = options.userId ?? USER;
  const deletedAt = options.deletedAt ?? null;
  harness.db!.prepare(
    `INSERT INTO transactions
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       type, amount_minor, currency, fx_rate, amount_try_minor, entry_date,
       purchase_date, effective_date, status, category_id, payment_source_id,
       person_id, installment_plan_id, installment_no, card_statement_id,
       subscription_id, is_aggregate, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1000, 'TRY', NULL, 1000, '2026-08-01',
       ?, ?, ?, NULL, ?, ?, NULL, NULL, ?, NULL, ?, NULL)`,
  ).run(
    id,
    userId,
    NOW,
    NOW,
    deletedAt,
    deletedAt ? 1 : 0,
    options.type ?? "expense",
    options.purchaseDate ?? null,
    options.effectiveDate ?? "2026-08-20",
    options.status ?? "pending",
    options.sourceId ?? null,
    options.personId ?? "self",
    options.cardStatementId ?? null,
    options.isAggregate ? 1 : 0,
  );
}

function seedSubscription(
  id: string,
  options: {
    sourceId?: string | null;
    personId?: string;
    deletedAt?: string | null;
    userId?: string;
  } = {},
): void {
  const userId = options.userId ?? USER;
  const deletedAt = options.deletedAt ?? null;
  harness.db!.prepare(
    `INSERT INTO subscriptions
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       name, amount_minor, amount_mode, currency, cycle, interval_months,
       billing_day, next_due_date, payment_source_id, category_id, person_id,
       is_active, canceled_at, trial_end_date, auto_pay, website_domain,
       logo_source, logo_ref, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1000, 'fixed', 'TRY', 'monthly', 1,
       10, '2026-09-10', ?, NULL, ?, 1, NULL, NULL, 0, NULL, 'initials', NULL, NULL)`,
  ).run(
    id,
    userId,
    NOW,
    NOW,
    deletedAt,
    deletedAt ? 1 : 0,
    id,
    options.sourceId ?? null,
    options.personId ?? "self",
  );
}

function seedRecurringIncome(
  id: string,
  options: { personId?: string; deletedAt?: string | null; userId?: string } = {},
): void {
  const userId = options.userId ?? USER;
  const deletedAt = options.deletedAt ?? null;
  harness.db!.prepare(
    `INSERT INTO recurring_incomes
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       name, kind, default_amount_minor, currency, pay_day, recurrence,
       anchor_date, person_id, category_id, is_active, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'salary', 1000, 'TRY', 10, 'monthly',
       NULL, ?, NULL, 1, NULL)`,
  ).run(
    id,
    userId,
    NOW,
    NOW,
    deletedAt,
    deletedAt ? 1 : 0,
    id,
    options.personId ?? "self",
  );
}

function row(table: string, id: string): Record<string, unknown> {
  return harness.db!.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown>;
}

function liveCount(table: string): number {
  return Number((harness.db!.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ? AND deleted_at IS NULL`,
  ).get(USER) as { n: number }).n);
}

function domainOutbox(): { table_name: string; row_id: string; payload: string }[] {
  return harness.db!.prepare(
    `SELECT table_name, row_id, payload FROM outbox
     WHERE table_name != 'settings' ORDER BY id`,
  ).all() as { table_name: string; row_id: string; payload: string }[];
}

function clearOutbox(): void {
  harness.db!.exec("DELETE FROM outbox");
}

function paymentInput(overrides: Partial<PaymentSourceInput> = {}): PaymentSourceInput {
  return {
    name: "  Günlük kaynak  ",
    type: "cash",
    personId: "self",
    dueDay: 7,
    statementDay: 21,
    ...overrides,
  };
}

describe("accounts repository persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    harness.nextId = 0;
    harness.dbAcquisitions = 0;
    harness.cardStatementLookups = 0;
    harness.repairCardStatementLinks.mockReset().mockResolvedValue(undefined);
    harness.runMaintenance.mockReset().mockResolvedValue(undefined);
    harness.db = new DatabaseSync(":memory:");
    for (const statement of migrationSql) harness.db.exec(statement);
    seedPerson("self", { isSelf: true, name: "Ben" });
    seedPerson("other-self", { userId: OTHER_USER, isSelf: true });
  });

  afterEach(() => {
    harness.db?.close();
    harness.db = null;
    vi.useRealTimers();
  });

  it("creates the first person as self, trims names, and emits owned outbox snapshots", async () => {
    harness.db!.exec("DELETE FROM persons");

    const firstId = await createPerson(USER, "  Toprak  ");
    const secondId = await createPerson(USER, "Ece");

    expect(firstId).toBe("account-01");
    expect(secondId).toBe("account-02");
    expect(row("persons", firstId)).toMatchObject({
      user_id: USER,
      name: "Toprak",
      is_self: 1,
      deleted_at: null,
      tombstone_version: 0,
    });
    expect(row("persons", secondId)).toMatchObject({
      user_id: USER,
      name: "Ece",
      is_self: 0,
      deleted_at: null,
      tombstone_version: 0,
    });
    expect(domainOutbox().map(({ table_name, row_id, payload }) => ({
      table_name,
      row_id,
      payload: JSON.parse(payload),
    }))).toEqual([
      {
        table_name: "persons",
        row_id: firstId,
        payload: expect.objectContaining({ id: firstId, user_id: USER, name: "Toprak", is_self: true }),
      },
      {
        table_name: "persons",
        row_id: secondId,
        payload: expect.objectContaining({ id: secondId, user_id: USER, name: "Ece", is_self: false }),
      },
    ]);
  });

  it("rejects invalid person names before persistence and preserves owned identity on rename", async () => {
    const beforeAcquisitions = harness.dbAcquisitions;
    await expect(createPerson(USER, "   ")).rejects.toThrow("Person name is required");
    await expect(createPerson(USER, "x".repeat(121))).rejects.toThrow("text input exceeds its maximum length");
    await expect(renamePerson(USER, fromDbShape("persons", row("persons", "self")), "   ")).rejects.toThrow(
      "Person name is required",
    );
    await expect(renamePerson(
      USER,
      fromDbShape("persons", row("persons", "self")),
      "x".repeat(121),
    )).rejects.toThrow("text input exceeds its maximum length");
    expect(harness.dbAcquisitions).toBe(beforeAcquisitions);
    expect(domainOutbox()).toEqual([]);

    await renamePerson(USER, fromDbShape("persons", row("persons", "self")), "  Yeni ad  ");
    expect(row("persons", "self")).toMatchObject({ name: "Yeni ad", is_self: 1, user_id: USER });
    expect(JSON.parse(domainOutbox()[0]!.payload)).toMatchObject({
      id: "self",
      user_id: USER,
      name: "Yeni ad",
      is_self: 1,
    });
  });

  it("rejects foreign and tombstoned person renames atomically", async () => {
    seedPerson("deleted-person", { deletedAt: DELETED_AT });
    const foreignBefore = row("persons", "other-self");
    const deletedBefore = row("persons", "deleted-person");

    await expect(renamePerson(
      USER,
      fromDbShape("persons", foreignBefore),
      "Kaçak",
    )).rejects.toThrow("Cannot edit missing persons row");
    await expect(renamePerson(
      USER,
      fromDbShape("persons", deletedBefore),
      "Diriltme",
    )).rejects.toThrow("Cannot edit missing persons row");

    expect(row("persons", "other-self")).toEqual(foreignBefore);
    expect(row("persons", "deleted-person")).toEqual(deletedBefore);
    expect(domainOutbox()).toEqual([]);
  });

  it("tombstones and restores a non-self person using the raw delete snapshot", async () => {
    seedPerson("watch", { name: "İzlenen" });
    const snapshot = await deleteUnreferencedPerson(USER, "watch");

    expect(snapshot).toMatchObject({ id: "watch", user_id: USER, name: "İzlenen", deleted_at: null });
    expect(row("persons", "watch")).toMatchObject({ deleted_at: NOW, tombstone_version: 1 });
    expect(JSON.parse(domainOutbox()[0]!.payload)).toMatchObject({
      id: "watch",
      user_id: USER,
      deleted_at: NOW,
      tombstone_version: 1,
    });

    clearOutbox();
    await restorePerson(USER, snapshot!);
    expect(row("persons", "watch")).toMatchObject({
      name: "İzlenen",
      deleted_at: null,
      tombstone_version: 1,
    });
    expect(JSON.parse(domainOutbox()[0]!.payload)).toMatchObject({
      id: "watch",
      user_id: USER,
      deleted_at: null,
      tombstone_version: 1,
    });
  });

  it("reports only live owned person references and refuses referenced deletion", async () => {
    seedPerson("watch");
    seedSource("watch-source", "cash", { personId: "watch" });
    seedSource("deleted-source", "cash", { personId: "watch", deletedAt: DELETED_AT });
    seedPlan("watch-plan", { personId: "watch" });
    seedTransaction("watch-tx", { personId: "watch" });
    seedSubscription("watch-sub", { personId: "watch" });
    seedRecurringIncome("watch-income", { personId: "watch" });
    seedRecurringIncome("deleted-income", { personId: "watch", deletedAt: DELETED_AT });
    seedRecurringIncome("foreign-income", { personId: "watch", userId: OTHER_USER });

    await expect(personReferenceUsage(USER, "watch")).resolves.toEqual({
      paymentSources: 1,
      installmentPlans: 1,
      transactions: 1,
      subscriptions: 1,
      recurringIncomes: 1,
      total: 5,
    });
    await expect(deleteUnreferencedPerson(USER, "watch")).rejects.toThrow("Record still has live references");
    expect(row("persons", "watch").deleted_at).toBeNull();
    expect(domainOutbox()).toEqual([]);
  });

  it("does not delete self, foreign, missing, or already deleted persons", async () => {
    seedPerson("foreign-watch", { userId: OTHER_USER });
    seedPerson("deleted-watch", { deletedAt: DELETED_AT });

    await expect(deleteUnreferencedPerson(USER, "self")).resolves.toBeNull();
    await expect(deleteUnreferencedPerson(USER, "foreign-watch")).resolves.toBeNull();
    await expect(deleteUnreferencedPerson(USER, "deleted-watch")).resolves.toBeNull();
    await expect(deleteUnreferencedPerson(USER, "missing")).resolves.toBeNull();

    expect(row("persons", "self").deleted_at).toBeNull();
    expect(row("persons", "foreign-watch").deleted_at).toBeNull();
    expect(row("persons", "deleted-watch").deleted_at).toBe(DELETED_AT);
    expect(domainOutbox()).toEqual([]);
  });

  it("reassigns every person reference atomically, tombstones the old owner, and awaits maintenance", async () => {
    seedPerson("watch");
    seedSource("watch-source", "cash", { personId: "watch" });
    seedPlan("watch-plan", { personId: "watch" });
    seedTransaction("watch-tx", { personId: "watch" });
    seedSubscription("watch-sub", { personId: "watch" });
    seedRecurringIncome("watch-income", { personId: "watch" });
    let releaseMaintenance!: () => void;
    harness.runMaintenance.mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseMaintenance = resolve;
    }));

    let settled = false;
    const reassignment = reassignAndDeletePerson(USER, "watch", "self").finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(harness.runMaintenance).toHaveBeenCalledWith(USER));

    expect(settled).toBe(false);
    expect(row("payment_sources", "watch-source").person_id).toBe("self");
    expect(row("installment_plans", "watch-plan").person_id).toBe("self");
    expect(row("transactions", "watch-tx").person_id).toBe("self");
    expect(row("subscriptions", "watch-sub").person_id).toBe("self");
    expect(row("recurring_incomes", "watch-income").person_id).toBe("self");
    expect(row("persons", "watch")).toMatchObject({
      deleted_at: expect.any(String),
      tombstone_version: 1,
    });
    expect(domainOutbox().map((entry) => entry.table_name)).toEqual([
      "payment_sources",
      "installment_plans",
      "transactions",
      "subscriptions",
      "recurring_incomes",
      "persons",
    ]);

    releaseMaintenance();
    await reassignment;
    expect(settled).toBe(true);
  });

  it("rejects same, missing, foreign, self-source, and missing-replacement person reassignment without writes", async () => {
    seedPerson("watch");
    seedPerson("foreign-watch", { userId: OTHER_USER });

    await expect(reassignAndDeletePerson(USER, "watch", "watch")).rejects.toThrow(
      "Replacement person must differ",
    );
    await expect(reassignAndDeletePerson(USER, "missing", "self")).rejects.toThrow("Person not found");
    await expect(reassignAndDeletePerson(USER, "foreign-watch", "self")).rejects.toThrow("Person not found");
    await expect(reassignAndDeletePerson(USER, "self", "watch")).rejects.toThrow("Person not found");
    await expect(reassignAndDeletePerson(USER, "watch", "missing")).rejects.toThrow("Person not found");

    expect(row("persons", "watch").deleted_at).toBeNull();
    expect(domainOutbox()).toEqual([]);
    expect(harness.runMaintenance).not.toHaveBeenCalled();
  });

  it("creates every payment-source type, clears non-card cycles, and repairs card links after persistence", async () => {
    const ids: string[] = [];
    for (const type of PAYMENT_SOURCE_TYPES) {
      const emptyCycle = type === "cash";
      ids.push(await upsertPaymentSource(USER, paymentInput({
        name: ` ${type} `,
        type,
        dueDay: emptyCycle ? null : 7,
        statementDay: emptyCycle ? null : 21,
      })));
    }

    expect(ids).toEqual(PAYMENT_SOURCE_TYPES.map((_, index) => `account-${String(index + 1).padStart(2, "0")}`));
    for (const [index, type] of PAYMENT_SOURCE_TYPES.entries()) {
      expect(row("payment_sources", ids[index]!)).toMatchObject({
        user_id: USER,
        name: type,
        type,
        person_id: "self",
        due_day: type === "credit_card" ? 7 : null,
        statement_day: type === "credit_card" ? 21 : null,
        color: null,
        logo_source: "initials",
        logo_ref: null,
        is_active: 1,
        deleted_at: null,
      });
    }
    expect(harness.repairCardStatementLinks).toHaveBeenCalledOnce();
    expect(harness.repairCardStatementLinks).toHaveBeenCalledWith(USER, "2026-08-13");
    expect(domainOutbox()).toHaveLength(PAYMENT_SOURCE_TYPES.length);
  });

  it("validates payment-source input, owner, type, and complete card cycles before any write", async () => {
    seedPerson("deleted-owner", { deletedAt: DELETED_AT });
    const invalid: { input: PaymentSourceInput; message: string }[] = [
      { input: paymentInput({ name: "   " }), message: "Payment source name and owner are required" },
      { input: paymentInput({ personId: "" }), message: "Payment source name and owner are required" },
      { input: paymentInput({ name: "x".repeat(121) }), message: "text input exceeds its maximum length" },
      { input: paymentInput({ type: "crypto" as PaymentSourceType }), message: "Invalid payment source type" },
      { input: paymentInput({ personId: "missing" }), message: "Payment source owner does not exist" },
      { input: paymentInput({ personId: "other-self" }), message: "Payment source owner does not exist" },
      { input: paymentInput({ personId: "deleted-owner" }), message: "Payment source owner does not exist" },
      {
        input: paymentInput({ type: "credit_card", statementDay: null, dueDay: 5 }),
        message: "Credit-card statement and due dates are required",
      },
      {
        input: paymentInput({ type: "credit_card", statementDay: 25, dueDay: 32 }),
        message: "Credit-card statement and due dates are required",
      },
    ];

    for (const { input, message } of invalid) {
      await expect(upsertPaymentSource(USER, input)).rejects.toThrow(message);
    }

    expect(liveCount("payment_sources")).toBe(0);
    expect(domainOutbox()).toEqual([]);
    expect(harness.repairCardStatementLinks).not.toHaveBeenCalled();
  });

  it("updates only a live owned source and preserves presentation fields", async () => {
    seedSource("styled", "cash", {
      color: "#123456",
      logoSource: "brand",
      logoRef: "bank-a",
      isActive: false,
      name: "Eski",
    });

    const id = await upsertPaymentSource(USER, paymentInput({
      id: "styled",
      name: "  Kartım  ",
      type: "credit_card",
      dueDay: 10,
      statementDay: 20,
    }));

    expect(id).toBe("styled");
    expect(row("payment_sources", "styled")).toMatchObject({
      name: "Kartım",
      type: "credit_card",
      person_id: "self",
      due_day: 10,
      statement_day: 20,
      color: "#123456",
      logo_source: "brand",
      logo_ref: "bank-a",
      is_active: 0,
      created_at: NOW,
      deleted_at: null,
    });
    expect(JSON.parse(domainOutbox()[0]!.payload)).toMatchObject({
      id: "styled",
      user_id: USER,
      color: "#123456",
      logo_source: "brand",
      logo_ref: "bank-a",
      is_active: false,
    });
    expect(harness.repairCardStatementLinks).toHaveBeenCalledWith(USER, "2026-08-13");
  });

  it("rejects missing, foreign, and tombstoned source updates without resurrection", async () => {
    seedSource("foreign-source", "cash", { userId: OTHER_USER });
    seedSource("deleted-source", "cash", { deletedAt: DELETED_AT });
    const foreignBefore = row("payment_sources", "foreign-source");
    const deletedBefore = row("payment_sources", "deleted-source");

    for (const id of ["missing-source", "foreign-source", "deleted-source"]) {
      await expect(upsertPaymentSource(USER, paymentInput({ id }))).rejects.toThrow(
        "Cannot edit missing payment_sources row",
      );
    }

    expect(row("payment_sources", "foreign-source")).toEqual(foreignBefore);
    expect(row("payment_sources", "deleted-source")).toEqual(deletedBefore);
    expect(domainOutbox()).toEqual([]);
    expect(harness.repairCardStatementLinks).not.toHaveBeenCalled();
  });

  it("does not resolve a credit-card upsert until post-write card-link repair completes", async () => {
    let releaseRepair!: () => void;
    harness.repairCardStatementLinks.mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseRepair = resolve;
    }));

    let settled = false;
    const upsert = upsertPaymentSource(USER, paymentInput({
      type: "credit_card",
      dueDay: 5,
      statementDay: 25,
    })).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(harness.repairCardStatementLinks).toHaveBeenCalledOnce());

    expect(row("payment_sources", "account-01")).toMatchObject({ type: "credit_card", deleted_at: null });
    expect(domainOutbox().map((entry) => entry.row_id)).toEqual(["account-01"]);
    expect(settled).toBe(false);

    releaseRepair();
    await expect(upsert).resolves.toBe("account-01");
    expect(settled).toBe(true);
  });

  it("counts live source references without double-counting the card-plan subset", async () => {
    seedSource("source");
    seedPlan("loan", { sourceId: "source", kind: "loan" });
    seedPlan("card-plan", { sourceId: "source", kind: "card_installment" });
    seedPlan("deleted-plan", { sourceId: "source", deletedAt: DELETED_AT });
    seedTransaction("source-tx", { sourceId: "source" });
    seedTransaction("deleted-tx", { sourceId: "source", deletedAt: DELETED_AT });
    seedSubscription("source-sub", { sourceId: "source" });
    seedSubscription("foreign-sub", { sourceId: "source", userId: OTHER_USER });

    await expect(paymentSourceReferenceUsage(USER, "source")).resolves.toEqual({
      installmentPlans: 2,
      cardInstallmentPlans: 1,
      transactions: 1,
      subscriptions: 1,
      total: 4,
    });
    await expect(deleteUnreferencedPaymentSource(USER, "source")).rejects.toThrow(
      "Record still has live references",
    );
    expect(row("payment_sources", "source").deleted_at).toBeNull();
    expect(domainOutbox()).toEqual([]);
  });

  it("deletes an unreferenced source with all live statements and restores the compound snapshot", async () => {
    seedSource("old-card", "credit_card", { name: "Eski kart" });
    seedStatement("statement-july", "old-card", "2026-07");
    seedStatement("statement-june", "old-card", "2026-06", { dueDate: "2026-07-05" });
    seedStatement("deleted-statement", "old-card", "2026-05", { deletedAt: DELETED_AT });

    const snapshot = await deleteUnreferencedPaymentSource(USER, "old-card");

    expect(snapshot?.source).toMatchObject({ id: "old-card", user_id: USER, deleted_at: null });
    expect(snapshot?.statements.map((statement) => statement.id).sort()).toEqual(["statement-july", "statement-june"].sort());
    for (const id of ["old-card", "statement-july", "statement-june"]) {
      expect(row(id === "old-card" ? "payment_sources" : "credit_card_statements", id)).toMatchObject({
        deleted_at: NOW,
        tombstone_version: 1,
      });
    }
    expect(row("credit_card_statements", "deleted-statement").deleted_at).toBe(DELETED_AT);
    expect(domainOutbox().map((entry) => [entry.table_name, entry.row_id])).toEqual([
      ["payment_sources", "old-card"],
      ...snapshot!.statements.map((statement) => ["credit_card_statements", String(statement.id)]),
    ]);

    clearOutbox();
    await restorePaymentSource(USER, snapshot!);
    expect(row("payment_sources", "old-card")).toMatchObject({ name: "Eski kart", deleted_at: null, tombstone_version: 1 });
    expect(row("credit_card_statements", "statement-july")).toMatchObject({ deleted_at: null, tombstone_version: 1 });
    expect(row("credit_card_statements", "statement-june")).toMatchObject({ deleted_at: null, tombstone_version: 1 });
    expect(row("credit_card_statements", "deleted-statement").deleted_at).toBe(DELETED_AT);
    expect(domainOutbox().map((entry) => [entry.table_name, entry.row_id])).toEqual([
      ["payment_sources", "old-card"],
      ...snapshot!.statements.map((statement) => ["credit_card_statements", String(statement.id)]),
    ]);
  });

  it("restores a legacy source-only snapshot and rejects a stale compound restore atomically", async () => {
    seedSource("legacy", "cash", { deletedAt: DELETED_AT, name: "Nakit" });
    const legacySnapshot = row("payment_sources", "legacy");
    await restorePaymentSource(USER, legacySnapshot);
    expect(row("payment_sources", "legacy")).toMatchObject({ name: "Nakit", deleted_at: null, tombstone_version: 1 });

    seedSource("compound", "credit_card", { deletedAt: DELETED_AT });
    seedStatement("compound-statement", "compound", "2026-07", { deletedAt: DELETED_AT });
    const compoundSnapshot = {
      source: row("payment_sources", "compound"),
      statements: [row("credit_card_statements", "compound-statement")],
    };
    harness.db!.prepare(
      "UPDATE credit_card_statements SET deleted_at = NULL WHERE id = 'compound-statement'",
    ).run();
    clearOutbox();

    await expect(restorePaymentSource(USER, compoundSnapshot)).rejects.toThrow(
      "Cannot restore credit_card_statements row without its tombstone",
    );
    expect(row("payment_sources", "compound").deleted_at).toBe(DELETED_AT);
    expect(row("credit_card_statements", "compound-statement").deleted_at).toBeNull();
    expect(domainOutbox()).toEqual([]);
  });

  it("treats only complete object-and-array wrappers as compound restore snapshots", async () => {
    await expect(restorePaymentSource(USER, {
      statements: [],
    })).rejects.toThrow("Cannot restore payment_sources row from another account");
    await expect(restorePaymentSource(USER, {
      source: row("persons", "self"),
      statements: "not-an-array",
    } as unknown as Parameters<typeof restorePaymentSource>[1])).rejects.toThrow(
      "Cannot restore payment_sources row from another account",
    );

    expect(domainOutbox()).toEqual([]);
  });

  it("returns null without writes for missing, foreign, and tombstoned source deletions", async () => {
    seedSource("foreign-source", "cash", { userId: OTHER_USER });
    seedSource("deleted-source", "cash", { deletedAt: DELETED_AT });

    await expect(deleteUnreferencedPaymentSource(USER, "missing")).resolves.toBeNull();
    await expect(deleteUnreferencedPaymentSource(USER, "foreign-source")).resolves.toBeNull();
    await expect(deleteUnreferencedPaymentSource(USER, "deleted-source")).resolves.toBeNull();

    expect(row("payment_sources", "foreign-source").deleted_at).toBeNull();
    expect(row("payment_sources", "deleted-source").deleted_at).toBe(DELETED_AT);
    expect(domainOutbox()).toEqual([]);
  });

  it.each([
    { label: "clears", replacementId: null, expectedSourceId: null },
    { label: "moves to non-card", replacementId: "cash", expectedSourceId: "cash" },
  ])("$label ordinary source references without rewriting historical dates", async ({ replacementId, expectedSourceId }) => {
    seedSource("old-card", "credit_card");
    if (replacementId) seedSource(replacementId, "cash", { statementDay: 25, dueDay: 5 });
    seedPlan("loan", { sourceId: "old-card", kind: "loan", dueDay: 17 });
    seedTransaction("pending", {
      sourceId: "old-card",
      purchaseDate: "2026-07-10",
      effectiveDate: "2026-08-05",
      status: "pending",
      cardStatementId: "old-statement",
    });
    seedTransaction("realized", {
      sourceId: "old-card",
      purchaseDate: "2026-06-10",
      effectiveDate: "2026-07-05",
      status: "realized",
      cardStatementId: "old-statement",
    });
    seedSubscription("subscription", { sourceId: "old-card" });
    seedStatement("old-statement", "old-card", "2026-07");

    await reassignAndDeletePaymentSource(USER, "old-card", replacementId);

    expect(row("installment_plans", "loan")).toMatchObject({
      payment_source_id: expectedSourceId,
      due_day: 17,
    });
    for (const [id, effectiveDate, status] of [
      ["pending", "2026-08-05", "pending"],
      ["realized", "2026-07-05", "realized"],
    ] as const) {
      expect(row("transactions", id)).toMatchObject({
        payment_source_id: expectedSourceId,
        purchase_date: null,
        effective_date: effectiveDate,
        status,
        card_statement_id: null,
      });
    }
    expect(row("subscriptions", "subscription").payment_source_id).toBe(expectedSourceId);
    expect(row("credit_card_statements", "old-statement")).toMatchObject({ deleted_at: NOW, tombstone_version: 1 });
    expect(row("payment_sources", "old-card")).toMatchObject({ deleted_at: NOW, tombstone_version: 1 });
  });

  it("requires a live valid credit-card replacement for card-installment plans", async () => {
    seedSource("old-card", "credit_card");
    seedSource("cash", "cash", { statementDay: 25, dueDay: 5 });
    seedSource("broken-card", "credit_card", { dueDay: null });
    seedSource("foreign-card", "credit_card", { userId: OTHER_USER });
    seedPlan("card-plan", { sourceId: "old-card", kind: "card_installment" });

    await expect(reassignAndDeletePaymentSource(USER, "old-card", null)).rejects.toThrow(
      "Credit-card statement and due dates are required",
    );
    await expect(reassignAndDeletePaymentSource(USER, "old-card", "cash")).rejects.toThrow(
      "Credit-card statement and due dates are required",
    );
    await expect(reassignAndDeletePaymentSource(USER, "old-card", "broken-card")).rejects.toThrow(
      "Credit-card statement and due dates are required",
    );
    await expect(reassignAndDeletePaymentSource(USER, "old-card", "foreign-card")).rejects.toThrow(
      "Payment source not found",
    );
    await expect(reassignAndDeletePaymentSource(USER, "old-card", "missing-card")).rejects.toThrow(
      "Payment source not found",
    );

    expect(row("payment_sources", "old-card").deleted_at).toBeNull();
    expect(row("installment_plans", "card-plan").payment_source_id).toBe("old-card");
    expect(domainOutbox()).toEqual([]);
  });

  it("relinks pending card expenses by purchase, old period, or due date while preserving historical rows", async () => {
    seedSource("old-card", "credit_card", { statementDay: 25, dueDay: 5 });
    seedSource("new-card", "credit_card", { statementDay: 20, dueDay: 10 });
    seedPlan("card-plan", { sourceId: "old-card", kind: "card_installment", dueDay: 5 });
    seedPlan("loan-plan", { sourceId: "old-card", kind: "loan", dueDay: 17 });
    seedSubscription("subscription", { sourceId: "old-card" });
    seedStatement("old-july", "old-card", "2026-07", {
      statementDate: "2026-07-25",
      dueDate: "2026-08-05",
    });
    seedStatement("old-june", "old-card", "2026-06", {
      statementDate: "2026-06-25",
      dueDate: "2026-07-05",
    });
    seedTransaction("purchase-future-a", {
      sourceId: "old-card",
      purchaseDate: "2026-08-21",
      effectiveDate: "2026-09-05",
      cardStatementId: "old-july",
    });
    seedTransaction("purchase-future-b", {
      sourceId: "old-card",
      purchaseDate: "2026-08-22",
      effectiveDate: "2026-09-05",
      cardStatementId: "old-july",
    });
    seedTransaction("purchase-due", {
      sourceId: "old-card",
      purchaseDate: "2026-07-10",
      effectiveDate: "2026-08-05",
      cardStatementId: "old-july",
    });
    seedTransaction("old-period", {
      sourceId: "old-card",
      purchaseDate: null,
      effectiveDate: "2026-09-10",
      cardStatementId: "old-july",
    });
    seedTransaction("due-fallback", {
      sourceId: "old-card",
      purchaseDate: null,
      effectiveDate: "2026-09-10",
      cardStatementId: null,
    });
    seedTransaction("due-today", {
      sourceId: "old-card",
      purchaseDate: "2026-07-10",
      effectiveDate: "2026-08-05",
      cardStatementId: "old-july",
    });
    seedTransaction("historical", {
      sourceId: "old-card",
      purchaseDate: "2026-06-10",
      effectiveDate: "2026-07-05",
      status: "realized",
      cardStatementId: "old-june",
    });
    seedTransaction("pending-income", {
      sourceId: "old-card",
      type: "income",
      purchaseDate: "2026-08-01",
      effectiveDate: "2026-08-20",
      cardStatementId: "old-july",
    });
    seedTransaction("aggregate", {
      sourceId: "old-card",
      purchaseDate: "2026-08-01",
      effectiveDate: "2026-08-20",
      cardStatementId: "old-july",
      isAggregate: true,
    });

    await reassignAndDeletePaymentSource(USER, "old-card", "new-card");

    expect(row("installment_plans", "card-plan")).toMatchObject({ payment_source_id: "new-card", due_day: 10 });
    expect(row("installment_plans", "loan-plan")).toMatchObject({ payment_source_id: "new-card", due_day: 17 });
    expect(row("subscriptions", "subscription").payment_source_id).toBe("new-card");
    for (const id of ["purchase-future-a", "purchase-future-b"]) {
      expect(row("transactions", id)).toMatchObject({
        payment_source_id: "new-card",
        purchase_date: id.endsWith("a") ? "2026-08-21" : "2026-08-22",
        effective_date: "2026-10-10",
        status: "pending",
        card_statement_id: `det:cardStatement|${USER}|new-card|2026-09`,
      });
    }
    expect(row("transactions", "purchase-due")).toMatchObject({
      payment_source_id: "new-card",
      purchase_date: "2026-07-10",
      effective_date: "2026-08-10",
      status: "realized",
      card_statement_id: `det:cardStatement|${USER}|new-card|2026-07`,
    });
    expect(row("transactions", "old-period")).toMatchObject({
      payment_source_id: "new-card",
      purchase_date: null,
      effective_date: "2026-08-10",
      status: "realized",
      card_statement_id: `det:cardStatement|${USER}|new-card|2026-07`,
    });
    expect(row("transactions", "due-fallback")).toMatchObject({
      payment_source_id: "new-card",
      purchase_date: null,
      effective_date: "2026-09-10",
      status: "pending",
      card_statement_id: `det:cardStatement|${USER}|new-card|2026-08`,
    });
    expect(row("transactions", "due-today")).toMatchObject({
      payment_source_id: "new-card",
      purchase_date: "2026-07-10",
      effective_date: "2026-08-10",
      status: "realized",
      card_statement_id: `det:cardStatement|${USER}|new-card|2026-07`,
    });
    for (const [id, effectiveDate, status] of [
      ["historical", "2026-07-05", "realized"],
      ["pending-income", "2026-08-20", "pending"],
      ["aggregate", "2026-08-20", "pending"],
    ] as const) {
      expect(row("transactions", id)).toMatchObject({
        payment_source_id: "new-card",
        purchase_date: null,
        effective_date: effectiveDate,
        status,
        card_statement_id: null,
      });
    }
    expect(harness.db!.prepare(
      "SELECT id, period_month, statement_date, due_date FROM credit_card_statements WHERE payment_source_id = ? AND deleted_at IS NULL ORDER BY period_month",
    ).all("new-card")).toEqual([
      {
        id: `det:cardStatement|${USER}|new-card|2026-07`,
        period_month: "2026-07",
        statement_date: "2026-07-20",
        due_date: "2026-08-10",
      },
      {
        id: `det:cardStatement|${USER}|new-card|2026-08`,
        period_month: "2026-08",
        statement_date: "2026-08-20",
        due_date: "2026-09-10",
      },
      {
        id: `det:cardStatement|${USER}|new-card|2026-09`,
        period_month: "2026-09",
        statement_date: "2026-09-20",
        due_date: "2026-10-10",
      },
    ]);
    expect(row("credit_card_statements", "old-july")).toMatchObject({ deleted_at: NOW, tombstone_version: 1 });
    expect(row("credit_card_statements", "old-june")).toMatchObject({ deleted_at: NOW, tombstone_version: 1 });
    expect(row("payment_sources", "old-card")).toMatchObject({ deleted_at: NOW, tombstone_version: 1 });
    expect(harness.cardStatementLookups).toBe(3);
  });

  it("realizes a reassigned card expense whose newly derived due date is today", async () => {
    seedSource("old-card", "credit_card", { statementDay: 25, dueDay: 5 });
    seedSource("new-card", "credit_card", { statementDay: 20, dueDay: 13 });
    seedTransaction("due-today-exact", {
      sourceId: "old-card",
      purchaseDate: "2026-07-10",
      effectiveDate: "2026-08-05",
      status: "pending",
    });

    await reassignAndDeletePaymentSource(USER, "old-card", "new-card");

    expect(row("transactions", "due-today-exact")).toMatchObject({
      payment_source_id: "new-card",
      purchase_date: "2026-07-10",
      effective_date: "2026-08-13",
      status: "realized",
      card_statement_id: `det:cardStatement|${USER}|new-card|2026-07`,
    });
  });

  it("no-ops missing-source reassignment and rejects identical replacements without writes", async () => {
    seedSource("source");

    await expect(reassignAndDeletePaymentSource(USER, "missing", null)).resolves.toBeUndefined();
    await expect(reassignAndDeletePaymentSource(USER, "source", "source")).rejects.toThrow(
      "Replacement source must differ",
    );

    expect(row("payment_sources", "source").deleted_at).toBeNull();
    expect(domainOutbox()).toEqual([]);
  });
});
