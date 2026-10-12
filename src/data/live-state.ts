/** Pure state transitions shared by async SQLite live queries. */

export type LiveQueryStatus = "loading" | "ready" | "stale" | "error";

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

/**
 * A re-run of a query that has answered keeps its snapshot: a "refreshing" state would notify
 * every subscriber on each write. A stale or failed query keeps saying so until the answer arrives.
 */
export function startLiveQuery<T>(previous: LiveSnapshot<T>): LiveSnapshot<T> {
  return previous.updatedAt ? previous : { ...previous, status: "loading", error: null };
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

/** Capped exponential backoff; it never gives up, since a wedged worker would leave screens blank. */
export function retryDelayMs(attempt: number): number {
  return Math.min(250 * 2 ** (attempt - 1), 5000);
}

/**
 * The snapshot a consumer may read this render. When the parameters change the old answer must
 * not be readable even for one render: an effect drops it too late, and a route guard would read
 * the previous user's resolved result as "not onboarded".
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
 * Read a synced boolean setting (`onboarded`, `account_frozen`) a route guard depends on.
 * `null` means "not resolved yet" and must never be treated as `false`; `updatedAt` is the only
 * proof the query ran for the CURRENT user.
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
  return "ready";
}

interface LiveStateGroup {
  /** The most severe condition any of the sources is in. */
  status: LiveQueryStatus;
  /** Every source has answered at least once for the current parameters; screens gate content on this, not status. */
  ready: boolean;
  /** The first failure, so a caller can report it without picking a source. */
  error: LiveQueryError | null;
  /** The OLDEST completion among the sources, or `undefined` until all have
   *  answered — the moment the whole picture was last true. */
  updatedAt: Date | undefined;
  retry: () => void;
}

/** What a screen needs to know about the several live queries it reads. */
export function combineLiveStates(
  states: readonly (LiveSnapshot<unknown> & { retry: () => void })[],
): LiveStateGroup {
  const answered = states.flatMap((state) => (state.updatedAt ? [state.updatedAt.getTime()] : []));
  // `Math.min()` of nothing is `Infinity`, an Invalid Date that `!= null` checks would accept.
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
