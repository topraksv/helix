/**
 * Live data hooks. Drizzle live queries make every screen react to local
 * writes instantly (and to sync merges, via SQLite change events).
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { addDatabaseChangeListener } from "expo-sqlite";
import { and, asc, desc, eq, getTableColumns, isNull, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { useSession } from "../auth/session";
import { buildLedgerChain, ledgerChainEndYear, sliceLedgerYear, type LedgerBundle, type LedgerChain } from "../domain/balance";
import type { classifyRecordId } from "../domain/route-params";
import { projectInvestmentState } from "../domain/investment-projection";
import type { InvestmentState } from "../domain/investments";
import { todayISO, type ISODate, type MonthKey } from "../domain/dates";
import { autoConfirmedTransactionIds, plannedExpectations, type PlannedExpectation } from "../domain/expected";
import { convertToTryMinor } from "../domain/fx";
import type { TxLike } from "../domain/types";
import { isWorkbookRemainderRow } from "../domain/transactions";
import { settleCardStatements, type CardSettlement } from "../domain/card-statements";
import { devError } from "../services/logger";
import { lookupRate, useFxRates } from "../services/fx-fetch";
import { marketSellRateTry } from "../services/markets";
import { decodeSettingValue, type SettingKey } from "../domain/settings";
import { balanceColumnLabel, type StoredBalanceColumns } from "../domain/matrix-preferences";
import { tr } from "../i18n/tr";
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

/**
 * Whether a live query has answered the question a screen is asking about ONE id, not merely
 * whether it has ever run. Record screens read an unparameterised query (every transaction), so a
 * completion from BEFORE a row was written would read as "the row does not exist". The proof is
 * therefore dated against the moment the screen began asking; the single `retry` keeps that
 * terminating, since a row that never existed triggers no change event.
 */
export function useAnsweredForId(
  state: { updatedAt: Date | undefined; retry: () => void },
  /** What the route asked for. A "new" record looks nothing up. */
  record: RecordId,
  /** Whether the row is already in hand; a found row needs no further proof. */
  found: boolean,
): boolean {
  const id = record?.mode === "edit" ? record.id : null;
  // Dated against the query's own completions, not a clock: each stamps a fresh `Date`, so this is
  // an identity comparison that stays pure during render.
  const [asked, setAsked] = useState<{ id: string | null; seen: Date | undefined }>(
    { id, seen: state.updatedAt },
  );
  if (asked.id !== id) setAsked({ id, seen: state.updatedAt });
  const answered = state.updatedAt != null && state.updatedAt !== asked.seen;
  const { retry } = state;
  useEffect(() => {
    if (id != null && !found && !answered) retry();
  }, [id, found, answered, retry]);
  return answered;
}

/** What `classifyRecordId` answers: a new record, one by id, or a bad route. */
type RecordId = ReturnType<typeof classifyRecordId>;

interface LiveValueResult<T> extends LiveSnapshot<T> {
  retry: () => void;
}

/** Local-only tables that never sync to Supabase but still emit SQLite
 *  change events the live-query invalidation below listens for. */
type LocalTableName = "outbox" | "sync_dead_letters" | "sync_state";
/** A raw `string` would compile with a typo'd name, which never matches a change event. */
type TableScope = s.SyncedTableName | LocalTableName;

