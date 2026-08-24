/**
 * Live data hooks. Drizzle live queries make every screen react to local
 * writes instantly (and to sync merges, via SQLite change events).
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { addDatabaseChangeListener } from "expo-sqlite";
import { and, asc, desc, eq, getTableColumns, gte, isNull, lte } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { useSession } from "../auth/session";
import { buildLedgerChain, ledgerChainEndYear, sliceLedgerYear, type LedgerBundle, type LedgerChain } from "../domain/balance";
import { projectInvestmentState } from "../domain/investment-projection";
import type { InvestmentState } from "../domain/investments";
import { daysBetweenISO, todayISO, type MonthKey } from "../domain/dates";
import type { TxLike } from "../domain/types";
import { devError } from "../services/logger";
import { decodeSettingValue, type SettingKey } from "../domain/settings";
import {
  combineLiveStates,
  completeLiveQuery,
  failLiveQuery,
  initialLiveSnapshot,
  readSyncedFlag,
  retryDelayMs,
  snapshotForParameters,
  startLiveQuery,
  type LiveSnapshot,
} from "./live-state";

interface LiveResult<T> extends LiveSnapshot<T[]> {
  data: T[];
  /** Immediately bypass the current backoff timer and try again. */
  retry: () => void;
}

interface LiveValueResult<T> extends LiveSnapshot<T> {
  retry: () => void;
}

/** Local-only tables that never sync to Supabase but still emit SQLite
 *  change events the live-query invalidation below listens for. */
type LocalTableName = "outbox" | "sync_dead_letters" | "sync_state";
/** Every table name a live query can scope its invalidation to. A raw
 *  `string` here still compiled on a typo'd table name, and a typo'd name
 *  never matches a change event — the screen silently stopped refreshing
 *  after a write. */
type TableScope = s.SyncedTableName | LocalTableName;

/**
 * The engine both live hooks run on: execute the query, re-run it (debounced)
 * when a relevant local table changes, and retry forever with capped backoff
 * instead of silently freezing a screen on empty data.
 *
 * Retrying forever is a deliberate decision, not an oversight: abandoning
 * after N tries left screens frozen on empty data (a wedged sqlite worker
 * never recovered, and route guards keyed off this query showed a permanent
 * blank screen). A failure preserves the last good data and exposes an
 * explicit error/stale state rather than asserting an empty result.
 *
 * `tables` scopes invalidation: only change events for those tables re-run the
 * query, so one write no longer re-executes every mounted live query (a
 * dashboard mounts ~10). Omit it to re-run on any change (safe fallback, also
 * used when the platform doesn't report the changed table).
 *
 * `apply` takes one of the pure transitions from `live-state.ts` and is the
 * *only* thing that differs between the two callers — React state for a
 * per-screen query, a module entry plus a notify for a shared one. They ran
 * two copies of everything above before, which is two places to fix a backoff
 * or a leak in.
 */
function startLiveQueryRunner<T>(
  query: () => PromiseLike<T[]>,
  tables: readonly TableScope[] | undefined,
  apply: (transition: (previous: LiveSnapshot<T[]>) => LiveSnapshot<T[]>) => void,
): { retry: () => void; stop: () => void } {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const run = (): void => {
    apply(startLiveQuery);
    query().then(
      (data) => {
        if (cancelled) return;
        attempt = 0;
        apply(() => completeLiveQuery(data, new Date()));
      },
      (error) => {
        if (cancelled) return;
        if (attempt < 3) devError("live-query", error);
        attempt += 1;
        apply((previous) => failLiveQuery(previous, attempt, new Date()));
        timer = setTimeout(run, retryDelayMs(attempt));
      },
    );
  };

  const listener = addDatabaseChangeListener((event) => {
    // Unknown table (or platform without table info) → conservative re-run.
    // event.tableName is a raw string from SQLite's update hook, not our
    // closed TableScope union, so the membership check must widen it back.
    if (tables && event?.tableName && !(tables as readonly string[]).includes(event.tableName)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 60); // coalesce bursts of change events
  });
  run();

  return {
    retry: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      run();
    },
    stop: () => {
      cancelled = true;
      listener.remove();
      if (timer) clearTimeout(timer);
    },
  };
}

