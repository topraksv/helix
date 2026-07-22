/** Supabase reports many sign-out failures as `{ error }` rather than throwing.
 * Always fall back to a device-local revoke so a failed global revocation
 * cannot leave the persisted session available on the next bootstrap. */
export async function signOutWithLocalFallback(
  signOut: (options?: { scope?: "global" | "local" | "others" }) => Promise<{ error: unknown }>,
): Promise<void> {
  try {
    const { error } = await signOut();
    if (!error) return;
  } catch {
    // The local fallback below is also required for thrown transport failures.
  }
  try {
    await signOut({ scope: "local" });
  } catch {
    // The app-owned workspace and bootstrap keys are still cleared by caller.
  }
}
