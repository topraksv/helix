/** Shared focus behavior for modal surfaces. */

import { useEffect, useRef, type RefObject } from "react";
import { AccessibilityInfo, findNodeHandle, Platform, type View } from "react-native";

type FocusTarget = View;

function moveAccessibilityFocus(target: FocusTarget | null): void {
  if (!target) return;
  if (Platform.OS === "web") {
    (target as unknown as { focus?: () => void }).focus?.();
    return;
  }
  const handle = findNodeHandle(target);
  if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle);
}

/** Focuses a modal's heading and returns focus to its trigger on close. */
export function useModalAccessibility(
  open: boolean,
  returnFocusRef?: RefObject<FocusTarget | null>,
  focusKey?: unknown,
  focusHeading = true,
): RefObject<View | null> {
  const titleRef = useRef<View>(null);

  useEffect(() => {
    if (!open) return;
    const webPrevious = Platform.OS === "web" && typeof document !== "undefined"
      ? document.activeElement as HTMLElement | null
      : null;
    const returnTarget = returnFocusRef?.current;
    const timer = focusHeading ? setTimeout(() => moveAccessibilityFocus(titleRef.current), 40) : undefined;
    return () => {
      if (timer != null) clearTimeout(timer);
      setTimeout(() => {
        if (returnTarget) moveAccessibilityFocus(returnTarget);
        else webPrevious?.focus?.();
      }, 0);
    };
  }, [open, returnFocusRef, focusKey, focusHeading]);

  return titleRef;
}
