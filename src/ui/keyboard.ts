/**
 * Desktop-web keyboard ergonomics: press Enter to submit a form.
 *
 * A tiny overlay registry lets modal popups (the calculator, the calendar
 * sheet, dialogs) suppress Enter-submit while they're open — otherwise pressing
 * Enter inside the calculator would ALSO save the underlying form. Multiline
 * note fields are ignored too, where Enter means "new line".
 *
 * All no-ops off web (native has its own return-key handling).
 */

import { useEffect, useRef } from "react";
import { Platform } from "react-native";

let openOverlays = 0;

/** Mark an overlay open; call the returned fn (e.g. from a useEffect cleanup)
 *  when it closes. */
export function pushOverlay(): () => void {
  openOverlays += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openOverlays = Math.max(0, openOverlays - 1);
  };
}

function anyOverlayOpen(): boolean {
  return openOverlays > 0;
}

/**
 * Submit `onSubmit` when the user presses Enter (web only). Disabled via
 * `enabled` (e.g. when the form is invalid), while any overlay is open, or when
 * focus is in a multiline textarea.
 */
export function useSubmitOnEnter(onSubmit: () => void, enabled = true): void {
  const ref = useRef(onSubmit);
  ref.current = onSubmit;
  useEffect(() => {
    if (Platform.OS !== "web" || !enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.isComposing || anyOverlayOpen()) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && el.tagName === "TEXTAREA") return; // Enter = newline in notes
      e.preventDefault();
      ref.current();
    };
    // Capture phase: react-native-web's single-line TextInput swallows Enter on
    // bubble (onSubmitEditing + stopPropagation), so a bubble listener never
    // sees it. Capturing on the window fires before the input can stop it.
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [enabled]);
}