/** Per-screen live query, parameterised by `deps` (a user, a month, a range). */
function useLive<T>(query: PromiseLike<T[]>, deps: unknown[], tables?: readonly TableScope[]): LiveResult<T> {
  const retryRef = useRef<() => void>(() => {});
  const retry = useCallback(() => retryRef.current(), []);
  const [state, setState] = useState<LiveResult<T>>({ ...initialLiveSnapshot<T[]>([]), retry });
  // Which question the snapshot in `state` actually answers. The effect below
  // also resets it, but effects run AFTER the render that changed `deps`, so
  // for exactly one render `state` would still hold the previous parameters'
  // answer — resolved `updatedAt` and all.
  const depsKey = JSON.stringify(deps ?? []);
  const [answeredDeps, setAnsweredDeps] = useState(depsKey);

  // The builder object is recreated every render, but it only *changes*
  // when deps change — the effect closure capturing it is deps-accurate,
  // and drizzle builders are re-executable.
  useEffect(() => {
    // This effect re-runs only when `deps` change, which means the query now
    // asks a DIFFERENT question (another user, month or account). The previous
    // answer is not a "last good snapshot" of it, so drop it: keeping it left
    // `updatedAt` reporting a completion that never happened for the new
    // parameters, and every consumer treating `updatedAt == null` as "still
    // resolving" then trusted a value belonging to the old parameters. The
    // route guard did exactly that and flashed onboarding at an existing
    // account after logout → login. Re-runs over the SAME parameters (local
    // writes, retries) still keep their data via `startLiveQuery`.
    setState({ ...initialLiveSnapshot<T[]>([]), retry });

    const runner = startLiveQueryRunner<T>(
      () => query,
      tables,
      (transition) => setState((previous) => ({ ...transition(previous), retry })),
    );
    retryRef.current = runner.retry;
    return () => {
      retryRef.current = () => {};
      runner.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Report "not resolved yet" for the new parameters in the same render that
  // changed them, and adjust the stored state so the next one agrees. React
  // sanctions this shape for deriving state from changed inputs, and it keeps
  // the rule out of a ref that the compiler must not see read during render.
  const pending: LiveResult<T> = { ...initialLiveSnapshot<T[]>([]), retry };
  const readable = snapshotForParameters(state, answeredDeps, depsKey, pending) as LiveResult<T>;
  if (readable !== state) {
    setAnsweredDeps(depsKey);
    setState(pending);
  }
  return readable;
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
 * `motion.ts` pattern). Parametric queries (month windows) stay on `useLive` —
 * caching per-argument results here would grow without bound.
 */
interface SharedLiveEntry {
  state: LiveResult<unknown>;
  listeners: Set<() => void>;
  teardown: () => void;
}

const noopRetry = () => {};
const EMPTY_LIVE: LiveResult<never> = { ...initialLiveSnapshot<never[]>([]), retry: noopRetry };
const sharedLive = new Map<string, SharedLiveEntry>();

function acquireSharedLive<T>(
  key: string,
  query: () => PromiseLike<T[]>,
  tables: readonly TableScope[],
): SharedLiveEntry {
  const existing = sharedLive.get(key);
  if (existing) return existing;
  // The runner emits its first transition synchronously, so both handles are
  // reached through the entry rather than captured from its return value.
  let runner: { retry: () => void; stop: () => void } | null = null;
  const retry = () => runner?.retry();
  const entry: SharedLiveEntry = {
    state: { ...initialLiveSnapshot<unknown[]>([]), retry },
    listeners: new Set(),
    teardown: () => {
      runner?.stop();
      sharedLive.delete(key);
    },
  };
  runner = startLiveQueryRunner<unknown>(query, tables, (transition) => {
    entry.state = { ...transition(entry.state), retry };
    for (const notify of entry.listeners) notify();
  });
  sharedLive.set(key, entry);
  return entry;
}

function useSharedLive<T>(key: string, query: () => PromiseLike<T[]>, tables: readonly TableScope[]): LiveResult<T> {
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

export function usePersonsState() {
  const userId = useUserId();
  return useSharedLive(
    `persons:${userId}`,
    () => getDb().select().from(s.persons).where(and(eq(s.persons.userId, userId), isNull(s.persons.deletedAt))),
    ["persons"],
  );
}

export function useCategoriesState() {
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
  );
}

export function useInvestmentProfilesState() {
  const userId = useUserId();
  return useSharedLive(
    `investment_profiles:${userId}`,
    () => getDb().select().from(s.investmentProfiles)
      .where(and(eq(s.investmentProfiles.userId, userId), isNull(s.investmentProfiles.deletedAt))),
    ["investment_profiles"],
  );
}

/** Includes tombstoned categories because their stable IDs still classify
 * historical investment transfers after a column is retired. */
export function useInvestmentCategoriesState() {
  const userId = useUserId();
  return useSharedLive(
    `investment_categories:${userId}`,
    () => getDb().select().from(s.categories).where(eq(s.categories.userId, userId)),
    ["categories"],
  );
}

export function useInvestmentProductsState() {
  const userId = useUserId();
  return useSharedLive(
    `investment_products:${userId}`,
    () => getDb().select().from(s.investmentProducts)
      .where(and(eq(s.investmentProducts.userId, userId), isNull(s.investmentProducts.deletedAt))),
    ["investment_products"],
  );
}

export function useInvestmentOperationsState() {
  const userId = useUserId();
  return useSharedLive(
    `investment_operations:${userId}`,
    () => getDb().select().from(s.investmentOperations)
      .where(and(eq(s.investmentOperations.userId, userId), isNull(s.investmentOperations.deletedAt)))
      .orderBy(asc(s.investmentOperations.operationDate), asc(s.investmentOperations.id)),
    ["investment_operations"],
  );
}

/** Local-only sync quarantine; userId scopes the shared subscription lifecycle. */
export function useSyncDeadLettersState() {
  const userId = useUserId();
  return useSharedLive(
    `sync_dead_letters:${userId}`,
    () => getDb().select({
      id: s.syncDeadLetters.id,
      tableName: s.syncDeadLetters.tableName,
      reason: s.syncDeadLetters.reason,
      quarantinedAt: s.syncDeadLetters.quarantinedAt,
    }).from(s.syncDeadLetters).orderBy(desc(s.syncDeadLetters.quarantinedAt)),
    ["sync_dead_letters"],
  );
}

export function useSourcesState() {
  const userId = useUserId();
  return useSharedLive(
    `payment_sources:${userId}`,
    () =>
      getDb()
        .select()
        .from(s.paymentSources)
        .where(and(eq(s.paymentSources.userId, userId), isNull(s.paymentSources.deletedAt))),
    ["payment_sources"],
  );
}

export function useSubscriptionsState() {
  const userId = useUserId();
  return useSharedLive(
    `subscriptions:${userId}`,
    () =>
      getDb()
        .select()
        .from(s.subscriptions)
        .where(and(eq(s.subscriptions.userId, userId), isNull(s.subscriptions.deletedAt))),
    ["subscriptions"],
  );
}

/**
 * Stored price changes for the cost summary.
 *
 * `upsertSubscription` has appended to this table on every price edit since it
 * existed; nothing read it back until the subscriptions screen reported what a
 * rule has cost over time.
 */
export function usePriceHistoryState() {
  const userId = useUserId();
  return useSharedLive(
    `price_history:${userId}`,
    () =>
      getDb()
        .select()
        .from(s.priceHistory)
        .where(and(eq(s.priceHistory.userId, userId), isNull(s.priceHistory.deletedAt)))
        .orderBy(asc(s.priceHistory.effectiveFrom)),
    ["price_history"],
  );
}

/** Documents kept beside a transaction. Metadata only — bytes stay local. */
export function useAttachmentsState() {
  const userId = useUserId();
  return useSharedLive(
    `attachments:${userId}`,
    () =>
      getDb()
        .select()
        .from(s.attachments)
        .where(and(eq(s.attachments.userId, userId), isNull(s.attachments.deletedAt)))
        .orderBy(asc(s.attachments.createdAt)),
    ["attachments"],
  );
}

/** Contextual colours placed on Mali Tablo rows, columns and cells. */
export function useMatrixColorsState() {
  const userId = useUserId();
  return useSharedLive(
    `matrix_colors:${userId}`,
    () =>
      getDb()
        .select()
        .from(s.matrixColors)
        .where(and(eq(s.matrixColors.userId, userId), isNull(s.matrixColors.deletedAt))),
    ["matrix_colors"],
  );
}

export function usePlansState() {
  const userId = useUserId();
  return useSharedLive(
    `installment_plans:${userId}`,
    () =>
      getDb()
        .select()
        .from(s.installmentPlans)
        .where(and(eq(s.installmentPlans.userId, userId), isNull(s.installmentPlans.deletedAt))),
    ["installment_plans"],
  );
}

export function useCreditCardStatementsState() {
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
  );
}

export function useRecurringIncomesState() {
  const userId = useUserId();
  return useSharedLive(
    `recurring_incomes:${userId}`,
    () =>
      getDb()
        .select()
        .from(s.recurringIncomes)
        .where(and(eq(s.recurringIncomes.userId, userId), isNull(s.recurringIncomes.deletedAt))),
    ["recurring_incomes"],
  );
}

export function useCategoryBudgetsState() {
  const userId = useUserId();
  return useSharedLive(
    `category_budgets:${userId}`,
    () =>
      // Budgets exist only for live categories: a soft-deleted category's
      // budgets are cascade-deleted, and any orphan arriving out-of-order via
      // sync must never surface as a nameless "budget" or join a total.
      getDb()
        .select({ ...getTableColumns(s.categoryBudgets) })
        .from(s.categoryBudgets)
        .innerJoin(
          s.categories,
          and(
            eq(s.categories.id, s.categoryBudgets.categoryId),
            eq(s.categories.userId, s.categoryBudgets.userId),
            isNull(s.categories.deletedAt),
          ),
        )
        .where(and(eq(s.categoryBudgets.userId, userId), isNull(s.categoryBudgets.deletedAt)))
        .orderBy(asc(s.categoryBudgets.month), asc(s.categoryBudgets.categoryId)),
    ["category_budgets", "categories"],
  );
}

export function useComputedColumnsState() {
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
  );
}

export function usePendingExpectedState() {
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
  );
}

