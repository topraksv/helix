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

/** The timestamp returned is the opening before this one, never this one. */
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

export function loadPreviousLogin(storage: LoginHistoryStorage, userId: string): Promise<string | null> {
  return storage.get(previousKey(userId));
}
