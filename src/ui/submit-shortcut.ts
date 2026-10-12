/**
 * Who owns the Enter key.
 *
 * Apart from `keyboard.ts` so Vitest can load it (that module imports React Native).
 */

/**
 * Controls whose own activation key is Enter. Focus one and Enter belongs to
 * it — a button runs its press, a switch flips, a chip selects. Mirrors the
 * interactive set the modal focus trap uses in `accessibility.ts`.
 */
const ENTER_OWNING_SELECTOR =
  'a[href], button, select, [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="link"], [role="option"], [role="menuitem"], [role="combobox"], [contenteditable="true"]';

/** The minimal shape the rule needs from a focused element. */
interface FocusTargetLike {
  tagName?: string;
  matches?: (selector: string) => boolean;
}

/**
 * Whether the focused element already owns Enter.
 *
 * A control's own Enter action wins; Enter is a form shortcut only from a single-line field or a non-interactive focus.
 */
export function focusOwnsEnterKey(element: FocusTargetLike | null | undefined): boolean {
  if (!element) return false;
  if (element.tagName === "TEXTAREA") return true; // Enter = newline in notes
  return typeof element.matches === "function" && element.matches(ENTER_OWNING_SELECTOR);
}
