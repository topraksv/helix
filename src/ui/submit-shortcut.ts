/**
 * Who owns the Enter key.
 *
 * Lives apart from `keyboard.ts` on purpose: that module imports React Native
 * and therefore cannot load under Vitest at all, which is exactly how this
 * rule's absence stayed invisible while the form's primary Save answered every
 * Enter press on the web.
 */

/**
 * Controls whose own activation key is Enter. Focus one and Enter belongs to
 * it — a button runs its press, a switch flips, a chip selects. Mirrors the
 * interactive set the modal focus trap uses in `accessibility.ts`.
 */
export const ENTER_OWNING_SELECTOR =
  'a[href], button, select, [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="link"], [role="option"], [role="menuitem"], [role="combobox"], [contenteditable="true"]';

/** The minimal shape the rule needs from a focused element. */
export interface FocusTargetLike {
  tagName?: string;
  matches?: (selector: string) => boolean;
}

/**
 * Whether the focused element already owns Enter.
 *
 * The submit shortcut listens on the window in the capture phase, so without
 * this the form's primary Save won every time: focusing the secondary "save and
 * add another" button saved and left the screen, focusing the refund switch
 * committed the entry instead of flipping its sign, and a category chip could
 * never be chosen with the keyboard. A control's own action must win; Enter is
 * a form shortcut only from a single-line field or from nothing interactive.
 */
export function focusOwnsEnterKey(element: FocusTargetLike | null | undefined): boolean {
  if (!element) return false;
  if (element.tagName === "TEXTAREA") return true; // Enter = newline in notes
  return typeof element.matches === "function" && element.matches(ENTER_OWNING_SELECTOR);
}
