/** Small, testable navigation boundary used by every explicit back action. */
export function navigateBack<T>(
  router: { canGoBack: () => boolean; back: () => void; replace: (href: T) => void },
  fallback: T,
): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
