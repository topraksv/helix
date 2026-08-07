/**
 * What the app is in the middle of doing to the account.
 *
 * Signing out, freezing and deleting all end the same way: the session drops,
 * the root guard falls back to its waiting view, and that view used to say
 * "Hesabın eşitleniyor" — the sentence written for the first pull after a
 * sign-in — no matter which of the three the user had just confirmed. Deleting
 * an account is not syncing it.
 *
 * The guard renders before the navigator and its providers, so this is a module
 * store rather than context: the action records what it is about to do, the
 * waiting view reads it, and it clears itself once the operation resolves.
 */

import { useSyncExternalStore } from "react";
import type { OperationFlowKind } from "./operation-flow";

export type LifecycleIntent = Extract<
  OperationFlowKind,
  "sign-out" | "local-sign-out" | "delete" | "freeze" | "reactivate"
>;

let current: LifecycleIntent | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Record what the user just confirmed. Cleared by `clearLifecycleIntent`. */
export function setLifecycleIntent(intent: LifecycleIntent): void {
  current = intent;
  emit();
}

export function clearLifecycleIntent(): void {
  if (current === null) return;
  current = null;
  emit();
}

export function useLifecycleIntent(): LifecycleIntent | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current,
  );
}