export function useTransactionsBetweenState(from: string, to: string) {
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
  );
}

export function useAllTransactionsState() {
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
  );
}

export function useAdjustmentsState() {
  const userId = useUserId();
  return useSharedLive(
    `balance_adjustments:${userId}`,
    () =>
      getDb()
        .select()
        .from(s.balanceAdjustments)
        .where(and(eq(s.balanceAdjustments.userId, userId), isNull(s.balanceAdjustments.deletedAt))),
    ["balance_adjustments"],
  );
}

type SyncedBooleanSetting = "onboarded" | "account_frozen";

/** Shared live contract for the two synced boolean settings used by the root guard. */
function useSyncedBooleanSettingState(
  userId: string | null,
  key: SyncedBooleanSetting,
): LiveValueResult<boolean | null> {
  const res = useLive(
    getDb()
      .select()
      .from(s.settings)
      .where(and(eq(s.settings.userId, userId ?? ""), eq(s.settings.key, key), isNull(s.settings.deletedAt))),
    [userId],
    ["settings"],
  );
  if (!userId) return { data: null, status: "ready", error: null, updatedAt: res.updatedAt, retry: res.retry };
  return { ...res, data: readSyncedFlag(res, true) };
}

/**
 * Live onboarded flag for the route guard. Reactive on purpose: on a second
 * device the flag arrives via sync after sign-in, and the guard must lift
 * without an app restart. `null` = still resolving (or signed out).
 */
