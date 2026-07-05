/**
 * Live data hooks. Drizzle live queries make every screen react to local
 * writes instantly (and to sync merges, via SQLite change events).
 */

import { useMemo } from "react";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { useSession } from "../auth/session";
import { buildLedger, currentBalance, type MonthLedger } from "../domain/balance";
import { addMonthsToKey, firstDayOf, lastDayOf, makeMonthKey, todayISO, yearOf, type MonthKey } from "../domain/dates";
import type { TxLike } from "../domain/types";
import { readSetting } from "../db/mutations";

export function useUserId(): string {
  const userId = useSession((st) => st.userId);
  if (!userId) throw new Error("useUserId used outside an authenticated screen");
  return userId;
}

export function usePersons() {
  const userId = useUserId();
  return useLiveQuery(
    getDb().select().from(s.persons).where(and(eq(s.persons.userId, userId), isNull(s.persons.deletedAt))),
    [userId],
  ).data;
}

export function useCategories() {
  const userId = useUserId();
  return useLiveQuery(
    getDb()
      .select()
      .from(s.categories)
      .where(and(eq(s.categories.userId, userId), isNull(s.categories.deletedAt)))
      .orderBy(asc(s.categories.sortOrder)),
    [userId],
  ).data;
}

export function useSources() {
  const userId = useUserId();
  return useLiveQuery(
    getDb()
      .select()
      .from(s.paymentSources)
      .where(and(eq(s.paymentSources.userId, userId), isNull(s.paymentSources.deletedAt))),
    [userId],
  ).data;
}

export function useSubscriptions() {
  const userId = useUserId();
  return useLiveQuery(
    getDb()
      .select()
      .from(s.subscriptions)
      .where(and(eq(s.subscriptions.userId, userId), isNull(s.subscriptions.deletedAt))),
    [userId],
  ).data;
}

export function usePlans() {
  const userId = useUserId();
  return useLiveQuery(
    getDb()
      .select()
      .from(s.installmentPlans)
      .where(and(eq(s.installmentPlans.userId, userId), isNull(s.installmentPlans.deletedAt))),
    [userId],
  ).data;
}

export function useRecurringIncomes() {
  const userId = useUserId();
  return useLiveQuery(
    getDb()
      .select()
      .from(s.recurringIncomes)
      .where(and(eq(s.recurringIncomes.userId, userId), isNull(s.recurringIncomes.deletedAt))),
    [userId],
  ).data;
}

export function useComputedColumns() {
  const userId = useUserId();
  return useLiveQuery(
    getDb()
      .select()
      .from(s.computedColumns)
      .where(and(eq(s.computedColumns.userId, userId), isNull(s.computedColumns.deletedAt)))
      .orderBy(asc(s.computedColumns.sortOrder)),
    [userId],
  ).data;
}

export function usePendingExpected() {
  const userId = useUserId();
  return useLiveQuery(
    getDb()
      .select()
      .from(s.expectedPayments)
      .where(and(eq(s.expectedPayments.userId, userId), isNull(s.expectedPayments.deletedAt)))
      .orderBy(asc(s.expectedPayments.dueDate)),
    [userId],
  ).data;
}

export function useTransactionsBetween(from: string, to: string) {
  const userId = useUserId();
  return useLiveQuery(
    getDb()
      .select()
      .from(s.transactions)
      .where(
        and(
          eq(s.transactions.userId, userId),
          isNull(s.transactions.deletedAt),
          gte(s.transactions.effectiveDate, from),
          lte(s.transactions.effectiveDate, to),
        ),
      )
      .orderBy(asc(s.transactions.effectiveDate)),
    [userId, from, to],
  ).data;
}

export function useAllTransactions() {
  const userId = useUserId();
  return useLiveQuery(
    getDb()
      .select()
      .from(s.transactions)
      .where(and(eq(s.transactions.userId, userId), isNull(s.transactions.deletedAt)))
      .orderBy(asc(s.transactions.effectiveDate)),
    [userId],
  ).data;
}

export function useAdjustments() {
  const userId = useUserId();
  return useLiveQuery(
    getDb()
      .select()
      .from(s.balanceAdjustments)
      .where(and(eq(s.balanceAdjustments.userId, userId), isNull(s.balanceAdjustments.deletedAt))),
    [userId],
  ).data;
}

export function useSettingsMap(): Map<string, string> {
  const userId = useUserId();
  const rows = useLiveQuery(
    getDb().select().from(s.settings).where(and(eq(s.settings.userId, userId), isNull(s.settings.deletedAt))),
    [userId],
  ).data;
  return useMemo(() => new Map(rows.map((r) => [r.key, r.value])), [rows]);
}

export function settingValue<T>(map: Map<string, string>, key: string, fallback: T): T {
  const raw = map.get(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Map DB transaction rows to the domain TxLike shape. */
export function toTxLike(
  rows: (typeof s.transactions.$inferSelect)[],
  persons: (typeof s.persons.$inferSelect)[],
): TxLike[] {
  const selfIds = new Set(persons.filter((p) => p.isSelf).map((p) => p.id));
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    amountTryMinor: r.amountTryMinor,
    effectiveDate: r.effectiveDate,
    status: r.status,
    categoryId: r.categoryId,
    paymentSourceId: r.paymentSourceId,
    personIsSelf: selfIds.has(r.personId),
    installmentPlanId: r.installmentPlanId,
    subscriptionId: r.subscriptionId,
    isAggregate: r.isAggregate,
  }));
}

export interface LedgerBundle {
  ledger: MonthLedger[];
  yearMonths: MonthLedger[];
  startMonth: MonthKey;
  actualBalanceMinor: number;
  txLike: TxLike[];
}

/** Full chained ledger from start month through the requested year. */
export function useLedger(year: number): LedgerBundle | null {
  const settings = useSettingsMap();
  const persons = usePersons();
  const transactions = useAllTransactions();
  const adjustments = useAdjustments();

  return useMemo(() => {
    const startMonth = settingValue<string | null>(settings, "start_month", null);
    if (!startMonth) return null;
    const openingBalanceMinor = settingValue<number>(settings, "opening_balance_minor", 0);
    const today = todayISO();
    const txLike = toTxLike(transactions, persons);
    const adj = adjustments.map((a) => ({ date: a.date, amountMinor: a.amountMinor }));
    const endMonth = makeMonthKey(Math.max(year, yearOf(todayISO())), 12);
    const ledger = buildLedger({
      openingBalanceMinor,
      startMonth,
      endMonth,
      transactions: txLike,
      adjustments: adj,
      today,
    });
    const actualBalanceMinor = currentBalance({
      openingBalanceMinor,
      startMonth,
      transactions: txLike,
      adjustments: adj,
      today,
    });
    return {
      ledger,
      yearMonths: ledger.filter((m) => yearOf(m.month) === year),
      startMonth,
      actualBalanceMinor,
      txLike,
    };
  }, [settings, persons, transactions, adjustments, year]);
}

/** Days between two ISO dates (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86_400_000);
}

export function useLastEntryInfo(): { at: string | null; daysAgo: number | null } {
  const settings = useSettingsMap();
  const iso = settingValue<string | null>(settings, "last_entry_at", null);
  if (!iso) return { at: null, daysAgo: null };
  const date = iso.slice(0, 10);
  return { at: date, daysAgo: daysBetween(date, todayISO()) };
}

export { readSetting, addMonthsToKey, firstDayOf, lastDayOf };