/**
 * The engine both live hooks run on: execute the query, re-run it (debounced) when a relevant
 * table changes, and retry forever with capped backoff. Retrying forever is deliberate: giving up
 * left screens blank behind a wedged sqlite worker. A failure keeps the last good data and exposes
 * an error/stale state rather than an empty result.
 *
 * `tables` scopes invalidation to those tables; omit it to re-run on any change.
 * `apply` takes a pure transition from `live-state.ts`; it is all that differs between callers.
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
        if (timer) clearTimeout(timer);
        timer = setTimeout(run, retryDelayMs(attempt));
      },
    );
  };

  const listener = addDatabaseChangeListener((event) => {
    // Unknown table (or platform without table info) re-runs; `tableName` is a raw string, so widen the union.
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
  // Which question `state` answers: the effect below resets it too late, one render after `deps` change.
  const depsKey = JSON.stringify(deps ?? []);
  const [answeredDeps, setAnsweredDeps] = useState(depsKey);

  // The builder is recreated every render but only changes with `deps`, and drizzle builders are re-executable.
  useEffect(() => {
    // New `deps` ask a different question: drop the old answer, or `updatedAt` would claim a
    // completion that never happened for them. Re-runs over the same parameters keep their data.
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

  // Report "not resolved yet" in the render that changed the parameters, and adjust the stored state to agree.
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
 * Shared live queries for the identity-stable hooks below: the tab navigator keeps several
 * screens mounted, and each would otherwise re-run the same query. An entry is created by the
 * first subscriber, reference-counted, and torn down with the last. Parametric queries stay on
 * `useLive`; caching per argument here would grow without bound.
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
  // The runner emits its first transition synchronously, so the handles are reached through the entry.
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
    const next = transition(entry.state);
    if (next === entry.state) return;
    entry.state = { ...next, retry };
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
    // query/tables are fixed for a key (first subscriber wins), so the key alone drives resubscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return useSyncExternalStore(
    subscribe,
    () => (sharedLive.get(key)?.state ?? EMPTY_LIVE) as LiveResult<T>,
    () => EMPTY_LIVE as LiveResult<T>,
  );
}

type LiveTable = SQLiteTable & { userId: SQLiteColumn; deletedAt: SQLiteColumn };

/** A user's live rows of one table, shared under `${key}:${userId}`; `key` defaults to the table name. */
function useLiveTable<T extends LiveTable>(
  table: T,
  name: s.SyncedTableName,
  order: SQL[] = [],
  key: string = name,
): LiveResult<T["$inferSelect"]> {
  const userId = useUserId();
  return useSharedLive(
    `${key}:${userId}`,
    () => {
      const rows = getDb().select().from(table as LiveTable)
        .where(and(eq(table.userId, userId), isNull(table.deletedAt)));
      return (order.length ? rows.orderBy(...order) : rows) as PromiseLike<T["$inferSelect"][]>;
    },
    [name],
  );
}

export function usePersonsState() {
  return useLiveTable(s.persons, "persons");
}

export function useCategoriesState() {
  return useLiveTable(s.categories, "categories", [asc(s.categories.sortOrder)]);
}

export function useInvestmentProfilesState() {
  return useLiveTable(s.investmentProfiles, "investment_profiles");
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
  return useLiveTable(s.investmentProducts, "investment_products");
}

export function useInvestmentOperationsState() {
  return useLiveTable(s.investmentOperations, "investment_operations", [asc(s.investmentOperations.operationDate), asc(s.investmentOperations.id)]);
}

/** Everything the wallet's figures are drawn from, answered together: the investments screen and its correction read the same six. */
export function useInvestmentWorkspaceState() {
  const profilesState = useInvestmentProfilesState();
  const productsState = useInvestmentProductsState();
  const operationsState = useInvestmentOperationsState();
  const transactionsState = useAllTransactionsState();
  const categoriesState = useInvestmentCategoriesState();
  const personsState = usePersonsState();
  const group = combineLiveStates([profilesState, productsState, operationsState, transactionsState, categoriesState, personsState]);
  return { profilesState, productsState, operationsState, transactionsState, categoriesState, personsState, ...group };
}

/** Local-only sync quarantine; userId scopes the shared subscription lifecycle. */
export function useSyncDeadLettersState() {
  const userId = useUserId();
  return useSharedLive(
    `sync_dead_letters:${userId}`,
    // The payload lets the list name the record, not just its table.
    () => getDb().select({
      id: s.syncDeadLetters.id,
      tableName: s.syncDeadLetters.tableName,
      reason: s.syncDeadLetters.reason,
      payload: s.syncDeadLetters.payload,
      quarantinedAt: s.syncDeadLetters.quarantinedAt,
    }).from(s.syncDeadLetters).orderBy(desc(s.syncDeadLetters.quarantinedAt)),
    ["sync_dead_letters"],
  );
}

export function useSourcesState() {
  return useLiveTable(s.paymentSources, "payment_sources");
}

export function useSubscriptionsState() {
  return useLiveTable(s.subscriptions, "subscriptions");
}

/** Stored price changes for the cost summary. */
export function usePriceHistoryState() {
  return useLiveTable(s.priceHistory, "price_history", [asc(s.priceHistory.effectiveFrom)]);
}

/** Documents kept beside a transaction. Metadata only — bytes stay local. */
export function useAttachmentsState() {
  return useLiveTable(s.attachments, "attachments", [asc(s.attachments.createdAt)]);
}

/** Contextual colours placed on Mali Tablo rows, columns and cells. */
export function useMatrixColorsState() {
  return useLiveTable(s.matrixColors, "matrix_colors");
}

export function usePlansState() {
  return useLiveTable(s.installmentPlans, "installment_plans");
}

