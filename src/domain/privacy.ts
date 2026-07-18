/** Pure policy for hiding sensitive finance UI from snapshots/embedding. */
export function shouldCoverSensitiveUi(
  platform: string,
  appState: string,
  framed: boolean,
  hasSensitiveContent = true,
): boolean {
  return platform === "web" ? framed : hasSensitiveContent && appState !== "active";
}
