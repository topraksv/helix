/**
 * Keep draft payment-source ownership valid when a watched person is removed.
 * Index zero is the deterministic self person; sources owned by the removed
 * person return to self, while later owner indices shift with the person list.
 */
export function remapDraftOwnerIndex(ownerIndex: number, removedIndex: number): number {
  if (ownerIndex === removedIndex) return 0;
  return ownerIndex > removedIndex ? ownerIndex - 1 : ownerIndex;
}
