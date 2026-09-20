/**
 * Screen counts, accumulated on the device and reported as deltas.
 *
 * The shape follows `diagnostics.ts` deliberately: a bounded device-local
 * store, a flush that happens only where the app already knows it has a
 * session and a network, and a failure that costs nothing. What differs is the
 * clearing rule — a counter is reported and then forgotten, because the server
 * adds deltas, while an incident is kept so the owner can still read it
 * offline.
 *
 * Nothing here may record a diagnostic of its own, for the reason
 * `diagnostics.ts` gives: a failing upload that logged its own failure would
 * grow the ring on every attempt.
 */

import { kv } from "./kv";
import { isUsageDelta, localDay, type UsageDelta } from "../domain/usage";

const PENDING_KEY = "helix.usage_counters.v1";
/** Two hundred days of screens would be a bug, not a user. The cap is what
 *  stops a broken normaliser filling the store one key at a time. */
const MAX_ENTRIES = 200;

type Pending = Record<string, number>;

let write = Promise.resolve();

const entryKey = (day: string, screen: string) => `${day}|${screen}`;

async function readPending(): Promise<Pending> {
  try {
    const raw = await kv.get(PENDING_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== "object" || parsed === null) return {};
    const pending: Pending = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isInteger(value) && value > 0) pending[key] = value;
    }
    return pending;
  } catch {
    // A corrupt counter file is replaceable; finance data is untouched.
    return {};
  }
}

/** Count one visit. Never awaits the caller's render. */
export function recordScreenView(screen: string, at: Date = new Date()): void {
  const key = entryKey(localDay(at), screen);
  write = write
    .then(async () => {
      const pending = await readPending();
      if (!(key in pending) && Object.keys(pending).length >= MAX_ENTRIES) return;
      pending[key] = Math.min(10000, (pending[key] ?? 0) + 1);
      await kv.set(PENDING_KEY, JSON.stringify(pending));
    })
    .catch(() => {});
}

/** What has been counted and not yet reported. */
export async function pendingUsage(): Promise<UsageDelta[]> {
  const pending = await readPending();
  return Object.entries(pending)
    .map(([key, count]) => {
      const [day = "", screen = ""] = key.split("|");
      return { day, screen, count };
    })
    .filter(isUsageDelta);
}

export interface UsageUploadPort {
  /** Add these deltas to whatever the server already holds. */
  record(deltas: UsageDelta[]): Promise<void>;
}

/**
 * Report and forget.
 *
 * The forget half is why this subtracts what it sent rather than clearing the
 * store: a visit counted while the upload was in flight belongs to the next
 * report, and clearing outright would drop it. A failed upload leaves
 * everything where it was, so the next sync sends the same deltas again —
 * which is safe because the server adds only what it is given, once.
 */
export async function reportUsage(port: UsageUploadPort): Promise<void> {
  const deltas = await pendingUsage();
  if (deltas.length === 0) return;
  try {
    await port.record(deltas);
  } catch {
    return;
  }
  write = write
    .then(async () => {
      const pending = await readPending();
      for (const delta of deltas) {
        const key = entryKey(delta.day, delta.screen);
        const left = (pending[key] ?? 0) - delta.count;
        if (left > 0) pending[key] = left;
        else delete pending[key];
      }
      await kv.set(PENDING_KEY, JSON.stringify(pending));
    })
    .catch(() => {});
  await write;
}