export function useCreditCardStatementsState() {
  return useLiveTable(s.creditCardStatements, "credit_card_statements", [asc(s.creditCardStatements.dueDate)]);
}

export function useRecurringIncomesState() {
  return useLiveTable(s.recurringIncomes, "recurring_incomes");
}

export function useCategoryBudgetsState() {
  const userId = useUserId();
  return useSharedLive(
    `category_budgets:${userId}`,
    () =>
      // Only budgets of live categories: an orphan arriving out of order via sync must not surface nameless or join a total.
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
  return useLiveTable(s.computedColumns, "computed_columns", [asc(s.computedColumns.sortOrder)]);
}

export function usePendingExpectedState() {
  return useLiveTable(s.expectedPayments, "expected_payments", [asc(s.expectedPayments.dueDate)]);
}

/** See `autoConfirmedTransactionIds`. */
export function useAutoConfirmedTransactionIds(): ReadonlySet<string> {
  const { data } = usePendingExpectedState();
  return useMemo(() => autoConfirmedTransactionIds(data), [data]);
}

export function useAllTransactionsState() {
  return useLiveTable(s.transactions, "transactions", [asc(s.transactions.effectiveDate)]);
}

export function useAdjustmentsState() {
  return useLiveTable(s.balanceAdjustments, "balance_adjustments");
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

/** Live onboarded flag for the route guard; reactive because a second device receives it via sync. `null` = resolving or signed out. */
export function useOnboardedState(userId: string | null): LiveValueResult<boolean | null> {
  return useSyncedBooleanSettingState(userId, "onboarded");
}

/** Live "account frozen" flag, synced so a freeze gates every device. `null` while resolving or signed out. */
export function useAccountFrozenState(userId: string | null): LiveValueResult<boolean | null> {
  return useSyncedBooleanSettingState(userId, "account_frozen");
}

export function useSettingsMapState(): LiveValueResult<Map<string, string>> {
  const result = useLiveTable(s.settings, "settings");
  // Keyed on the rows: a fresh Map per render would defeat every consumer memo listing it.
  const data = useMemo(() => new Map(result.data.map((row) => [row.key, row.value])), [result.data]);
  return { ...result, data };
}

export function useCellNotesState() {
  return useLiveTable(s.cellNotes, "cell_notes", [], "cell-notes");
}

export function settingValue<T>(map: Map<string, string>, key: SettingKey, fallback: T): T {
  return decodeSettingValue(key, map.get(key), fallback);
}

/**
 * A setting decoded once per stored string: the map is a new object after any write, so a memo
 * keyed on it would hand out a new value every time. The fallback is the first render's, so a
 * literal `[]` does not count as a change.
 */
export function useSettingValue<T>(map: Map<string, string>, key: SettingKey, fallback: T): T {
  const raw = map.get(key);
  const [initialFallback] = useState(fallback);
  return useMemo(() => decodeSettingValue(key, raw, initialFallback), [key, raw, initialFallback]);
}

function selfPersonIds(persons: readonly (typeof s.persons.$inferSelect)[]): Set<string> {
  return new Set(persons.filter((p) => p.isSelf).map((p) => p.id));
}

/** Map DB transaction rows to the domain TxLike shape. */
function toTxLike(
  rows: (typeof s.transactions.$inferSelect)[],
  persons: (typeof s.persons.$inferSelect)[],
  categories: (typeof s.categories.$inferSelect)[],
): TxLike[] {
  const selfIds = selfPersonIds(persons);
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
    isWorkbookRemainder: isWorkbookRemainderRow(r),
  }));
}

export function useStatementPaymentsState() {
  return useLiveTable(s.cardStatementPayments, "card_statement_payments");
}

/**
 * The account's transactions in domain shape, one identity for every whole-account derivation.
 * A module value rather than a `useMemo`: the tab navigator keeps several screens mounted, and a
 * per-hook memo would map the list once per screen and hand each a different identity. Its inputs
 * are shared live-query results, so identity comparison is exact.
 */
let txLikeCache: {
  rows: unknown;
  persons: unknown;
  categories: unknown;
  payments: unknown;
  today: string;
  raw: TxLike[];
  settlement: CardSettlement;
} | null = null;

/**
 * The ledger as recorded statement payments leave it, cached in the same entry as the list it
 * starts from so the two never come from different reads. Settling here puts a fully paid
 * statement's charges on their payment day everywhere. With no payment the list keeps its identity.
 */
