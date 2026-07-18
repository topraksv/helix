/**
 * Reconcile the balance to reality. The primary tool is "set current balance":
 * the user types the real total in their account and the difference is stored
 * as one adjustment dated today — the month-by-month chain and every prior
 * month stay exactly as they were. Editing the START MONTH + opening balance
 * (which recomputes the WHOLE table) is demoted to an advanced, collapsed
 * section, since doing that was what silently "blew up" the Mali Tablo values.
 *
 * Shared body used by the Settings sub-screen and a top-level modal opened from
 * Mali Tablo, so it always has a working back/close regardless of launch point.
 */

import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react-native";
import { restoreRow, softDelete, writeSetting } from "../db/mutations";
import { setCurrentBalance } from "../data/repo";
import { settingValue, useAdjustments, useLedger, useSettingsMap, useUserId } from "../data/hooks";
import { scheduleSync } from "../sync/engine";
import { addMonthsToKey, isCurrentOrFutureMonth, monthKeyOf, todayISO, yearOf } from "../domain/dates";
import { dateLabel, monthLabel, tr } from "../i18n/tr";
import { Amount, Body, Button, Card, CardList, Heading, IconButton, MoneyField, Row, Screen, Spread } from "./components";
import { appAlert } from "./dialog";
import { errorNotice, successNotice } from "./haptics";
import { spacing } from "./theme";
import { useUndo } from "./undo";
import { navigateBack } from "./navigation";
import { useDirtyExitGuard } from "./dirty-exit";

