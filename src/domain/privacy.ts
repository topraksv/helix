/** Pure policy for hiding sensitive finance UI from snapshots/embedding. */
export function shouldCoverSensitiveUi(
  platform: string,
  appState: string,
  framed: boolean,
): boolean {
  return platform === "web" ? framed : appState !== "active";
}
