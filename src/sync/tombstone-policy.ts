/** Pure tombstone generation rules shared by local writes and tests. */

export interface TombstoneState {
  deletedAt: string | null;
  tombstoneVersion: number;
}

/** Deletes move exactly one generation; edits and explicit undo retain the
 * highest generation already observed from another device/server ack. */
export function resolveTombstoneVersion(
  existing: TombstoneState | null,
  requestedDeletedAt: string | null,
  requestedVersion: number,
): number {
  if (!existing) return requestedDeletedAt ? Math.max(1, requestedVersion) : requestedVersion;
  const version = Math.max(existing.tombstoneVersion, requestedVersion);
  return requestedDeletedAt && existing.deletedAt == null ? version + 1 : version;
}