export function useCardSettlement(): CardSettlement {
  const rows = useAllTransactionsState().data;
  const persons = usePersonsState().data;
  const categories = useCategoriesState().data;
  const payments = useStatementPaymentsState().data;
  const today = todayISO();
  const cached = txLikeCache;
  const sameRows = cached != null && cached.rows === rows && cached.persons === persons && cached.categories === categories;
  if (sameRows && cached.payments === payments && cached.today === today) return cached.settlement;
  const raw = sameRows ? cached.raw : toTxLike(rows, persons, categories);
  const settlement = settleCardStatements(
    raw,
    payments.map((row) => ({ id: row.id, statementId: row.statementId, paidOn: row.paidOn, amountMinor: row.amountMinor, kind: row.kind })),
    today,
  );
  txLikeCache = { rows, persons, categories, payments, today, raw, settlement };
  return settlement;
}

export function useTxLike(): TxLike[] {
  return useCardSettlement().transactions;
}

/**
 * A date range's rows as the ledger counts them: a fully paid statement's charges sit on the
 * payment day (`settleCardStatements`), not their stored date. A moved row keeps every stored
 * field; `settledOn` says where the ledger put it, and its status follows.
 */
export function useSettledTransactionsBetweenState(from: string, to: string) {
  const state = useAllTransactionsState();
  const settlement = useCardSettlement();
  const rows = state.data;
  const data = useMemo(() => settledRowsBetween(rows, settlement, from, to), [rows, settlement, from, to]);
  return { ...state, data };
}

type StoredTransaction = ReturnType<typeof useAllTransactionsState>["data"][number];

function settledRowsBetween(rows: readonly StoredTransaction[], settlement: CardSettlement, from: string, to: string) {
  const settledById = settlement.byStatement.size === 0 ? null : new Map(settlement.transactions.map((tx) => [tx.id, tx]));
  const inRange: (StoredTransaction & { settledOn: string | null })[] = [];
  for (const row of rows) {
    const moved = settledById?.get(row.id);
    const settledOn = moved && moved.effectiveDate !== row.effectiveDate ? moved.effectiveDate : null;
    const date = settledOn ?? row.effectiveDate;
    if (date < from || date > to) continue;
    inRange.push(moved && (settledOn || moved.status !== row.status) ? { ...row, status: moved.status, settledOn } : { ...row, settledOn: null });
  }
  return inRange.sort((a, b) => (a.settledOn ?? a.effectiveDate).localeCompare(b.settledOn ?? b.effectiveDate));
}

/**
 * The investment wallet right now. A projection that throws is a history that cannot be replayed
 * (a sale before its purchase arrived): the last verified wallet stays visible and the failure is
 * exposed so money-changing forms can pause.
 */
interface InvestmentWalletSnapshot {
  data: InvestmentState | null;
  error: unknown | null;
}

