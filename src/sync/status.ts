/** Visible sync state (spec §5: sync errors are never swallowed silently). */

import { create } from "zustand";

export type SyncState = "idle" | "syncing" | "error" | "unconfigured";

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
