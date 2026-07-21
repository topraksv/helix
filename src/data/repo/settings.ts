import { newId } from "../../db/ids";
import { pendingOutboxCount, writeSetting } from "../../db/mutations";

export function createRecordId(): string {
  return newId();
}

export function pendingSyncChangeCount(): Promise<number> {
  return pendingOutboxCount();
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
