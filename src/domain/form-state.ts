/** Pure decision shared by form navigation guards and tests. */
export function shouldBlockDirtyExit(dirty: boolean, explicitlyAllowed: boolean): boolean {
  return dirty && !explicitlyAllowed;
}
