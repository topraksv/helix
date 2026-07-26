/**
 * Analysis, opened from OUTSIDE the Financial Table's own tab.
 *
 * The same screen exists at `(tabs)/cash-flow/analytics` for the in-tab route.
 * A push from another tab used to go there with `{ withAnchor: true }`, which
 * mounts the tab's index underneath — so the iOS edge swipe popped to the
 * Financial Table while the back button went to the screen the user came from.
 * Pushed at the root instead, the stack below it IS the screen the user came
 * from, so the gesture and the button land in the same place by construction
 * rather than by a listener correcting one of them afterwards.
 */

export { default } from "./(tabs)/cash-flow/analytics";
