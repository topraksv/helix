/**
 * `supabase.auth.signOut()` defaults to `scope: "global"`, which revokes every refresh token the account
 * holds: the other devices' next refresh is rejected and they wipe their workspaces, unsent rows included.
 * An ordinary sign-out therefore stays local; `global` is for deleting the account.
 */

type SignOutScope = "local" | "global";

/** Supabase reports many sign-out failures as `{ error }` rather than throwing.
 * Always fall back to a device-local revoke so a failed revocation cannot leave
 * the persisted session available on the next bootstrap. */
export async function signOutWithLocalFallback(
  signOut: (options?: { scope?: "global" | "local" | "others" }) => Promise<{ error: unknown }>,
  scope: SignOutScope = "local",
): Promise<void> {
  try {
    const { error } = await signOut({ scope });
    if (!error) return;
  } catch {
    // The local fallback below is also required for thrown transport failures.
  }
  // A failed revoke must not leave the persisted session readable on the next
  // bootstrap, so retry device-locally even when that was already the scope.
  try {
    await signOut({ scope: "local" });
  } catch {
    // The app-owned workspace and bootstrap keys are still cleared by caller.
  }
}

/**
 * One bounded attempt to get queued rows to the server before a sign-out wipes the workspace. Anything
 * still in the outbox has no copy anywhere, so this returns true when rows would be lost and the caller
 * lets the user decide. Deps are injected to keep this file free of React Native imports.
 */
export async function pendingChangesWouldBeLost(deps: {
  pendingCount: () => Promise<number>;
  flush: () => Promise<unknown>;
}): Promise<boolean> {
  if ((await deps.pendingCount()) === 0) return false;
  try {
    await deps.flush();
  } catch {
    // A failed flush is not fatal here: the count below decides, and it is the
    // only thing that actually proves whether the rows reached the server.
  }
  return (await deps.pendingCount()) > 0;
}
