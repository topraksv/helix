/** One navigation guard for every form that can lose an in-memory draft. */

import { useEffect, useRef } from "react";
import { useNavigation } from "expo-router";
import { tr } from "../i18n/tr";
import { appConfirm } from "./dialog";
import { shouldBlockDirtyExit } from "../domain/form-state";

export function useDirtyExitGuard(dirty: boolean): (action: () => void) => void {
  const navigation = useNavigation();
  const dirtyRef = useRef(dirty);
  const allowedRef = useRef(false);
  const confirmingRef = useRef(false);
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

  useEffect(() => navigation.addListener("beforeRemove", (event) => {
    if (!shouldBlockDirtyExit(dirtyRef.current, allowedRef.current)) return;
    event.preventDefault();
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    void appConfirm(tr.forms.discardTitle, tr.forms.discardBody, {
      confirmLabel: tr.forms.discardAction,
      danger: true,
    }).then((discard) => {
      if (!discard) return;
      allowedRef.current = true;
      navigation.dispatch(event.data.action);
      setTimeout(() => {
        allowedRef.current = false;
      }, 0);
    }).finally(() => {
      confirmingRef.current = false;
    });
  }), [navigation]);

  return (action) => {
    allowedRef.current = true;
    action();
    setTimeout(() => {
      allowedRef.current = false;
    }, 0);
  };
}
