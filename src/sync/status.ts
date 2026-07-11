/** Visible sync state (spec §5: sync errors are never swallowed silently). */

import { create } from "zustand";

export type SyncState = "idle" | "syncing" | "error" | "unconfigured";

interface SyncStatusStore {
  state: SyncState;
  lastSyncAt: string | null;
  error: string | null;
  /** userId whose initial pull has completed at least once this session. Lets
   *  the route guard hold before flashing onboarding to an already-onboarded
   *  account whose data is still being pulled onto a fresh device. */
  hasSyncedUser: string | null;
  set: (patch: Partial<Omit<SyncStatusStore, "set">>) => void;
}

export const useSyncStatus = create<SyncStatusStore>((set) => ({
  state: "idle",
  lastSyncAt: null,
  error: null,
  hasSyncedUser: null,
  set: (patch) => set(patch),
}));
