/** Supabase auth/RPC errors arrive in English; map them to the Turkish UI. */

import { tr } from "../i18n/tr";

export function friendlyAuthError(raw: string): string {
  if (/invalid login credentials|invalid_credentials/i.test(raw)) return tr.auth.errInvalidCredentials;
  if (/already registered|already exists/i.test(raw)) return tr.auth.errUserExists;
  if (/rate limit|too many/i.test(raw)) return tr.auth.errRateLimit;
  if (/refresh token|jwt|session[_ ](expired|missing|not found)/i.test(raw)) return tr.auth.errSessionExpired;
  if (/network|fetch|timeout|connection/i.test(raw)) return tr.auth.errNetwork;
  if (/password should be|weak password/i.test(raw)) return tr.auth.errWeakPassword;
  if (/email not confirmed/i.test(raw)) return tr.auth.errEmailNotConfirmed;
  if (/invalid.*email|email.*invalid|validate email/i.test(raw)) return tr.auth.errInvalidEmail;
  if (/\b5\d\d\b|internal server|service unavailable/i.test(raw)) return tr.auth.errService;
  return tr.auth.errGeneric;
}
