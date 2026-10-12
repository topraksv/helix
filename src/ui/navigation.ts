interface BackRouter<T> {
  canGoBack: () => boolean;
  back: () => void;
  replace: (href: T) => void;
  dismissTo: (href: T) => void;
}

type DirtyExitFallback = (action: () => void) => boolean;

let dirtyExitFallback: DirtyExitFallback | null = null;

/**
 * A direct link has no stack action for `usePreventRemove` to intercept. The
 * focused dirty form registers the same confirmation for that one fallback
 * path, so a header back and a native gesture cannot disagree about drafts.
 */
export function registerDirtyExitFallback(handler: DirtyExitFallback): () => void {
  dirtyExitFallback = handler;
  return () => {
    if (dirtyExitFallback === handler) dirtyExitFallback = null;
  };
}

export function navigateBack<T>(router: BackRouter<T>, fallback: T): void {
  // A dirty form answers first; its confirmed exit goes back TO the parent (`dismissTo`), never replaces the form, or a second tab stack mounts.
  if (dirtyExitFallback?.(() => router.dismissTo(fallback))) return;
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
