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
