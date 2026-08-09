import { newId } from "../../db/ids";
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
