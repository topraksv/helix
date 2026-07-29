import { friendlyAuthError } from "./auth-errors";

export interface PasswordRecoveryEmailClient {
  resetPasswordForEmail: (
    email: string,
    options: { redirectTo: string },
  ) => Promise<{ error: { message: string } | null }>;
}

/** Supabase keeps unknown accounts indistinguishable from known ones while
 * callers still receive actionable delivery, network and rate-limit errors. */
export async function requestPasswordRecoveryEmail(
  client: PasswordRecoveryEmailClient,
  email: string,
  redirectTo: string,
): Promise<string | null> {
  const { error } = await client.resetPasswordForEmail(email.trim(), { redirectTo });
  if (!error) return null;
  if (/user.*not found|email.*not found/i.test(error.message)) return null;
  return friendlyAuthError(error.message);
}
