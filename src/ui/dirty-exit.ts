/** One navigation guard for every form that can lose an in-memory draft. */

import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useNavigation } from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import { tr } from "../i18n/tr";
import { appConfirm } from "./dialog";
import { shouldBlockDirtyExit } from "../domain/form-state";

interface DirtyExitGuard {
  /** Run an action after a successful save/delete without asking to discard. */
  allowExit: (action: () => void) => void;
  /** Ask before replacing a dirty draft with another context on the same route. */
  confirmDiscard: (action: () => void, contextDirty?: boolean) => void;
}

export function useDirtyExitGuard(dirty: boolean): DirtyExitGuard {
  const navigation = useNavigation();
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

  return {
    allowExit: permitExit,
    // A form-owned cancel has not been prevented by React Navigation yet, so
    // lift the guard for exactly that queued action after confirmation.
    confirmDiscard: (action, contextDirty) =>
      askToDiscardRef.current(() => permitExit(action), contextDirty),
  };
}