export function OpeningBalanceEditor() {
  const userId = useUserId();
  const settings = useSettingsMap();
  const router = useRouter();
  const bundle = useLedger(yearOf(todayISO()));
  const adjustments = useAdjustments();
  const undo = useUndo();
  const computed = bundle?.actualBalanceMinor ?? null;

  // --- primary: set current balance -----------------------------------------
  // Pristine until the user types (null): mirror the computed balance so the
  // field shows the real figure without a stale first-render snapshot.
  const [targetRaw, setTargetRaw] = useState<string | null>(null);
  const [targetMinor, setTargetMinor] = useState<number | null>(null);
  const [savingBalance, setSavingBalance] = useState(false);
  const targetValue = targetRaw ?? (computed == null ? "" : (computed / 100).toFixed(2).replace(".", ","));
  const effectiveTarget = targetRaw === null ? computed : targetMinor;
  const balanceDirty = computed != null && effectiveTarget != null && effectiveTarget !== computed;

  const saveCurrent = async () => {
    if (computed == null || effectiveTarget == null || !balanceDirty) return;
    setSavingBalance(true);
    try {
      await setCurrentBalance(userId, effectiveTarget, computed, tr.settings.balanceAdjustmentNote);
      scheduleSync(userId);
      successNotice();
      allowExit(close);
    } catch (e) {
      errorNotice();
      void appAlert(e instanceof Error ? e.message : String(e), tr.errors.title);
    } finally {
      setSavingBalance(false);
    }
  };

  // --- advanced: start month + opening balance (recomputes everything) -------
  const currentStart = settingValue<string>(settings, "start_month", monthKeyOf(todayISO()));
  const currentOpening = settingValue<number>(settings, "opening_balance_minor", 0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [draftStart, setDraftStart] = useState<string | null>(null);
  const [draftRaw, setDraftRaw] = useState<string | null>(null);
  const [draftMinor, setDraftMinor] = useState<number | null>(null);
  const [savingOpening, setSavingOpening] = useState(false);
  const startMonth = draftStart ?? currentStart;
  const openingRaw = draftRaw ?? (currentOpening / 100).toFixed(2).replace(".", ",");
  const openingMinor = draftRaw === null ? currentOpening : draftMinor;
  const openingDirty = openingMinor !== currentOpening || startMonth !== currentStart;

  const close = () => navigateBack(router, "/(tabs)/cash-flow");
  const allowExit = useDirtyExitGuard((balanceDirty || openingDirty) && !savingBalance && !savingOpening);

  const saveOpening = async () => {
    if (openingMinor == null) return;
    setSavingOpening(true);
    try {
      await writeSetting(userId, "start_month", startMonth);
      await writeSetting(userId, "opening_balance_minor", openingMinor);
      scheduleSync(userId);
      allowExit(close);
    } catch (e) {
      void appAlert(e instanceof Error ? e.message : String(e), tr.errors.title);
    } finally {
      setSavingOpening(false);
    }
  };

  const removeAdjustment = async (id: string) => {
    const snapshot = await softDelete(userId, "balance_adjustments", id);
    if (!snapshot) return;
    scheduleSync(userId);
    undo.show(
      tr.settings.balanceAdjustmentDeleted,
      () => {
        void restoreRow(userId, "balance_adjustments", snapshot).then(() => scheduleSync(userId));
      },
      "warning",
    );
  };

  // Never let the async ledger's pre-load fallback masquerade as a real zero
  // balance; the editor becomes actionable only after its accounting inputs load.
  if (computed == null) return <Screen>{null}</Screen>;
  const visibleAdjustments = [...adjustments].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Screen>
      <Body muted style={{ marginBottom: spacing.md }}>{tr.settings.openingScreenHint}</Body>

      <Card>
        <Heading style={{ marginTop: 0 }}>{tr.settings.setCurrentTitle}</Heading>
        <Spread style={{ marginBottom: spacing.md }}>
          <Body muted>{tr.settings.computedBalance}</Body>
          <Amount minor={computed} />
        </Spread>
        <MoneyField
          label={tr.settings.realBalance}
          value={targetValue}
          onChangeMinor={(raw, minor) => {
            setTargetRaw(raw);
            setTargetMinor(minor);
          }}
        />
        {!balanceDirty ? (
          <Body muted style={{ marginBottom: spacing.md, fontSize: 12 }}>{tr.settings.balanceMatches}</Body>
        ) : null}
        <Body muted style={{ marginBottom: spacing.md, fontSize: 12 }}>{tr.settings.balanceScopeHint}</Body>
        <Button label={tr.common.save} onPress={() => void saveCurrent()} disabled={!balanceDirty} loading={savingBalance} haptic="none" />
      </Card>

      <CardList
        items={visibleAdjustments}
        keyExtractor={(adjustment) => adjustment.id}
        header={
          <View style={{ marginBottom: spacing.sm }}>
            <Heading style={{ marginTop: 0 }}>{tr.settings.balanceAdjustmentsTitle}</Heading>
            <Body muted style={{ fontSize: 12 }}>{tr.settings.balanceAdjustmentsHint}</Body>
          </View>
        }
        renderItem={(adjustment) => (
          <Spread>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Body>{dateLabel(adjustment.date)}</Body>
              <Body muted style={{ fontSize: 12 }}>{adjustment.note ?? tr.settings.balanceAdjustmentFallback}</Body>
            </View>
            <Row gap={spacing.sm}>
              <Amount minor={adjustment.amountMinor} />
              <IconButton
                icon={Trash2}
                size={32}
                tone="danger"
                label={tr.common.delete}
                haptic="none"
                onPress={() => void removeAdjustment(adjustment.id)}
              />
            </Row>
          </Spread>
        )}
      />

      {showAdvanced ? (
        <Card>
          <Heading style={{ marginTop: 0 }}>{tr.settings.advancedOpeningTitle}</Heading>
          <Body muted style={{ marginBottom: spacing.md, fontSize: 12 }}>{tr.settings.advancedOpeningHint}</Body>
          <Body muted style={{ marginBottom: spacing.sm }}>{tr.onboarding.startMonth}</Body>
          <Spread style={{ marginBottom: spacing.lg }}>
            <IconButton icon={ChevronLeft} label={tr.onboarding.startMonth} onPress={() => setDraftStart(addMonthsToKey(startMonth, -1))} />
            <Heading style={{ marginVertical: 0 }}>{monthLabel(startMonth)}</Heading>
            <IconButton
              icon={ChevronRight}
              label={tr.onboarding.startMonth}
              disabled={isCurrentOrFutureMonth(startMonth)}
              onPress={() => setDraftStart(addMonthsToKey(startMonth, 1))}
            />
          </Spread>
          <MoneyField
            label={tr.onboarding.openingBalance}
            value={openingRaw}
            onChangeMinor={(raw, minor) => {
              setDraftRaw(raw);
              setDraftMinor(minor);
            }}
          />
          <Button label={tr.common.save} onPress={() => void saveOpening()} disabled={!openingDirty || openingMinor == null} loading={savingOpening} />
        </Card>
      ) : (
        <Button variant="ghost" size="sm" label={tr.settings.advancedOpeningShow} onPress={() => setShowAdvanced(true)} />
      )}

      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}
