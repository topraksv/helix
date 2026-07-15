/** Device-local previous-successful-login bookkeeping. */

export interface LoginHistoryStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

function currentKey(userId: string): string {
  return `helix.login.current.${userId}`;
}

function previousKey(userId: string): string {
  return `helix.login.previous.${userId}`;
}

/**
 * Advance history only after a complete successful sign-in. The timestamp
 * returned is the login before the one being recorded, never this session.
 */
export async function recordSuccessfulLogin(
  storage: LoginHistoryStorage,
  userId: string,
  signedInAt: string,
): Promise<string | null> {
  const previous = await storage.get(currentKey(userId));
  if (previous) await storage.set(previousKey(userId), previous);
  else await storage.remove(previousKey(userId));
  await storage.set(currentKey(userId), signedInAt);
  return previous;
}

/** A fresh account starts a history but has no prior login to display. */
export async function startLoginHistory(
  storage: LoginHistoryStorage,
  userId: string,
  signedInAt: string,
): Promise<void> {
  await storage.remove(previousKey(userId));
  await storage.set(currentKey(userId), signedInAt);
}

/** Seed users who receive this feature mid-session without moving history. */
export async function seedCurrentLogin(
  storage: LoginHistoryStorage,
  userId: string,
  signedInAt: string,
): Promise<void> {
  if (await storage.get(currentKey(userId))) return;
  await storage.set(currentKey(userId), signedInAt);
}

/** Cold-starting an existing session does not advance login history. */
export function loadPreviousLogin(storage: LoginHistoryStorage, userId: string): Promise<string | null> {
  return storage.get(previousKey(userId));
}
