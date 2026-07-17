/**
 * Live data hooks. Drizzle live queries make every screen react to local
 * writes instantly (and to sync merges, via SQLite change events).
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { addDatabaseChangeListener } from "expo-sqlite";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { useSession } from "../auth/session";
import { buildLedger, currentBalance, resolveLedgerAnchor, type MonthLedger } from "../domain/balance";
import { makeMonthKey, todayISO, yearOf, type MonthKey } from "../domain/dates";
import type { TxLike } from "../domain/types";
import { devError } from "../services/logger";

interface LiveResult<T> {
  data: T[];
  /** Undefined until the first query resolves — the "still loading" signal
   *  that separates an empty result from data that has not arrived yet. */
  updatedAt: Date | undefined;
}

/**
 * Live query over the async driver: runs the drizzle query, then re-runs it
 * (debounced) whenever a relevant local table changes. Failures are logged and
 * retried with backoff instead of silently freezing screens on empty data.
 *
 * `tables` scopes invalidation: only change events for those tables re-run the
 * query, so one write no longer re-executes every mounted live query (a
 * dashboard mounts ~10). Omit it to re-run on any change (safe fallback, also
 * used when the platform doesn't report the changed table).
 */
export function useLive<T>(query: PromiseLike<T[]>, deps: unknown[], tables?: readonly string[]): LiveResult<T> {
  const [state, setState] = useState<LiveResult<T>>({ data: [], updatedAt: undefined });

  // The builder object is recreated every render, but it only *changes*
  // when deps change — the effect closure capturing it is deps-accurate,
  // and drizzle builders are re-executable.
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = () => {
      query.then(
        (data) => {
          if (cancelled) return;
          attempt = 0;
          setState({ data, updatedAt: new Date() });
        },
        (error) => {
          if (cancelled) return;
          // Retry forever with capped backoff — a deliberate decision, not an
          // oversight: abandoning after N tries left screens frozen on empty
          // data (a wedged sqlite worker never recovered, and route guards
          // keyed off this query showed a permanent blank screen). Failures
          // never touch state, so screens keep the loading signal (or the
          // last good data) instead of asserting an empty result.
          if (attempt < 3) devError("live-query", error);
          const delay = Math.min(250 * 2 ** attempt++, 5000);
          timer = setTimeout(run, delay);
        },
      );
    };
    run();

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, 60); // coalesce bursts of change events
    };
    const listener = addDatabaseChangeListener((event) => {
      // Unknown table (or platform without table info) → conservative re-run.
      if (tables && event?.tableName && !tables.includes(event.tableName)) return;
      schedule();
    });
    return () => {
      cancelled = true;
      listener.remove();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

export function useUserId(): string {
  const userId = useSession((st) => st.userId);
  if (!userId) throw new Error("useUserId used outside an authenticated screen");
  return userId;
}

/**
 * Shared live queries for the identity-stable hooks below. Several screens
 * stay mounted at once under the tab navigator, and before sharing each of
 * them ran its OWN copy of the same query — one write re-executed the full
 * transactions scan once per mounted screen. An entry is created by the first
 * subscriber, reference-counted, and torn down with the last one (the
 * `motion.ts` pattern); run/debounce/backoff semantics match `useLive`.
 * Parametric queries (month windows) stay on `useLive` — caching per-argument
 * results here would grow without bound.
 */
interface SharedLiveEntry {
  state: LiveResult<unknown>;
  listeners: Set<() => void>;
  teardown: () => void;
}

const EMPTY_LIVE: LiveResult<never> = { data: [], updatedAt: undefined };
const sharedLive = new Map<string, SharedLiveEntry>();

function acquireSharedLive<T>(
  key: string,
  query: () => PromiseLike<T[]>,
  tables: readonly string[],
): SharedLiveEntry {
  const existing = sharedLive.get(key);
  if (existing) return existing;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  const entry: SharedLiveEntry = {
    state: EMPTY_LIVE,
    listeners: new Set(),
    teardown: () => {
      cancelled = true;
      listener.remove();
      if (timer) clearTimeout(timer);
      sharedLive.delete(key);
    },
  };
  const run = () => {
    query().then(
      (data) => {
        if (cancelled) return;
        attempt = 0;
        entry.state = { data, updatedAt: new Date() };
        for (const notify of entry.listeners) notify();
      },
      (error) => {
        if (cancelled) return;
        // Same retry-forever rationale as useLive below.
        if (attempt < 3) devError("live-query", error);
        const delay = Math.min(250 * 2 ** attempt++, 5000);
        timer = setTimeout(run, delay);
      },
    );
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 60);
  };
  const listener = addDatabaseChangeListener((event) => {
    if (event?.tableName && !tables.includes(event.tableName)) return;
    schedule();
  });
  run();
  sharedLive.set(key, entry);
  return entry;
}

