/**
 * What the user last told the app they really have, and whether the ledger
 * still agrees with it.
 *
 * Reconciling writes an adjustment so the ledger lands on the declared figure,
 * and from that instant the app has no memory of what was confirmed. Keeping
 * the declaration lets a surface say "you told me ₺20.000 on 4 Ağustos; the
 * table now says ₺30.000".
 *
 * Drift is not an error: it is the ordinary result of entering more records.
 */
import { addMonthsToKey, isISODate, monthKeyOf, type ISODate, type MonthKey } from "./dates";
import { signedBalanceEffect } from "./transactions";
import type { TxLike } from "./types";
interface BalanceDeclaration {
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

/** The month whose opening a declaration holds: it is dated on the last day of the month before. */
export function declaredMonthOf(date: ISODate): MonthKey {
  return addMonthsToKey(monthKeyOf(date), 1);
}

/**
 * The adjustment that makes a month open at `declaredMinor`. The stored
 * difference is measured from what the month opened with before any
 * declaration of its own, so the part an existing one contributed is taken
 * out of the opening first.
 */
export function declarationAdjustmentMinor(declaredMinor: number, openingMinor: number, existingDeltaMinor: number): number {
  const undeclared = openingMinor - existingDeltaMinor;
  return declaredMinor - undeclared;
}

/** A row that, if it really happened, would account for part of a drift. */
interface DriftCandidate {
  id: string;
  /** How the displayed balance would move once this row is realized. */
  effectMinor: number;
  date: ISODate;
}

/** How many candidates a surface is given before the list stops helping. */
const DRIFT_CANDIDATE_LIMIT = 5;

/**
 * The unconfirmed rows that would move the ledger toward what was declared.
 *
 * Saying how far off the table is leaves the owner to find the reason from
 * memory, and the app already holds the one thing memory is worst at: which
 * rows are still pending. `countsTowardBalance` requires `realized`, so a row
 * dated in the past and never confirmed is money the table has not counted —
 * if it really moved, the table is wrong by exactly that amount.
 *
 * Only rows pointing the RIGHT WAY are offered. A ledger reading higher than
 * the declaration can only be explained by money that left, so an unconfirmed
 * income is not a candidate for it, and offering one would send the owner to
 * check a row that cannot be the answer.
 *
 * These are candidates and never a finding. Whether a row happened is
 * something only the person who wrote it knows, so the list ranks by size —
 * the largest is the likeliest to matter — and stops before it becomes
 * something to read rather than act on.
 */
export function driftCandidates(
  driftMinor: number,
  transactions: readonly TxLike[],
  today: ISODate,
  limit = DRIFT_CANDIDATE_LIMIT,
): DriftCandidate[] {
  if (driftMinor === 0) return [];
  const wanted = driftMinor > 0 ? -1 : 1;
  const candidates: DriftCandidate[] = [];
  for (const transaction of transactions) {
    if (transaction.status !== "pending" || !transaction.personIsSelf || transaction.walletDraw) continue;
    if (transaction.effectiveDate > today) continue;
    const effectMinor = signedBalanceEffect(transaction);
    if (Math.sign(effectMinor) !== wanted) continue;
    candidates.push({ id: transaction.id, effectMinor, date: transaction.effectiveDate });
  }
  return candidates
    .sort((a, b) => Math.abs(b.effectMinor) - Math.abs(a.effectMinor))
    .slice(0, limit);
}

/**
 * What the owner last saw in a digital wallet (Tami and the like), and since
 * when the app treats that wallet as money already spent.
 *
 * Topping a wallet up is the expense; a bill the wallet pays afterwards only
 * spends what was put in. `since` is the first declaration's day and never
 * moves, so a later balance update cannot hand past draws back to the ledger.
 */
export interface WalletBalance {
  minor: number;
  at: ISODate;
  since: ISODate;
  /** The instant the figure was typed: a payment Helix recorded before it is in the figure, one after is not. */
  recordedAt?: string;
}

export type WalletBalances = Record<string, WalletBalance>;

/** One malformed wallet drops alone: refusing the map would turn every other wallet's draws back into spending. */
export function parseWalletBalances(value: unknown): WalletBalances | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 500) return null;
  const balances: WalletBalances = {};
  for (const [id, entry] of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const { minor, at, since, recordedAt } = entry as Partial<WalletBalance>;
    if (!Number.isSafeInteger(minor) || !isISODate(at) || !isISODate(since) || since > at) continue;
    if (recordedAt !== undefined && (typeof recordedAt !== "string" || !Number.isFinite(Date.parse(recordedAt)))) continue;
    balances[id] = entry as WalletBalance;
  }
  return balances;
}

/** The day each declared wallet starts drawing; a source that is no longer a wallet draws nothing. */
export function walletDrawStarts(balances: WalletBalances | null, walletIds: Iterable<string>): Map<string, ISODate> {
  const starts = new Map<string, ISODate>();
  if (!balances) return starts;
  for (const id of walletIds) {
    const balance = balances[id];
    if (balance) starts.set(id, balance.since);
  }
  return starts;
}

/** A payment a declared wallet made: its money left the account when the wallet was topped up. */
export function isWalletDraw(
  row: { type: string; paymentSourceId: string | null; effectiveDate: ISODate },
  starts: ReadonlyMap<string, ISODate>,
): boolean {
  if (row.type !== "expense" || row.paymentSourceId == null) return false;
  const since = starts.get(row.paymentSourceId);
  return since != null && row.effectiveDate >= since;
}

interface WalletOutlook {
  /** The declared balance less what the wallet paid after that day, up to today. */
  remainingMinor: number;
  /** What the wallet still pays from today to the month's end. */
  dueMinor: number;
  /** How much to top up so the month's payments go through; zero when they already do. */
  shortMinor: number;
}

function afterFigure(tx: TxLike, balance: WalletBalance): boolean {
  if (tx.effectiveDate !== balance.at) return tx.effectiveDate > balance.at;
  // Parsed, not compared as text: a row pulled from the server spells its offset differently.
  return balance.recordedAt != null && tx.createdAt != null && Date.parse(tx.createdAt) > Date.parse(balance.recordedAt);
}

/**
 * A draw dated after the declaration day comes off the figure. One on that day
 * comes off only if Helix recorded it after the figure was typed: the owner
 * reads the wallet's app, which shows what it has already paid.
 */
export function walletOutlook(input: {
  sourceId: string;
  balance: WalletBalance;
  transactions: readonly TxLike[];
  planned: readonly { dueDate: ISODate; direction: "in" | "out"; amountTryMinor: number }[];
  today: ISODate;
  monthEnd: ISODate;
}): WalletOutlook {
  let remainingMinor = input.balance.minor;
  let dueMinor = 0;
  for (const tx of input.transactions) {
    if (!tx.walletDraw || tx.paymentSourceId !== input.sourceId) continue;
    if (tx.status === "realized" && afterFigure(tx, input.balance) && tx.effectiveDate <= input.today) {
      remainingMinor += signedBalanceEffect(tx);
    } else if (tx.status === "pending" && tx.effectiveDate >= input.today && tx.effectiveDate <= input.monthEnd) {
      dueMinor -= signedBalanceEffect(tx);
    }
  }
  for (const item of input.planned) {
    if (item.dueDate <= input.monthEnd) dueMinor += item.direction === "out" ? item.amountTryMinor : -item.amountTryMinor;
  }
  return { remainingMinor, dueMinor, shortMinor: Math.max(0, dueMinor - Math.max(0, remainingMinor)) };
}
