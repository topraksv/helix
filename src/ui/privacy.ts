/**
 * Privacy Peek: whether financial values are shown on this device right now.
 *
 * Device-local and nothing else. It is a presentation preference — the rows,
 * the exports and the backups are untouched, and it is never written to the
 * account or synced, because "hide the numbers on the phone I hold in public"
 * is not a statement about the account.
 *
 * Masking happens at the render edge (`Amount`, `<Private>`), never screen by
 * screen: a masked amount is one whose FORMATTER refused, so a surface added
 * later inherits the behaviour instead of having to remember it.
 */

import { create } from "zustand";
import { kv } from "../services/kv";

const PRIVACY_KEY = "helix.privacy.hidden";

interface PrivacyState {
  hidden: boolean;
  /** Resolved once from storage; until then nothing has been decided yet. */
  loaded: boolean;
  load: () => Promise<void>;
  toggle: () => void;
}

export const usePrivacy = create<PrivacyState>((set, get) => ({
  hidden: false,
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    const stored = await kv.get(PRIVACY_KEY).catch(() => null);
    set({ hidden: stored === "true", loaded: true });
  },
  toggle: () => {
    const next = !get().hidden;
    set({ hidden: next });
    void kv.set(PRIVACY_KEY, next ? "true" : "false").catch(() => {});
  },
}));

/**
 * The stand-in for a hidden value.
 *
 * One glyph per digit-ish character so the mask keeps the value's rough shape
 * and the row does not resize when it is revealed — the layout must not jump,
 * and a fixed-width blob would make every amount look identical in width.
 */
export function maskAmount(formatted: string): string {
  return formatted.replace(/[\d]/g, "•");
}
