/** One navigation guard for every form that can lose an in-memory draft. */

import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useIsFocused, useNavigation, unstable_useIsNavigating as useIsNavigating } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
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
  const [exitRan, setExitRan] = useState(false);
  const navigating = useIsNavigating();
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

  // The native gesture is disabled while dirty; see the setOptions call below.
  usePreventRemove(shouldBlockDirtyExit(dirty, exitAllowed), ({ data }) => {
    // Re-dispatch the exact prevented action from this event. React Navigation
    // marks it as already visited, so it can leave without disabling the guard
    // for an unrelated navigation attempt in between.
    askToDiscardRef.current(() => navigation.dispatch(data.action));
  });

  // After the lifted guard has committed. Setting `exitRan` in the same tick batches it with any
  // navigation the action queues, so the effect below never sees the action without its navigation.
  useEffect(() => {
    if (!exitAllowed) return;
    const timer = setTimeout(() => {
      const action = pendingExitRef.current;
      pendingExitRef.current = null;
      action?.();
      setExitRan(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [exitAllowed]);

  // SDK 58 queues navigation and commits it renders later: re-arming on a timer turned a saved
  // form's exit into a discard prompt. An action that does not navigate re-arms at once.
  useEffect(() => {
    if (!exitRan || navigating) return;
    const timer = setTimeout(() => {
      setExitRan(false);
      setExitAllowed(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [exitRan, navigating]);

  // A dirty form does not offer a gesture it is going to refuse.
  //
  // `usePreventRemove` cancels the dismissal, but on iOS it cancels it AFTER
  // the native stack has already begun the pop: the screen slides away, snaps
  // back, and only then does the confirmation appear — which reads as the app
  // having lost the draft and then changed its mind. Taking the gesture away
  // while the draft is dirty leaves one way out, the back control, and that one
  // asks before anything moves.
  useEffect(() => {
    if (Platform.OS === "web") return;
    navigation.setOptions({ gestureEnabled: !dirty || exitAllowed });
  }, [navigation, dirty, exitAllowed]);

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

/** Dirty means the draft differs from what it held when the screen settled; `ready` defers the baseline until async initial values arrive. */
export function useDraftDirty(snapshot: string, ready = true): boolean {
  const baseline = useRef<string | null>(null);
  if (baseline.current === null && ready) baseline.current = snapshot;
  return baseline.current !== null && snapshot !== baseline.current;
}