export function useOnboardedState(userId: string | null): LiveValueResult<boolean | null> {
  return useSyncedBooleanSettingState(userId, "onboarded");
}

/**
 * Live "account frozen" flag. Synced setting so a freeze on one device gates
 * every device. `null` while still resolving (or signed out) so the gate never
 * flashes before the real value is known.
 */
export function useAccountFrozenState(userId: string | null): LiveValueResult<boolean | null> {
  return useSyncedBooleanSettingState(userId, "account_frozen");
}

export function useSettingsMapState(): LiveValueResult<Map<string, string>> {
  const userId = useUserId();
  const result = useSharedLive(
    `settings:${userId}`,
    () => getDb().select().from(s.settings).where(and(eq(s.settings.userId, userId), isNull(s.settings.deletedAt))),
    ["settings"],
  );
  // Keyed on the rows, not on the render. A fresh Map per render is a fresh
  // identity, and every consumer memo that lists `settings` as a dependency —
  // `column_years`, the hidden-column set, the matrix model behind them — was
  // therefore guaranteed to miss.
  const data = useMemo(() => new Map(result.data.map((row) => [row.key, row.value])), [result.data]);
  return { ...result, data };
}

export function useCellNotesState(): LiveResult<typeof s.cellNotes.$inferSelect> {
  const userId = useUserId();
  return useSharedLive(
    `cell-notes:${userId}`,
    () => getDb().select().from(s.cellNotes)
      .where(and(eq(s.cellNotes.userId, userId), isNull(s.cellNotes.deletedAt))),
    ["cell_notes"],
  );
}

export function settingValue<T>(map: Map<string, string>, key: SettingKey, fallback: T): T {
  return decodeSettingValue(key, map.get(key), fallback);
}

