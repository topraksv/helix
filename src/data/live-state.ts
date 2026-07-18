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

/** Collapse several query states without hiding the most severe condition. */
export function combineLiveQueryStatus(snapshots: readonly LiveSnapshot<unknown>[]): LiveQueryStatus {
  if (snapshots.some((snapshot) => snapshot.status === "error")) return "error";
  if (snapshots.some((snapshot) => snapshot.status === "stale")) return "stale";
  if (snapshots.some((snapshot) => snapshot.status === "loading")) return "loading";
  if (snapshots.some((snapshot) => snapshot.status === "refreshing")) return "refreshing";
  return "ready";
}
