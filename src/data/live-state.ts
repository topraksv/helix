/** Pure state transitions shared by async SQLite live queries. */

export type LiveQueryStatus = "loading" | "refreshing" | "ready" | "stale" | "error";

interface LiveQueryError {
  kind: "query_failed";
  attempt: number;
  occurredAt: Date;
}

export interface LiveSnapshot<T> {
  data: T;
  status: LiveQueryStatus;
  error: LiveQueryError | null;
  updatedAt: Date | undefined;
}

export function initialLiveSnapshot<T>(data: T): LiveSnapshot<T> {
  return { data, status: "loading", error: null, updatedAt: undefined };
}

export function startLiveQuery<T>(previous: LiveSnapshot<T>): LiveSnapshot<T> {
  return {
    ...previous,
    status: previous.updatedAt ? "refreshing" : "loading",
    error: null,
  };
}

export function completeLiveQuery<T>(data: T, at: Date): LiveSnapshot<T> {
  return { data, status: "ready", error: null, updatedAt: at };
}

export function failLiveQuery<T>(previous: LiveSnapshot<T>, attempt: number, at: Date): LiveSnapshot<T> {
  return {
    ...previous,
    status: previous.updatedAt ? "stale" : "error",
    error: { kind: "query_failed", attempt, occurredAt: at },
  };
}

/**
 * How long to wait before attempt N+1 of a failed live query.
 *
 * Capped exponential backoff, and it never gives up: abandoning after a fixed
 * number of tries left screens frozen on empty data (a wedged sqlite worker
 * never recovered, and route guards keyed off the query showed a permanently
 * blank screen). The ceiling is what keeps "never gives up" from meaning
 * "retries in a tight loop".
 */
export function retryDelayMs(attempt: number): number {
  return Math.min(250 * 2 ** (attempt - 1), 5000);
}

/**
 * The snapshot a consumer may read this render.
 *
 * A live query answers one question — a user, a month, an account. When its
 * parameters change the previous answer is not a "last good snapshot" of the
 * new one, and dropping it inside an effect is one render too late: effects run
 * after the render that changed the parameters, so a guard reading during that
 * render still sees the old question's resolved `updatedAt`. That is exactly
 * how logout → login flashed Quick Start at an existing account — the signed
 * out query's resolved empty result was read as "this account is not
 * onboarded" before any effect, including the first-pull grace, had run.
 */
export function snapshotForParameters<T>(
  snapshot: LiveSnapshot<T>,
  answeredParameters: string,
  currentParameters: string,
  pending: LiveSnapshot<T>,
): LiveSnapshot<T> {
  return answeredParameters === currentParameters ? snapshot : pending;
}

/**
 * Read a synced boolean setting (`onboarded`, `account_frozen`) that a route
 * guard depends on. `null` means "not resolved yet" and must never be treated
 * as `false`.
 *
 * The distinction carries the whole bug class: a signed-in account whose flag
 * has not loaded is NOT an un-onboarded account, and an unresolved freeze flag
 * is not an unfrozen account. `updatedAt` is the only proof the query actually
 * ran for the CURRENT user, which is why `useLive` must drop the previous
 * snapshot when its parameters change — a carried-over `updatedAt` made this
 * return `false` from a wiped local database and flashed the Quick Start
 * screen at an existing account after logout → login.
 */
export function readSyncedFlag(
  snapshot: LiveSnapshot<{ value: string }[]>,
  signedIn: boolean,
): boolean | null {
  if (!signedIn) return null;
  if (snapshot.updatedAt == null) return null;
  try {
    return JSON.parse(snapshot.data[0]?.value ?? "false") === true;
  } catch {
    return false;
  }
}

/** Collapse several query states without hiding the most severe condition. */
function combineLiveQueryStatus(snapshots: readonly LiveSnapshot<unknown>[]): LiveQueryStatus {
  if (snapshots.some((snapshot) => snapshot.status === "error")) return "error";
  if (snapshots.some((snapshot) => snapshot.status === "stale")) return "stale";
  if (snapshots.some((snapshot) => snapshot.status === "loading")) return "loading";
  if (snapshots.some((snapshot) => snapshot.status === "refreshing")) return "refreshing";
  return "ready";
}

export interface LiveStateGroup {
  /** The most severe condition any of the sources is in. */
  status: LiveQueryStatus;
  /**
   * Every source has answered at least once for the current parameters.
   *
   * A distinct question from the status: a `refreshing` query has answered,
   * and a `stale` one is showing its last good data. This is the one a screen
   * gates its content on, because rendering "you have no categories" from a
   * query that has not run yet is the lie.
   */
  ready: boolean;
  /** The first failure, so a caller can report it without picking a source. */
  error: LiveQueryError | null;
  /** The OLDEST completion among the sources, or `undefined` until all have
   *  answered — the moment the whole picture was last true. */
  updatedAt: Date | undefined;
  retry: () => void;
}

/**
 * What a screen needs to know about the several live queries it reads.
 *
 * Eighteen screens spelled this out by hand: combine the statuses, test every
 * `updatedAt`, then write a retry that names each source again — a list that
 * silently falls out of step with the queries above it the first time one is
 * added. One helper, and adding a query to the array is the whole edit.
 */
export function combineLiveStates(
  states: readonly (LiveSnapshot<unknown> & { retry: () => void })[],
): LiveStateGroup {
  const answered = states.flatMap((state) => (state.updatedAt ? [state.updatedAt.getTime()] : []));
  // `Math.min()` of nothing is `Infinity`, and `new Date(Infinity)` is an
  // Invalid Date that every `!= null` check downstream would accept as a real
  // completion. An empty group is vacuously ready and has no such moment.
  const ready = answered.length === states.length;
  return {
    status: combineLiveQueryStatus(states),
    ready,
    error: states.find((state) => state.error)?.error ?? null,
    updatedAt: ready && answered.length > 0 ? new Date(Math.min(...answered)) : undefined,
    retry: () => {
      for (const state of states) state.retry();
    },
  };
}
