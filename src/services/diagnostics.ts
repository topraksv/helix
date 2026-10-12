// A bounded ring of scrubbed events, uploaded only when the user sends it.

import { kv } from "./kv";
import { createDiagnosticEvent, type SafeDiagnosticEvent as DiagnosticEvent } from "../domain/diagnostics";

const EVENTS_KEY = "helix.diagnostic_events.v1";
const MAX_EVENTS = 12;
/** The high-water mark of what has already been uploaded. */
const UPLOADED_KEY = "helix.diagnostic_events.uploaded.v1";

/** A corrupt ring is replaceable; finance data is untouched. */
async function readRing(): Promise<DiagnosticEvent[]> {
  try {
    const raw = await kv.get(EVENTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isDiagnosticEvent) : [];
  } catch {
    return [];
  }
}

let eventWrite = Promise.resolve();

/** Persist only scope/category/time. Raw errors and financial values never leave memory. */
export function recordDiagnostic(scope: string, severity: DiagnosticEvent["severity"], error: unknown): void {
  const event = createDiagnosticEvent(scope, severity, error);
  eventWrite = eventWrite
    .then(async () => {
      const previous = await readRing();
      await kv.set(EVENTS_KEY, JSON.stringify([...previous, event].slice(-MAX_EVENTS)));
    })
    .catch(() => {});
}

/** The row shape the table accepts; nothing wider exists on this path. */
export interface DiagnosticUpload {
  user_id: string;
  occurred_at: string;
  scope: string;
  severity: DiagnosticEvent["severity"];
  code: DiagnosticEvent["code"];
  platform: "ios" | "android" | "web";
  app_version: string;
  error_name: string | null;
  fingerprint: string | null;
  frames: string | null;
}

export interface DiagnosticUploadPort {
  /** Insert, ignoring the rows this device already sent. */
  upload(rows: DiagnosticUpload[]): Promise<void>;
}

/**
 * Which events are new since the last successful upload.
 *
 * A watermark rather than a delete: the ring is what the device shows its owner
 * when there is no network, and an upload must not be the thing that empties
 * it. `at` is an ISO instant, so string order is time order.
 */
export function pendingDiagnostics(events: DiagnosticEvent[], uploadedThrough: string | null): DiagnosticEvent[] {
  return events.filter((event) => !uploadedThrough || event.at > uploadedThrough);
}

/**
 * Send everything recorded since the last upload.
 *
 * Silent on failure and safe to call on every sync: the table's identity index
 * makes a re-send a no-op, and the watermark only advances once the insert has
 * actually landed. Offline, the ring simply keeps its twelve.
 */
export async function uploadDiagnostics(
  port: DiagnosticUploadPort,
  userId: string,
  platform: DiagnosticUpload["platform"],
  appVersion: string,
): Promise<number> {
  try {
    const events = await readRing();
    const pending = pendingDiagnostics(events, await kv.get(UPLOADED_KEY));
    if (pending.length === 0) return 0;
    const rows = pending.map((event) => ({
      user_id: userId,
      occurred_at: event.at,
      scope: event.scope,
      severity: event.severity,
      code: event.code,
      platform,
      app_version: appVersion,
      // `?? null` rather than a direct read: a ring written by a build from
      // before these fields existed is still a valid ring, and losing twelve
      // real incidents to a schema change would be the worse trade.
      error_name: event.name ?? null,
      fingerprint: event.fingerprint ?? null,
      frames: event.frames ?? null,
    }));
    await port.upload(rows);
    await kv.set(UPLOADED_KEY, pending[pending.length - 1]!.at);
    return pending.length;
  } catch {
    // Deliberately not recorded. A diagnostic about the diagnostic upload
    // grows the ring on every failed attempt and then queues itself for the
    // next one.
    return 0;
  }
}

/** A new account starts its own history; the previous owner's watermark is not it. */
export async function resetDiagnosticUploads(): Promise<void> {
  try {
    await kv.remove(UPLOADED_KEY);
  } catch {
    // Same rule as above.
  }
}

/** Absent, null, or a string no longer than the column will take.
 *
 *  Absent is the older ring; the length bound is why a corrupt entry cannot
 *  become an insert the database refuses. A refused insert fails the whole
 *  batch, so one bad entry would otherwise silence every incident behind it. */
function isOptionalText(value: unknown, max: number): boolean {
  return value == null || (typeof value === "string" && value.length <= max);
}

function isDiagnosticEvent(value: unknown): value is DiagnosticEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<DiagnosticEvent>;
  return (
    typeof event.at === "string" &&
    typeof event.scope === "string" &&
    (event.severity === "warning" || event.severity === "error") &&
    ["network", "auth", "database", "validation", "cancelled", "unknown"].includes(event.code ?? "") &&
    isOptionalText(event.name, 40) &&
    isOptionalText(event.fingerprint, 120) &&
    isOptionalText(event.frames, 600)
  );
}
