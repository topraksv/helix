/**
 * What the app is in the middle of doing to the account.
 *
 * Sign-out, freeze and delete all fall back to the root waiting view, which must name the operation rather than "syncing".
 *
 * The guard renders before the navigator and its providers, so this is a module
 * store rather than context: the action records what it is about to do, the
 * waiting view reads it, and it clears itself once the operation resolves.
 */

import { useState, useSyncExternalStore } from "react";
import { DELETE_DOCUMENTS_REMAIN, useSession } from "../auth/session";
import { tr } from "../i18n/tr";
import { appAlert, appConfirm } from "./dialog";
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

/**
 * Deleting the account, from Settings (a local workspace) or Account Security
 * (a cloud account, which re-authenticates first). The intent outlives the
 * call so the waiting screen can name the operation the user confirmed.
 */
export function useAccountDeletion(reauthenticate?: () => Promise<boolean>) {
  const { deleteAccount } = useSession();
  const [deleting, setDeleting] = useState(false);
  const run = async () => {
    if (deleting) return;
    const accepted = await appConfirm(tr.account.deleteConfirm1Title, tr.account.deleteConfirm1Body, {
      confirmLabel: tr.common.delete,
      danger: true,
      operation: "delete",
    });
    if (!accepted || (reauthenticate && !(await reauthenticate()))) return;
    setLifecycleIntent("delete");
    setDeleting(true);
    try {
      let error = await deleteAccount();
      if (error === DELETE_DOCUMENTS_REMAIN) {
        clearLifecycleIntent();
        if (!(await appConfirm(tr.account.deleteDocumentsTitle, tr.account.deleteDocumentsBody, { confirmLabel: tr.account.deleteAnyway, danger: true, operation: "delete" }))) return;
        setLifecycleIntent("delete");
        error = await deleteAccount({ force: true });
      }
      if (error) {
        clearLifecycleIntent();
        void appAlert(error, tr.errors.title);
      }
    } finally {
      setDeleting(false);
    }
  };
  return { deleting, deleteAccount: run };
}
