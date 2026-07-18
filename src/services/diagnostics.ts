/** PII-free, device-local incident evidence and diagnostic export. */

import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { getSqliteAsync } from "../db/client";
import { kv } from "../lib/kv";
import { useSyncStatus } from "../sync/status";
import { createDiagnosticEvent, type SafeDiagnosticEvent } from "../domain/diagnostics";

const EVENTS_KEY = "helix.diagnostic_events.v1";
const MAX_EVENTS = 12;

export type DiagnosticEvent = SafeDiagnosticEvent;

let eventWrite = Promise.resolve();

/** Persist only scope/category/time. Raw errors and financial values never leave memory. */
export function recordDiagnostic(scope: string, severity: DiagnosticEvent["severity"], error: unknown): void {
  const event = createDiagnosticEvent(scope, severity, error);
  eventWrite = eventWrite
    .then(async () => {
      let previous: DiagnosticEvent[] = [];
      try {
        const raw = await kv.get(EVENTS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) previous = parsed.filter(isDiagnosticEvent);
      } catch {
        // A corrupt diagnostic ring is replaceable; finance data is untouched.
      }
      await kv.set(EVENTS_KEY, JSON.stringify([...previous, event].slice(-MAX_EVENTS)));
    })
    .catch(() => {});
}

function isDiagnosticEvent(value: unknown): value is DiagnosticEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<DiagnosticEvent>;
  return (
    typeof event.at === "string" &&
    typeof event.scope === "string" &&
    (event.severity === "warning" || event.severity === "error") &&
    ["network", "auth", "database", "validation", "cancelled", "unknown"].includes(event.code ?? "")
  );
}

export async function readDiagnosticEvents(): Promise<DiagnosticEvent[]> {
  await eventWrite;
  try {
    const raw = await kv.get(EVENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isDiagnosticEvent).slice(-MAX_EVENTS) : [];
  } catch {
    return [];
  }
}

export interface DiagnosticSnapshot {
  generatedAt: string;
  app: {
    platform: string;
    version: string | null;
    runtimeVersion: string | null;
    channel: string | null;
    updateId: string | null;
    updateCreatedAt: string | null;
    embedded: boolean;
    emergencyLaunch: boolean;
  };
  sync: {
    state: string;
    lastSyncAt: string | null;
    pendingCount: number;
    oldestPendingAt: string | null;
    oldestPendingAgeMs: number | null;
    deadLetterCount: number;
    deadLetters: { table: string; reason: string; count: number; latestAt: string }[];
  };
  database: { migrationId: number | null; migrationCreatedAt: number | null };
  events: DiagnosticEvent[];
}

export async function collectDiagnosticSnapshot(userId: string): Promise<DiagnosticSnapshot> {
  const sqlite = await getSqliteAsync();
  const [outbox, deadLetters, migration, events] = await Promise.all([
    sqlite.getFirstAsync<{ count: number; oldest: string | null }>(
      `SELECT COUNT(*) AS count, MIN(created_at) AS oldest FROM outbox`,
      [],
    ),
    sqlite.getAllAsync<{ table_name: string; reason: string; count: number; latest: string }>(
      `SELECT table_name, reason, COUNT(*) AS count, MAX(quarantined_at) AS latest
       FROM sync_dead_letters
       GROUP BY table_name, reason
       ORDER BY latest DESC`,
      [],
    ),
    sqlite.getFirstAsync<{ id: number; created_at: number }>(
      `SELECT id, created_at FROM __drizzle_migrations ORDER BY id DESC LIMIT 1`,
      [],
    ).catch(() => null),
    readDiagnosticEvents(),
  ]);
  // The owner id is accepted to make the account scope explicit at the call
  // boundary. Counts come only from local-only operational tables; no row id,
  // payload, e-mail, note or amount is exported.
  void userId;
  const oldestPendingAt = outbox?.oldest ?? null;
  const oldestMs = oldestPendingAt ? Date.parse(oldestPendingAt) : Number.NaN;
  const sync = useSyncStatus.getState();
  return {
    generatedAt: new Date().toISOString(),
    app: {
      platform: Platform.OS,
      version: Constants.expoConfig?.version ?? null,
      runtimeVersion: Updates.runtimeVersion,
      channel: Updates.channel,
      updateId: Updates.updateId,
      updateCreatedAt: Updates.createdAt?.toISOString() ?? null,
      embedded: Updates.isEmbeddedLaunch,
      emergencyLaunch: Updates.isEmergencyLaunch,
    },
    sync: {
      state: sync.state,
      lastSyncAt: sync.lastSyncAt,
      pendingCount: outbox?.count ?? 0,
      oldestPendingAt,
      oldestPendingAgeMs: Number.isFinite(oldestMs) ? Math.max(0, Date.now() - oldestMs) : null,
      deadLetterCount: deadLetters.reduce((total, row) => total + row.count, 0),
      deadLetters: deadLetters.map((row) => ({
        table: row.table_name,
        reason: row.reason,
        count: row.count,
        latestAt: row.latest,
      })),
    },
    database: {
      migrationId: migration?.id ?? null,
      migrationCreatedAt: migration?.created_at ?? null,
    },
    events,
  };
}
