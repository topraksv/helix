/**
 * Ending a session on THIS device is not the same as ending the account's
 * sessions everywhere.
 *
 * `supabase.auth.signOut()` defaults to `scope: "global"`, which revokes every
 * refresh token the account holds. Signing out of the web app therefore killed
 * the phone: its next refresh was rejected, Supabase emitted `SIGNED_OUT`, the
 * invalidation path wiped that device's workspace — including rows that had
 * never been pushed — and "Cihazlarını Güncelle" could only answer 401 until
 * the user signed in again. An ordinary sign-out must leave the account's other
 * devices alone.
 *
 * `global` stays available for the one case that genuinely means it: deleting
 * the account, where the identity itself is going away.
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
 * One bounded attempt to get this device's queued rows to the server before an
 * explicit sign-out wipes them.
 *
 * Sign-out deliberately erases the local workspace — a finance app leaves no
 * plaintext data behind — and the cloud is what re-hydrates it on the next
 * sign-in. That is only true for rows the cloud actually received: anything
 * still in the outbox has no copy anywhere and is destroyed silently. Returns
 * true when rows would still be lost, so the caller can stop and let the user
 * decide rather than discover it afterwards.
 *
 * Deps are injected because this file stays free of React Native imports: the
 * session store cannot load under the unit runner, and this rule is exactly the
 * kind that must be provable there.
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
