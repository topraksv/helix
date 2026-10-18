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
      if ((await kv.get(NEGATIVE_BALANCE_HINT_KEY)) === "true" || cancelled) return;
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
