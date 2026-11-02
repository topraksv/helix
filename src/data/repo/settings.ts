import { pruneAttentionState, type AttentionState } from "../../domain/attention";
import { parseMatrixColorLabels, type MatrixColorLabels } from "../../domain/matrix-colors";
import { parseBalanceColumns, type StoredBalanceColumns } from "../../domain/matrix-preferences";
import { readSetting, writeSetting } from "../../db/mutations";
import type { YearLayouts } from "../../domain/year-columns";

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

/** One year's order of one kind's columns; the other kind and every other year keep theirs. */
export async function setYearColumnOrder(userId: string, year: number, ids: readonly string[], otherKindIds: readonly string[]): Promise<void> {
  const layouts = (await readSetting<YearLayouts>(userId, "year_layouts")) ?? {};
  const key = String(year);
  await writeSetting(userId, "year_layouts", { ...layouts, [key]: { ...layouts[key], order: [...ids, ...otherKindIds] } });
}

/** Show or hide a column in one year. Showing also records it there: a year with recorded columns shows only those. */
export async function setYearColumnShown(userId: string, year: number, id: string, shown: boolean): Promise<void> {
  const key = String(year);
  const layouts = (await readSetting<YearLayouts>(userId, "year_layouts")) ?? {};
  const hidden = (layouts[key]?.hidden ?? []).filter((other) => other !== id);
  await writeSetting(userId, "year_layouts", { ...layouts, [key]: { ...layouts[key], hidden: shown ? hidden : [...hidden, id] } });
  if (!shown) return;
  const columnYears = (await readSetting<Record<string, string[]>>(userId, "column_years")) ?? {};
  const recorded = columnYears[key];
  if (Array.isArray(recorded) && !recorded.includes(id)) {
    await writeSetting(userId, "column_years", { ...columnYears, [key]: [...recorded, id] });
  }
}

/** Record what the owner did to an attention item; pruned on every write so the stored value cannot grow with the account's age. */
export async function setAttentionState(
  userId: string,
  state: AttentionState,
  liveIds: ReadonlySet<string>,
): Promise<void> {
  await writeSetting(userId, "attention_state", pruneAttentionState(state, liveIds), true);
}
