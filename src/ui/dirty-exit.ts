/** One navigation guard for every form that can lose an in-memory draft. */

import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useNavigation } from "expo-router";
import { useIsFocused, usePreventRemove } from "@react-navigation/native";
import { tr } from "../i18n/tr";
import { appConfirm } from "./dialog";
import { shouldBlockDirtyExit } from "../domain/form-state";
import { registerDirtyExitFallback } from "./navigation";

interface DirtyExitGuard {
  /** Run an action after a successful save/delete without asking to discard. */
  allowExit: (action: () => void) => void;
  /** Ask before replacing a dirty draft with another context on the same route. */
  confirmDiscard: (action: () => void, contextDirty?: boolean) => void;
}

export function useDirtyExitGuard(dirty: boolean): DirtyExitGuard {
  const navigation = useNavigation();
  const focused = useIsFocused();
  const dirtyRef = useRef(dirty);
  const [exitAllowed, setExitAllowed] = useState(false);
  const exitAllowedRef = useRef(exitAllowed);
  const pendingExitRef = useRef<(() => void) | null>(null);
  const confirmingRef = useRef(false);
  const askToDiscardRef = useRef<(action: () => void, contextDirty?: boolean) => void>(() => {});
  dirtyRef.current = dirty;
  exitAllowedRef.current = exitAllowed;

  const permitExit = (action: () => void) => {
    pendingExitRef.current = action;
    setExitAllowed(true);
  };

  // React Navigation's native-stack integration translates this registration
  // to `preventNativeDismiss` on iOS. The sheet's pull-down gesture therefore
  // remains available, but a dirty dismissal is cancelled natively before the
  // shared confirmation decides whether to replay the original action.
  usePreventRemove(shouldBlockDirtyExit(dirty, exitAllowed), ({ data }) => {
    // Re-dispatch the exact prevented action from this event. React Navigation
    // marks it as already visited, so it can leave without disabling the guard
    // for an unrelated navigation attempt in between.
    askToDiscardRef.current(() => navigation.dispatch(data.action));
  });

  useEffect(() => {
    if (!exitAllowed) return;
    const action = pendingExitRef.current;
    pendingExitRef.current = null;
    action?.();
    const timer = setTimeout(() => setExitAllowed(false), 0);
    return () => clearTimeout(timer);
  }, [exitAllowed]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldBlockDirtyExit(dirtyRef.current, exitAllowedRef.current)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  askToDiscardRef.current = (action, contextDirty = dirtyRef.current) => {
    if (!shouldBlockDirtyExit(contextDirty, exitAllowedRef.current)) {
      action();
      return;
    }
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    void appConfirm(tr.forms.discardTitle, tr.forms.discardBody, {
      confirmLabel: tr.forms.discardAction,
      danger: true,
    }).then((discard) => {
      if (discard) action();
    }).finally(() => {
      confirmingRef.current = false;
    });
  };

  useEffect(() => {
    if (!focused) return;
    return registerDirtyExitFallback((action) => {
      if (!shouldBlockDirtyExit(dirtyRef.current, exitAllowedRef.current)) return false;
      // A direct-link replacement is still a navigation action. Lift the
      // guard for that one confirmed action, otherwise the replacement would
      // immediately re-enter `usePreventRemove` while the dialog is settling.
      askToDiscardRef.current(() => permitExit(action));
      return true;
    });
  }, [focused]);

  return {
    allowExit: permitExit,
    // A form-owned cancel has not been prevented by React Navigation yet, so
    // lift the guard for exactly that queued action after confirmation.
    confirmDiscard: (action, contextDirty) =>
      askToDiscardRef.current(() => permitExit(action), contextDirty),
  };
}

/**
 * The one rule for "has this form changed?".
 *
 * Every screen used to answer it differently: some compared a snapshot, some
 * asked "is any field non-empty", some tracked whether a control had ever been
 * touched. So the same gesture produced three behaviours — a discard prompt on
 * a form nothing had been typed into, no prompt on one that had, and on a
 * couple of screens a guard that refused to leave with nothing to answer.
 *
 * Dirty means the draft differs from what it held when the screen settled.
 * Typing 150 over 100 and then typing 100 back is not a change, because the
 * user is leaving with exactly what they arrived with.
 *
 * `ready` exists because a form's initial values arrive asynchronously: taking
 * the baseline on the first render would compare a filled form against an empty
 * one and call every screen dirty. The baseline is captured on the first render
 * where the data has settled, and never again.
 */
export function useDraftDirty(snapshot: string, ready = true): boolean {
  const baseline = useRef<string | null>(null);
  if (baseline.current === null && ready) baseline.current = snapshot;
  return baseline.current !== null && snapshot !== baseline.current;
}
