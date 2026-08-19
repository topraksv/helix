import { newId } from "../../db/ids";
import { pruneAttentionState, type AttentionState } from "../../domain/attention";
import { parseMatrixColorLabels, type MatrixColorLabels } from "../../domain/matrix-colors";
import { pendingOutboxCount, requeueSyncDeadLetter as requeueLocalSyncDeadLetter, writeSetting } from "../../db/mutations";

export function createRecordId(): string {
  return newId();
}

export function pendingSyncChangeCount(): Promise<number> {
  return pendingOutboxCount();
}

export function retrySyncDeadLetter(userId: string, deadLetterId: number): Promise<"requeued" | "missing" | "unsupported"> {
  return requeueLocalSyncDeadLetter(userId, deadLetterId);
}

export function setAccountFrozen(userId: string, frozen: boolean): Promise<void> {
  return writeSetting(userId, "account_frozen", frozen);
}

export function setReminderDays(userId: string, days: number): Promise<void> {
  if (!Number.isInteger(days) || days < 0 || days > 30) throw new Error("Invalid reminder days");
  return writeSetting(userId, "reminder_days", days);
}

export function setPendingTableVisibility(userId: string, visible: boolean): Promise<void> {
  return writeSetting(userId, "show_pending_in_table", visible);
}

/**
 * Rename one Mali Tablo mark colour, for the whole account.
 *
 * The whole map is written as a unit because that is how it is stored: two
 * devices renaming two different slots converge on the later write rather than
 * on a half-merged object, and a merged object is not something the sync layer
 * can produce anyway.
 */
export function setMatrixColorLabels(userId: string, labels: MatrixColorLabels): Promise<void> {
  if (parseMatrixColorLabels(labels) === null) throw new Error("Invalid matrix colour labels");
  return writeSetting(userId, "matrix_color_labels", labels);
}

/**
 * The balance the user last told the app they really have, and when.
 *
 * The reconciliation itself is a `balance_adjustments` row, which makes the
 * ledger land on that figure — and from that moment on the app has no record of
 * what was actually confirmed. Keeping the declaration is what lets every
 * surface say "you told me X on this date; the ledger now says Y" instead of
 * silently drifting away from the only number the user checked against a bank.
 */
export function setBalanceDeclaration(userId: string, minor: number, at: string): Promise<void> {
  return writeSetting(userId, "balance_declared", { minor, at });
}

/**
 * Record what the owner did to an attention item.
 *
 * Pruned on every write against the ids still being derived, so the one stored
 * value cannot grow with the age of the account — a decision about an item that
 * no longer exists is not a decision worth keeping.
 */
export async function setAttentionState(
  userId: string,
  state: AttentionState,
  liveIds: ReadonlySet<string>,
): Promise<void> {
  await writeSetting(userId, "attention_state", pruneAttentionState(state, liveIds), true);
}
