import { useEffect } from "react";
import { useRouter } from "expo-router";
import { settingValue, useAdjustmentsState, useLedgerState, useSettingsMapState } from "../data/hooks";
import { combineLiveStates } from "../data/live-state";
import { needsNegativeBalanceHint } from "../domain/balance";
import { todayISO, yearOf } from "../domain/dates";
import { tr } from "../i18n/tr";
import { kv } from "../services/kv";
import { appConfirm } from "./dialog";

/** Device-wide like the tour's flag: the hint is about starting out, and asking twice on one device teaches nothing. */
const NEGATIVE_BALANCE_HINT_KEY = "helix.negative-balance-hint.done";

/** Restores in flight: the live queries can deliver the restored rows before the restore call returns. */
let restoring = 0;

/**
 * A restored backup is someone's existing record, not a start from ₺0 by
 * hand. While it is written the hint holds; once it is written the hint is
 * settled on this device. A failed restore writes nothing, so nothing is settled.
 */
export async function restoreWithoutNegativeBalanceHint<T>(restore: () => Promise<T>): Promise<T> {
  restoring += 1;
  try {
    const result = await restore();
    // The rows are committed by now: a keychain that refuses the flag costs one
    // hint later, never a written restore reported as failed.
    await kv.set(NEGATIVE_BALANCE_HINT_KEY, "true").catch(() => {});
    return result;
  } finally {
    restoring -= 1;
  }
}

/** Asks once on this device; the tabs stay mounted under every form, so it shows as the form closes. */
export function NegativeBalanceHint() {
  const router = useRouter();
  const ledger = useLedgerState(yearOf(todayISO())).data;
  const settings = useSettingsMapState();
  const adjustments = useAdjustmentsState();
  const show = ledger != null && combineLiveStates([settings, adjustments]).ready && needsNegativeBalanceHint({
    actualBalanceMinor: ledger.actualBalanceMinor,
    transactionCount: ledger.txLike.length,
    openingBalanceMinor: settingValue<number>(settings.data, "opening_balance_minor", 0),
    declared: settingValue<unknown>(settings.data, "balance_declared", null) != null,
    adjustmentCount: adjustments.data.length,
    imported: [...settings.data.keys()].some((key) => key.startsWith("import_batch:")),
  });
  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    void (async () => {
      if ((await kv.get(NEGATIVE_BALANCE_HINT_KEY)) === "true" || cancelled || restoring > 0) return;
      await kv.set(NEGATIVE_BALANCE_HINT_KEY, "true");
      const enter = await appConfirm(tr.dashboard.negativeHintTitle, tr.dashboard.negativeHintBody, {
        confirmLabel: tr.dashboard.negativeHintAction,
        cancelLabel: tr.dashboard.negativeHintLater,
      });
      if (enter) router.push("/opening-balance");
    })();
    return () => {
      cancelled = true;
    };
  }, [show, router]);
  return null;
}