/** Project the wallet from its six live sources, one projection for every screen that shows or spends from it. */
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
    const selfIds = selfPersonIds(persons);
    try {
      const data = projectInvestmentState(
        profile,
        products,
        operations,
        transactions.map((transaction) => ({
          ...transaction,
          personIsSelf: selfIds.has(transaction.personId),
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
 * Same rationale as `txLikeCache`: a per-hook memo would rebuild the chain per mounted screen and
 * hand each a different `LedgerBundle`. Keyed on the exact inputs `buildLedgerChain` receives (the
 * raw `adjustments` array, not the mapped copy, whose identity changes every render).
 *
 * Keyed by END YEAR, not the year on screen: the chain is identical for any year up to the end
 * year and only the twelve-month slice differs. Bounded so it stays a cache, not a leak.
 */
const LEDGER_CACHE_LIMIT = 4;
type LedgerCacheEntry = { inputs: readonly unknown[]; value: LedgerChain };
const ledgerChainCache = new Map<number, LedgerCacheEntry>();

/** Per-chain year slices, so revisiting a year returns the same bundle; a chain evicted above takes its slices with it. */
const ledgerSliceCache = new WeakMap<LedgerChain, Map<number, LedgerBundle>>();

function sliceCacheFor(chain: LedgerChain): Map<number, LedgerBundle> {
  const existing = ledgerSliceCache.get(chain);
  if (existing) return existing;
  const created = new Map<number, LedgerBundle>();
  ledgerSliceCache.set(chain, created);
  return created;
}

/**
 * The expectations the chain draws, one list for every screen. A module value for the reason
 * `txLikeCache` is one; the rate is read when an input changes, so every screen converts the same amounts.
 */
let plannedCache: { inputs: readonly unknown[]; value: PlannedExpectation[] } | null = null;

function plannedExpectationsFor(
  userId: string,
  expected: readonly (typeof s.expectedPayments.$inferSelect)[],
  subscriptions: readonly (typeof s.subscriptions.$inferSelect)[],
  incomes: readonly (typeof s.recurringIncomes.$inferSelect)[],
  transactions: readonly TxLike[],
  today: ISODate,
  fxVersion: number,
): PlannedExpectation[] {
  const inputs = [userId, expected, subscriptions, incomes, transactions, today, fxVersion] as const;
  if (plannedCache && plannedCache.inputs.every((input, index) => input === inputs[index])) return plannedCache.value;
  const subscriptionById = new Map(subscriptions.map((row) => [row.id, row]));
  const incomeById = new Map(incomes.map((row) => [row.id, row]));
  const value = plannedExpectations({
    expected,
    transactions,
    today,
    // Missing FX stays missing; a foreign amount is never treated as TRY.
    toTryMinor: (currency, amountMinor) => {
      if (currency === "TRY") return amountMinor;
      const rateTry = marketSellRateTry(currency) ?? lookupRate(userId, currency)?.rate.rateTry ?? null;
      return rateTry == null ? null : convertToTryMinor(amountMinor, rateTry);
    },
    ruleOf: (kind, refId) => (kind === "subscription" ? subscriptionById : incomeById).get(refId),
  });
  plannedCache = { inputs, value };
  return value;
}

export function useLedgerState(year: number): LiveValueResult<LedgerBundle | null> {
  const settingsState = useSettingsMapState();
  const personsState = usePersonsState();
  const categoriesState = useCategoriesState();
  const transactionsState = useAllTransactionsState();
  const adjustmentsState = useAdjustmentsState();
  const paymentsState = useStatementPaymentsState();
  const expectedState = usePendingExpectedState();
  const subscriptionsState = useSubscriptionsState();
  const incomesState = useRecurringIncomesState();
  const fxVersion = useFxRates();
  const userId = useUserId();
  const settlement = useCardSettlement();
  const txLike = settlement.transactions;
  const settings = settingsState.data;
  const adjustments = adjustmentsState.data;
  const { status, ready, error, updatedAt, retry } = combineLiveStates([
    settingsState,
    personsState,
    categoriesState,
    transactionsState,
    adjustmentsState,
    paymentsState,
    expectedState,
    subscriptionsState,
    incomesState,
  ]);

  // `null` means only that the queries have not answered; returning here also keeps the loading pass out of the chain cache.
  if (!ready) return { data: null, status, error, updatedAt, retry };

  const today = todayISO();
  const configuredStart = settingValue<MonthKey | null>(settings, "start_month", null);
  const openingBalanceMinor = settingValue<number>(settings, "opening_balance_minor", 0);
  const includePendingInCells = settingValue<boolean>(settings, "show_pending_in_table", true);
  const planned = plannedExpectationsFor(userId, expectedState.data, subscriptionsState.data, incomesState.data, txLike, today, fxVersion);
  const inputs = [configuredStart, openingBalanceMinor, includePendingInCells, txLike, adjustments, settlement.flows, planned, today] as const;
  const endYear = ledgerChainEndYear(year, today);
  const cached = ledgerChainCache.get(endYear);
  let chain: LedgerChain;
  if (cached && cached.inputs.every((input, index) => input === inputs[index])) {
    chain = cached.value;
  } else {
    chain = buildLedgerChain({
      configuredStart,
      openingBalanceMinor,
      includePendingInCells,
      transactions: txLike,
      adjustments: adjustments.map((row) => ({ id: row.id, date: row.date, amountMinor: row.amountMinor, declaredMinor: row.declaredMinor })),
      settlements: settlement.flows,
      plannedExpectations: planned,
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
  // The slice keeps a stable identity or every memo built on the bundle is invalidated.
  const sliceCache = sliceCacheFor(chain);
  let data = sliceCache.get(year);
  if (!data) {
    data = sliceLedgerYear(chain, year);
    sliceCache.set(year, data);
  }
  return { data, status, error, updatedAt, retry };
}

/** What the two balance columns are called, and whether both are drawn; one hook so every screen agrees. */
export function useBalanceColumns(): { openingLabel: string; closingLabel: string; showOpening: boolean } {
  const settings = useSettingsMapState().data;
  const stored = settingValue<StoredBalanceColumns | null>(settings, "balance_columns", null);
  return {
    openingLabel: balanceColumnLabel(stored?.openingLabel, tr.cashflow.opening),
    closingLabel: balanceColumnLabel(stored?.closingLabel, tr.cashflow.closing),
    showOpening: stored?.showOpening !== false,
  };
}
