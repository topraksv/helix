import { friendlyAuthError } from "./auth-errors";

interface PasswordRecoveryEmailClient {
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

interface SignUpConfirmationClient {
  resend: (request: { type: "signup"; email: string }) => Promise<{ error: { message: string } | null }>;
}

/** A fresh confirmation link, for the one that expired or never arrived. The
 * success wording stays conditional: whether an account is still waiting on
 * that address is not something this answer is relied on to reveal. */
export async function resendSignUpConfirmation(client: SignUpConfirmationClient, email: string): Promise<string | null> {
  const { error } = await client.resend({ type: "signup", email: email.trim() });
  return error ? friendlyAuthError(error.message) : null;
}
