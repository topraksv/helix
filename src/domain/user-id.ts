/** Stable owner for the offline-only workspace. This legacy value predates the
 * UUIDv7/v8 row-id rule; changing it would make existing device data look like
 * another account and trigger a protective wipe. */
export const LOCAL_ONLY_USER_ID = "00000000-0000-0000-0000-000000000001";
