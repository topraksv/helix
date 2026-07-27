/** One navigation guard for every form that can lose an in-memory draft. */

import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useNavigation } from "expo-router";
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
  const allowedRef = useRef(false);
  const confirmingRef = useRef(false);
  const askToDiscardRef = useRef<(action: () => void, contextDirty?: boolean) => void>(() => {});
  dirtyRef.current = dirty;

  /**
   * Turn the swipe-back gesture off while there is something to lose.
   *
   * `beforeRemove` is the only hook the button, the Android hardware back and
   * the iOS edge swipe all pass through, so the guard has to live there. But
   * the native stack runs that gesture on the native side: the screen has
   * already slid away by the time `preventDefault` is processed, and putting it
   * back leaves the owner looking at a question about a screen they watched
   * themselves leave.
   *
   * With the gesture disabled the remaining exits raise `beforeRemove` before
   * anything moves, so the question arrives while the screen is still there.
   * Re-enabled the moment the form is clean, which is nearly all of the time.
   */
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !dirty });
  }, [navigation, dirty]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldBlockDirtyExit(dirtyRef.current, allowedRef.current)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  askToDiscardRef.current = (action, contextDirty = dirtyRef.current) => {
    if (!shouldBlockDirtyExit(contextDirty, allowedRef.current)) {
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

  useEffect(() => navigation.addListener("beforeRemove", (event) => {
    if (!shouldBlockDirtyExit(dirtyRef.current, allowedRef.current)) return;
    event.preventDefault();
    askToDiscardRef.current(() => {
      allowedRef.current = true;
      navigation.dispatch(event.data.action);
      setTimeout(() => {
        allowedRef.current = false;
      }, 0);
    });
  }), [navigation]);

  return {
    allowExit: (action) => {
      allowedRef.current = true;
      action();
      setTimeout(() => {
        allowedRef.current = false;
      }, 0);
    },
    confirmDiscard: (action, contextDirty) => askToDiscardRef.current(action, contextDirty),
  };
}
