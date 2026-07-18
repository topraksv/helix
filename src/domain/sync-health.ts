export type ShellSyncHealth = "quiet" | "attention" | "error";

const STALE_PENDING_MS = 5 * 60 * 1000;

/**
 * Keep healthy/short-lived sync activity out of the navigation chrome. The
 * shell asks for attention only when a write has waited unusually long or the
 * sync engine has a real error; Settings remains the detailed surface.
 */
export function shellSyncHealth(
  state: "idle" | "syncing" | "error" | "unconfigured",
  pendingCount: number,
  oldestPendingAt: string | null,
  nowMs = Date.now(),
): ShellSyncHealth {
  if (state === "unconfigured") return "quiet";
  if (state === "error") return "error";
  if (pendingCount <= 0 || oldestPendingAt == null) return "quiet";
  const oldestMs = Date.parse(oldestPendingAt);
  if (!Number.isFinite(oldestMs)) return "attention";
  return nowMs - oldestMs >= STALE_PENDING_MS ? "attention" : "quiet";
}
