/**
 * What the user last told the app they really have, and whether the ledger
 * still agrees with it.
 *
 * Reconciling writes an adjustment so the ledger lands on the declared figure,
 * and from that instant the app has no memory of what was confirmed. Keeping
 * the declaration lets every surface say "you told me ₺20.000 on 4 Ağustos; the
 * table now says ₺30.000" rather than quietly drifting away from the one number
 * the user checked against a bank.
 *
 * Drift is not an error. It is the ordinary result of entering more records —
 * which is exactly when a person should look at their account again.
 */
export interface BalanceDeclaration {
  minor: number;
  at: string;
}

export function parseBalanceDeclaration(value: unknown): BalanceDeclaration | null {
  if (typeof value !== "object" || value === null) return null;
  const { minor, at } = value as Partial<BalanceDeclaration>;
  if (typeof minor !== "number" || !Number.isFinite(minor)) return null;
  if (typeof at !== "string" || at === "") return null;
  return { minor, at };
}

/**
 * The difference between the ledger now and the last declaration, or `null`
 * when there is nothing to compare — no declaration, or no computed balance.
 */
export function balanceDeclarationDrift(
  declaration: BalanceDeclaration | null,
  computedMinor: number | null,
): number | null {
  if (declaration == null || computedMinor == null) return null;
  const drift = computedMinor - declaration.minor;
  return drift === 0 ? null : drift;
}
