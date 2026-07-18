/** Visible sync state (spec §5: sync errors are never swallowed silently). */

import { create } from "zustand";

type SyncState = "idle" | "syncing" | "attention" | "error" | "unconfigured";

export function completedSyncState(deadLetterCount: number): SyncState {
  return deadLetterCount > 0 ? "attention" : "idle";
}

interface SyncStatusStore {
  state: SyncState;
  lastSyncAt: string | null;
  error: string | null;
  set: (patch: Partial<Omit<SyncStatusStore, "set">>) => void;
}

export const useSyncStatus = create<SyncStatusStore>((set) => ({
  state: "idle",
  lastSyncAt: null,
  error: null,
  set: (patch) => set(patch),
}));