function useSharedLive<T>(key: string, query: () => PromiseLike<T[]>, tables: readonly string[]): LiveResult<T> {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const entry = acquireSharedLive(key, query, tables);
      entry.listeners.add(onChange);
      return () => {
        entry.listeners.delete(onChange);
        if (entry.listeners.size === 0) entry.teardown();
      };
    },
    // query/tables are fixed for a given key (first subscriber wins), so the
    // key alone drives resubscription — mirroring useLive's deps contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return useSyncExternalStore(
    subscribe,
    () => (sharedLive.get(key)?.state ?? EMPTY_LIVE) as LiveResult<T>,
    () => EMPTY_LIVE as LiveResult<T>,
  );
}

export function usePersons() {
  const userId = useUserId();
  return useSharedLive(
    `persons:${userId}`,
    () => getDb().select().from(s.persons).where(and(eq(s.persons.userId, userId), isNull(s.persons.deletedAt))),
    ["persons"],
  ).data;
}

export function useCategories() {
  const userId = useUserId();
  return useSharedLive(
    `categories:${userId}`,
    () =>
      getDb()
        .select()
        .from(s.categories)
        .where(and(eq(s.categories.userId, userId), isNull(s.categories.deletedAt)))
        .orderBy(asc(s.categories.sortOrder)),
    ["categories"],
  ).data;
}

export function useSources() {
  const userId = useUserId();
  return useSharedLive(
    `payment_sources:${userId}`,
    () =>
      getDb()
        .select()
        .from(s.paymentSources)
        .where(and(eq(s.paymentSources.userId, userId), isNull(s.paymentSources.deletedAt))),
    ["payment_sources"],
  ).data;
}

export function useSubscriptions() {
  const userId = useUserId();
  return useSharedLive(
    `subscriptions:${userId}`,
    () =>
      getDb()
        .select()
        .from(s.subscriptions)
        .where(and(eq(s.subscriptions.userId, userId), isNull(s.subscriptions.deletedAt))),
    ["subscriptions"],
  ).data;
}

export function usePlans() {
  const userId = useUserId();
  return useSharedLive(
    `installment_plans:${userId}`,
    () =>
      getDb()
        .select()
        .from(s.installmentPlans)
        .where(and(eq(s.installmentPlans.userId, userId), isNull(s.installmentPlans.deletedAt))),
    ["installment_plans"],
  ).data;
}

export function useCreditCardStatements() {
  const userId = useUserId();
  return useSharedLive(
    `credit_card_statements:${userId}`,
    () =>
      getDb()
        .select()
        .from(s.creditCardStatements)
        .where(and(eq(s.creditCardStatements.userId, userId), isNull(s.creditCardStatements.deletedAt)))
        .orderBy(asc(s.creditCardStatements.dueDate)),
    ["credit_card_statements"],
  ).data;
}

export function useRecurringIncomes() {
  const userId = useUserId();
  return useSharedLive(
    `recurring_incomes:${userId}`,
    () =>
      getDb()
        .select()
        .from(s.recurringIncomes)
        .where(and(eq(s.recurringIncomes.userId, userId), isNull(s.recurringIncomes.deletedAt))),
    ["recurring_incomes"],
  ).data;
}

export function useComputedColumns() {
  const userId = useUserId();
  return useSharedLive(
    `computed_columns:${userId}`,
    () =>
      getDb()
        .select()
        .from(s.computedColumns)
        .where(and(eq(s.computedColumns.userId, userId), isNull(s.computedColumns.deletedAt)))
        .orderBy(asc(s.computedColumns.sortOrder)),
    ["computed_columns"],
  ).data;
}

export function usePendingExpected() {
  const userId = useUserId();
  return useSharedLive(
    `expected_payments:${userId}`,
    () =>
      getDb()
        .select()
        .from(s.expectedPayments)
        .where(and(eq(s.expectedPayments.userId, userId), isNull(s.expectedPayments.deletedAt)))
        .orderBy(asc(s.expectedPayments.dueDate)),
    ["expected_payments"],
  ).data;
}

export function useTransactionsBetween(from: string, to: string) {
  const userId = useUserId();
  return useLive(
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
    ["transactions"],
  ).data;
}