/** Map DB transaction rows to the domain TxLike shape. */
function toTxLike(
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

/**
 * The account's transactions in domain shape — one owner, one identity.
 *
 * Every whole-account derivation (the ledger, the matrix model, the upcoming
 * timeline, budget progress) starts from this list, and each screen used to
 * build its own copy inline: one O(N) mapping per screen per RENDER, and a
 * fresh array identity that defeated every memo downstream of it.
 *
 * The cache is a module value rather than a `useMemo` because the tab
 * navigator keeps five screens mounted at once and they all ask the same
 * question. Its three inputs are shared live-query results, so identity
 * comparison is exact, and holding one entry means the answer is literally the
 * same array everywhere — a per-hook memo would still map the list once per
 * mounted screen and hand each one a different identity.
 */
let txLikeCache: {
  rows: unknown;
  persons: unknown;
  categories: unknown;
  value: TxLike[];
} | null = null;

export function useTxLike(): TxLike[] {
  const rows = useAllTransactionsState().data;
  const persons = usePersonsState().data;
  const categories = useCategoriesState().data;
  if (txLikeCache && txLikeCache.rows === rows && txLikeCache.persons === persons && txLikeCache.categories === categories) {
    return txLikeCache.value;
  }
  const value = toTxLike(rows, persons, categories);
  txLikeCache = { rows, persons, categories, value };
  return value;
}

/**
 * The investment wallet as it stands right now.
 *
 * Two screens project it from the same six sources — the wallet itself and
 * the refund form that spends from it — and both had the same twenty lines
 * inline. A projection that drifts between them is a wallet that shows one
 * cash figure and refuses a refund for a different one.
 *
 * A projection that throws is a wallet whose history cannot be replayed
 * (a sale before its purchase arrived, say). The snapshot keeps the last
 * verified wallet visible while the live sources converge and exposes the
 * failure so money-changing forms can pause honestly.
 */
export interface InvestmentWalletSnapshot {
  data: InvestmentState | null;
  error: unknown | null;
}

/**
 * Project the wallet without allowing a transient multi-query snapshot to
 * blank the screen. A valid previous projection remains visible while the six
 * live sources converge; the error is still returned so a caller can show a
 * stale notice and disable money-changing actions until retry succeeds.
 */
export function useInvestmentWalletSnapshot(): InvestmentWalletSnapshot {
  const userId = useUserId();
  const profile = useInvestmentProfilesState().data[0];
  const products = useInvestmentProductsState().data;
  const operations = useInvestmentOperationsState().data;
  const transactions = useAllTransactionsState().data;
  const categories = useInvestmentCategoriesState().data;
  const persons = usePersonsState().data;
  const lastGood = useRef<{ userId: string; data: InvestmentState } | null>(null);
  const snapshot = useMemo(() => {
    if (lastGood.current?.userId !== userId) lastGood.current = null;
    if (!profile) return { data: null, error: null };
    const selfPersonIds = new Set(persons.filter((person) => person.isSelf).map((person) => person.id));
    try {
      const data = projectInvestmentState(
        profile,
        products,
        operations,
        transactions.map((transaction) => ({
          ...transaction,
          personIsSelf: selfPersonIds.has(transaction.personId),
        })),
        categories,
      );
      lastGood.current = { userId, data };
      return { data, error: null };
    } catch (error) {
      return {
        data: lastGood.current?.userId === userId ? lastGood.current.data : null,
        error,
      };
    }
  }, [userId, profile, products, operations, transactions, categories, persons]);
  useEffect(() => {
    if (snapshot.error) devError("investment-projection", snapshot.error);
  }, [snapshot.error]);
  return snapshot;
}

/**
 * Same rationale as `txLikeCache` just above: the tab navigator keeps
 * Dashboard, Mali Tablo, item breakdown, `[month]` and others mounted at
 * once, and a per-hook `useMemo` rebuilt the whole chain once per mounted
 * screen on every write AND handed each screen a different `LedgerBundle`
 * identity, which invalidated every downstream memo built on it too. Keyed
 * on the exact inputs `buildLedgerChain` receives — note that's the raw
 * `adjustments` array (stable identity from the shared live query), not the
 * `{ date, amountMinor }` array mapped from it below, which is a fresh
 * identity every render and would never hit.
 *
 * Keyed by END YEAR rather than by the year on screen. The chain does not
 * depend on which year is being looked at: `buildLedger` walks every
 * transaction and chains every month from the anchor forward, and for any year
 * at or before the current one the result is identical whichever year the
 * screen shows — only the twelve-month slice differs. Keying by the year on
 * screen meant every step through history rebuilt the whole chain: measured at
 * 6x CPU throttle on a five-year, 3.000-row workspace, moving one year back
 * blocked the main thread for 208ms redoing arithmetic it already had.
 *
 * Bounded to the handful of end years that can be on screen at once (Dashboard
 * pins the current year while Mali Tablo's is selectable, and a user looking
 * ahead extends the chain) so it stays a cache, not a leak.
 */
const LEDGER_CACHE_LIMIT = 4;
type LedgerCacheEntry = { inputs: readonly unknown[]; value: LedgerChain | null };
const ledgerChainCache = new Map<number, LedgerCacheEntry>();

/**
 * Per-chain year slices, so stepping back to a year already visited returns
 * the SAME bundle object. A fresh identity would invalidate every memo the
 * screens build on it, which is the cost this cache exists to avoid.
 * `WeakMap`, so a chain that falls out of the cache above takes its slices
 * with it.
 */
const ledgerSliceCache = new WeakMap<LedgerChain, Map<number, LedgerBundle>>();

function sliceCacheFor(chain: LedgerChain): Map<number, LedgerBundle> {
  const existing = ledgerSliceCache.get(chain);
  if (existing) return existing;
  const created = new Map<number, LedgerBundle>();
  ledgerSliceCache.set(chain, created);
  return created;
}

export function useLedgerState(year: number): LiveValueResult<LedgerBundle | null> {
  const settingsState = useSettingsMapState();
  const personsState = usePersonsState();
  const categoriesState = useCategoriesState();
  const transactionsState = useAllTransactionsState();
  const adjustmentsState = useAdjustmentsState();
  const txLike = useTxLike();
  const settings = settingsState.data;
  const adjustments = adjustmentsState.data;
  const { status, error, updatedAt, retry } = combineLiveStates([
    settingsState,
    personsState,
    categoriesState,
    transactionsState,
    adjustmentsState,
  ]);

  const today = todayISO();
  const configuredStart = settingValue<MonthKey | null>(settings, "start_month", null);
  const openingBalanceMinor = settingValue<number>(settings, "opening_balance_minor", 0);
  const includePendingInCells = settingValue<boolean>(settings, "show_pending_in_table", true);
  const inputs = [configuredStart, openingBalanceMinor, includePendingInCells, txLike, adjustments, today] as const;
  const endYear = ledgerChainEndYear(year, today);
  const cached = ledgerChainCache.get(endYear);
  let chain: LedgerChain | null;
  if (cached && cached.inputs.length === inputs.length && cached.inputs.every((input, index) => input === inputs[index])) {
    chain = cached.value;
  } else {
    chain = buildLedgerChain({
      configuredStart,
      openingBalanceMinor,
      includePendingInCells,
      transactions: txLike,
      adjustments: adjustments.map((row) => ({ date: row.date, amountMinor: row.amountMinor })),
      endYear,
      today,
    });
    // Delete before set so the re-inserted entry moves to the end of Map's
    // insertion order, making the eviction below least-recently-used.
    ledgerChainCache.delete(endYear);
    ledgerChainCache.set(endYear, { inputs, value: chain });
    while (ledgerChainCache.size > LEDGER_CACHE_LIMIT) {
      const oldest = ledgerChainCache.keys().next();
      if (oldest.done) break;
      ledgerChainCache.delete(oldest.value);
    }
  }
  // The slice is a filter over months already computed, and it has to keep a
  // stable identity or every memo built on the bundle is invalidated again.
  const sliceCache = chain ? sliceCacheFor(chain) : null;
  let data: LedgerBundle | null = null;
  if (chain && sliceCache) {
    const hit = sliceCache.get(year);
    if (hit) data = hit;
    else {
      data = sliceLedgerYear(chain, year);
      sliceCache.set(year, data);
    }
  }
  return { data, status, error, updatedAt, retry };
}

export function useLastEntryInfoState(): LiveValueResult<{ at: string | null; daysAgo: number | null }> {
  const settingsState = useSettingsMapState();
  const iso = settingValue<string | null>(settingsState.data, "last_entry_at", null);
  if (!iso) return { ...settingsState, data: { at: null, daysAgo: null } };
  const date = iso.slice(0, 10);
  return { ...settingsState, data: { at: date, daysAgo: daysBetweenISO(date, todayISO()) } };
}
