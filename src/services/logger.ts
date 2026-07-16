/** Development-only diagnostics. Production builds never emit user data. */
export function devError(scope: string, error: unknown, detail?: unknown): void {
  if (typeof __DEV__ !== "undefined" && __DEV__) console.error(`[${scope}]`, error, detail ?? "");
}

export function devWarning(scope: string, message: string): void {
  if (typeof __DEV__ !== "undefined" && __DEV__) console.warn(`[${scope}]`, message);
}
