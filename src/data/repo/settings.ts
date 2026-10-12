import { pruneAttentionState, type AttentionState } from "../../domain/attention";
import { parseMatrixColorLabels, type MatrixColorLabels } from "../../domain/matrix-colors";
import { parseBalanceColumns, type StoredBalanceColumns } from "../../domain/matrix-preferences";
import { writeSetting } from "../../db/mutations";

export { newId as createRecordId } from "../../db/ids";
export {
  pendingOutboxCount as pendingSyncChangeCount,
  requeueSyncDeadLetter as retrySyncDeadLetter,
  // Forgets one quarantine clue; the row it points at is not touched.
  discardSyncDeadLetter as dismissSyncDeadLetter,
} from "../../db/mutations";

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

/** Rename a Mali Tablo mark colour. The whole map is one value: two devices converge on the later write, never a merge. */
export function setMatrixColorLabels(userId: string, labels: MatrixColorLabels): Promise<void> {
  if (parseMatrixColorLabels(labels) === null) throw new Error("Invalid matrix colour labels");
  return writeSetting(userId, "matrix_color_labels", labels);
}

/** The balance the user last declared and when; the adjustment row alone would lose what was actually confirmed. */
export function setBalanceDeclaration(userId: string, minor: number, at: string): Promise<void> {
  return writeSetting(userId, "balance_declared", { minor, at });
}

/** The two balance column names and whether both are drawn; one value, as the colour labels are. */
export function setBalanceColumns(userId: string, columns: StoredBalanceColumns): Promise<void> {
  if (parseBalanceColumns(columns) === null) throw new Error("Invalid balance column preference");
  return writeSetting(userId, "balance_columns", columns);
}

/** Record what the owner did to an attention item; pruned on every write so the stored value cannot grow with the account's age. */
export async function setAttentionState(
  userId: string,
  state: AttentionState,
  liveIds: ReadonlySet<string>,
): Promise<void> {
  await writeSetting(userId, "attention_state", pruneAttentionState(state, liveIds), true);
}
