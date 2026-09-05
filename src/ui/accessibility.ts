/** Shared focus behavior for modal surfaces and scroll regions. */

import { useEffect, useRef, type RefObject } from "react";
import { AccessibilityInfo, findNodeHandle, Platform, type ScrollView, type View } from "react-native";
import { pushOverlay } from "./keyboard";

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

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'a[href], button, input, select, textarea, [contenteditable="true"], [role="button"], [role="checkbox"], [role="option"], [role="radio"], [role="slider"], [role="spinbutton"], [role="switch"], [role="tab"]',
  )).filter((element) =>
    element.tabIndex >= 0 &&
    !element.hasAttribute("disabled") &&
    element.getAttribute("aria-disabled") !== "true" &&
    element.getClientRects().length > 0
  );
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
    // Every modal surface suppresses the global web Enter-to-submit handler.
    // Without one shared owner, a dirty-exit dialog could sit visibly above a
    // valid form while Enter saved and navigated the hidden form underneath.
    const releaseOverlay = pushOverlay();
    const webPrevious = Platform.OS === "web" && typeof document !== "undefined"
      ? document.activeElement as HTMLElement | null
      : null;
    const webModal = Platform.OS === "web" && typeof document !== "undefined"
      ? (titleRef.current as unknown as HTMLElement | null)?.closest<HTMLElement>('[aria-modal="true"]') ?? null
      : null;
    const returnTarget = returnFocusRef?.current;
    // The web modal already exists by the time this effect runs. Delaying its
    // focus lets the browser's own modal autofocus win briefly, so a quick Tab
    // can be followed by the timer stealing focus back to the heading.
    if (focusHeading && Platform.OS === "web") moveAccessibilityFocus(titleRef.current);
    const timer = focusHeading && Platform.OS !== "web"
      ? setTimeout(() => moveAccessibilityFocus(titleRef.current), 40)
      : undefined;
    const trapFocus = Platform.OS === "web" && typeof document !== "undefined"
      ? (event: KeyboardEvent) => {
          if (event.key !== "Tab") return;
          const title = titleRef.current as unknown as HTMLElement | null;
          const modal = title?.closest<HTMLElement>('[aria-modal="true"]');
          if (!modal) return;
          const openModals = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'));
          if (openModals.at(-1) !== modal) return;

          const focusable = focusableElements(modal);
          const active = document.activeElement as HTMLElement | null;
          const currentIndex = active ? focusable.indexOf(active) : -1;
          const leavingForward = currentIndex === focusable.length - 1;
          const leavingBackward = currentIndex === 0 && event.shiftKey;
          const focusOutside = !active || !modal.contains(active);
          const focusOnHeading = active === title;
          if (!focusOutside && !focusOnHeading && !leavingForward && !leavingBackward) return;

          event.preventDefault();
          const target = event.shiftKey ? focusable.at(-1) : focusable[0];
          (target ?? title)?.focus?.();
        }
      : null;
    if (trapFocus) document.addEventListener("keydown", trapFocus, true);
    return () => {
      if (timer != null) clearTimeout(timer);
      if (trapFocus) document.removeEventListener("keydown", trapFocus, true);
      releaseOverlay();
      setTimeout(() => {
        // Closing a modal normally returns focus to its trigger. Do not steal
        // focus from a user action that already moved elsewhere in the same
        // tick; the old unconditional timer could reopen a select when Enter
        // immediately followed a selection.
        const active = Platform.OS === "web" && typeof document !== "undefined"
          ? document.activeElement as HTMLElement | null
          : null;
        const focusMoved = Platform.OS === "web"
          && active != null
          && active !== document.body
          && active !== document.documentElement
          && !webModal?.contains(active);
        if (focusMoved) return;
        if (returnTarget) moveAccessibilityFocus(returnTarget);
        else webPrevious?.focus?.();
      }, 0);
    };
  }, [open, returnFocusRef, focusKey, focusHeading]);

  return titleRef;
}

/**
 * The DOM element that actually scrolls, behind a react-native ScrollView ref.
 *
 * `getScrollableNode` is react-native-web's own accessor and is what the
 * library guarantees; `findNodeHandle` is the fallback for a ref that has been
 * forwarded through a wrapper which does not re-expose it.
 */
function scrollableNode(instance: ScrollView | null): HTMLElement | null {
  if (Platform.OS !== "web" || instance == null || typeof document === "undefined") return null;
  const candidate = instance as unknown as { getScrollableNode?: () => unknown };
  const node = typeof candidate.getScrollableNode === "function"
    ? candidate.getScrollableNode()
    : findNodeHandle(instance as never);
  return node instanceof HTMLElement ? node : null;
}

/** Our own mark, so a tab stop this hook added is the only one it removes. */
const SCROLL_FOCUS_MARK = "data-helix-scroll-focus";

/**
 * Make a scroll region a keyboard can actually move.
 *
 * A browser scrolls an inner container with the arrow keys only when focus is
 * inside it, and Tab reaches a container through something focusable it
 * contains. `/privacy` contains nothing focusable at all: 3594px of KVKK text
 * in a 655px window, one Back button above it, and no control anywhere in the
 * notice itself.
 *
 * WHAT WAS AND WAS NOT MEASURED, because the first version of this comment got
 * it wrong. Current Chromium and Firefox make an overflowing container
 * focusable on their own, so on both of them Tab already reaches this region
 * and End already reaches the end of the notice — checked on 2026-09-05 with
 * the hook removed. The defect is therefore not "a keyboard cannot read the
 * notice in the browsers this app is tested in"; it is that the app was
 * relying on a browser courtesy of the last few releases to make its legal
 * text readable, and said so nowhere. Anything older, and any engine that has
 * not adopted it, gets a notice that stops after one screen —
 * `scrollable-region-focusable` is axe's name for exactly that bet, and it
 * fires on this route in both themes.
 *
 * So the affordance is stated in the markup instead of assumed — on the one
 * screen shaped that way. `enabled` comes from `Screen`'s `readable` prop and
 * is set by `privacy.tsx` alone: a focusable region is a tab stop, and an
 * effect that touches the DOM inside the app's most-used primitive is not
 * something forty screens should carry to fix one. Even then the stop appears
 * only while it is earned — the content overflows AND holds nothing else
 * focusable — and disappears again when either stops being true.
 *
 * Written to the DOM rather than through React state: this changes no layout
 * and must not re-render a screen whose content is still loading.
 */
export function useKeyboardReachableScroller(ref: RefObject<ScrollView | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || Platform.OS !== "web") return;
    const node = scrollableNode(ref.current);
    if (!node) return;

    const sync = () => {
      const overflows = node.scrollHeight > node.clientHeight + 1;
      const needsStop = overflows && focusableElements(node).length === 0;
      if (needsStop) {
        if (!node.hasAttribute(SCROLL_FOCUS_MARK)) {
          node.setAttribute(SCROLL_FOCUS_MARK, "true");
          node.tabIndex = 0;
        }
      } else if (node.hasAttribute(SCROLL_FOCUS_MARK)) {
        node.removeAttribute(SCROLL_FOCUS_MARK);
        node.removeAttribute("tabindex");
      }
    };

    sync();
    // Content arrives after the first paint on every screen that loads data,
    // and a one-shot check would answer for the empty frame.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    for (const child of Array.from(node.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [ref, enabled]);
}