export function useAllTransactions() {
  const userId = useUserId();
  return useSharedLive(
    `transactions:${userId}`,
    () =>
      getDb()
        .select()
        .from(s.transactions)
        .where(and(eq(s.transactions.userId, userId), isNull(s.transactions.deletedAt)))
        .orderBy(asc(s.transactions.effectiveDate)),
    ["transactions"],
  ).data;
}

export function useAdjustments() {
  const userId = useUserId();
  return useSharedLive(
    `balance_adjustments:${userId}`,
    () =>
      getDb()
        .select()
        .from(s.balanceAdjustments)
        .where(and(eq(s.balanceAdjustments.userId, userId), isNull(s.balanceAdjustments.deletedAt))),
    ["balance_adjustments"],
  ).data;
}

/**
 * Live onboarded flag for the route guard. Reactive on purpose: on a second
 * device the flag arrives via sync after sign-in, and the guard must lift
 * without an app restart. `null` = still resolving (or signed out).
 */
export function useOnboarded(userId: string | null): boolean | null {
  const res = useLive(
    getDb()
      .select()
      .from(s.settings)
      .where(and(eq(s.settings.userId, userId ?? ""), eq(s.settings.key, "onboarded"), isNull(s.settings.deletedAt))),
    [userId],
    ["settings"],
  );
  if (!userId) return null;
  if (res.updatedAt == null) return null; // first query still in flight
  try {
    return JSON.parse(res.data[0]?.value ?? "false") === true;
  } catch {
    return false;
  }
}

/**
 * Live "account frozen" flag. Synced setting so a freeze on one device gates
 * every device. `null` while still resolving (or signed out) so the gate never
 * flashes before the real value is known.
 */
export function useAccountFrozen(userId: string | null): boolean | null {
  const res = useLive(
    getDb()
      .select()
      .from(s.settings)
      .where(and(eq(s.settings.userId, userId ?? ""), eq(s.settings.key, "account_frozen"), isNull(s.settings.deletedAt))),
    [userId],
    ["settings"],
  );
  if (!userId) return null;
  if (res.updatedAt == null) return null;
  try {
    return JSON.parse(res.data[0]?.value ?? "false") === true;
  } catch {
    return false;
  }
}

export function useSettingsMap(): Map<string, string> {
  const userId = useUserId();
  const rows = useSharedLive(
    `settings:${userId}`,
    () => getDb().select().from(s.settings).where(and(eq(s.settings.userId, userId), isNull(s.settings.deletedAt))),
    ["settings"],
  ).data;
  return new Map(rows.map((r) => [r.key, r.value]));
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
  categories: (typeof s.categories.$inferSelect)[],
): TxLike[] {
  const selfIds = new Set(persons.filter((p) => p.isSelf).map((p) => p.id));
  const categoryKinds = new Map(categories.map((category) => [category.id, category.kind]));
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    amountTryMinor: r.amountTryMinor,
    purchaseDate: r.purchaseDate,
    effectiveDate: r.effectiveDate,
    status: r.status,
    categoryId: r.categoryId,
    categoryKind: r.categoryId ? categoryKinds.get(r.categoryId) ?? null : null,
    paymentSourceId: r.paymentSourceId,
    personIsSelf: selfIds.has(r.personId),
    installmentPlanId: r.installmentPlanId,
    cardStatementId: r.cardStatementId,
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
  const categories = useCategories();
  const transactions = useAllTransactions();
  const adjustments = useAdjustments();

  const configuredStart = settingValue<string | null>(settings, "start_month", null);
  if (!configuredStart) return null;
  const openingBalanceMinor = settingValue<number>(settings, "opening_balance_minor", 0);
  const includePendingInCells = settingValue<boolean>(settings, "show_pending_in_table", true);
  const today = todayISO();
  const txLike = toTxLike(transactions, persons, categories);
  const adj = adjustments.map((a) => ({ date: a.date, amountMinor: a.amountMinor }));

  // Extend the ledger back to the earliest recorded data so history entered
  // before the configured opening month (e.g. a 2025 row) still appears.
  const { startMonth, openingBalanceMinor: openingAtStart } = resolveLedgerAnchor(
    configuredStart,
    openingBalanceMinor,
    txLike,
    adj,
    today,
  );

  const endMonth = makeMonthKey(Math.max(year, yearOf(today)), 12);
  const ledger = buildLedger({
    openingBalanceMinor: openingAtStart,
    startMonth,
    endMonth,
    transactions: txLike,
    adjustments: adj,
    today,
    includePendingInCells,
  });
  const actualBalanceMinor = currentBalance({
    openingBalanceMinor: openingAtStart,
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
