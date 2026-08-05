/**
 * Changing the whole window's colour without it reading as a reload.
 *
 * Every colour in the app comes from one palette object, so switching theme or
 * palette repaints the entire window in a single frame. Two things were tried
 * before this: an instant swap (reported as "tak diye değişiyor") and a
 * full-screen veil fading out over the new theme (reported as "still feels like
 * a refresh" — because a full-screen wash IS what a page replacement looks
 * like).
 *
 * The browser can do the real thing. `document.startViewTransition` snapshots
 * the rendered pixels, applies the change, and cross-fades the two — the old
 * interface literally dissolving into the new one, which no overlay can
 * imitate. It costs nothing when the API is absent (Firefox today): the update
 * simply applies, exactly as it did before.
 *
 * React has to have committed before the browser takes its "after" snapshot.
 * A click is a discrete event, so React 19 flushes it synchronously and calling
 * the update inside the callback is enough. Reaching for `flushSync` was tried
 * first and is what a dynamic `react-dom` import costs: in the Metro web bundle
 * the import never resolved, the callback never committed, and the theme simply
 * stopped changing — caught by the suite, not by reasoning.
 *
 * Native has no equivalent that does not mean a new dependency
 * (`react-native-view-shot` and a screenshot per toggle), so it keeps the veil
 * in `ThemeDissolve` — short and light, softening the edge without covering the
 * app.
 */

type ViewTransitionStarter = { startViewTransition?: (callback: () => void) => unknown };

export function applyThemeChange(commit: () => void): void {
  const doc = typeof document === "undefined" ? null : (document as unknown as ViewTransitionStarter);
  if (!doc?.startViewTransition) {
    commit();
    return;
  }
  doc.startViewTransition(() => {
    commit();
  });
}

/** True when the browser will cross-fade the change itself. */
export function crossFadesNatively(): boolean {
  return typeof document !== "undefined" && "startViewTransition" in document;
}
