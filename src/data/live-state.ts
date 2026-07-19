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
export function combineLiveQueryStatus(snapshots: readonly LiveSnapshot<unknown>[]): LiveQueryStatus {
  if (snapshots.some((snapshot) => snapshot.status === "error")) return "error";
  if (snapshots.some((snapshot) => snapshot.status === "stale")) return "stale";
  if (snapshots.some((snapshot) => snapshot.status === "loading")) return "loading";
  if (snapshots.some((snapshot) => snapshot.status === "refreshing")) return "refreshing";
  return "ready";
}
