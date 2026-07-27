/**
 * Reconcile the balance to reality. The primary tool is "set current balance":
 * the user types the real total in their account and the difference is stored
 * as one adjustment dated today — the month-by-month chain and every prior
 * month stay exactly as they were. Editing the START MONTH + opening balance
 * (which recomputes the WHOLE table) is demoted to a historical, collapsed
 * section, since doing that was what silently "blew up" the Mali Tablo values.
 *
 * Shared body used by the Settings sub-screen and a top-level modal opened from
 * Mali Tablo, so it always has a working back/close regardless of launch point.
 */

import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, History, Trash2 } from "lucide-react-native";
import { deleteBalanceAdjustment, restoreBalanceAdjustment, setCurrentBalance, setOpeningBalance } from "../data/repo";
import { settingValue, useAdjustmentsState, useLedgerState, useSettingsMapState, useUserId } from "../data/hooks";
import { combineLiveQueryStatus } from "../data/live-state";
import { scheduleSync } from "../sync/engine";
import { addMonthsToKey, isCurrentOrFutureMonth, monthKeyOf, todayISO, yearOf } from "../domain/dates";
import { formatMinor } from "../domain/money";
import { dateLabel, monthLabel, tr } from "../i18n/tr";
import { Amount, Body, Button, Card, CardList, DataStateNotice, Heading, IconButton, ListRow, MoneyField, Row, Screen, Spread } from "./components";
import { appAlert } from "./dialog";
import { errorNotice, successNotice } from "./haptics";
import { userMessage } from "../domain/user-error";
import { devError } from "../services/logger";
import { spacing, useTheme } from "./theme";
import { useUndo } from "./undo";
import { navigateBack } from "./navigation";
import { useDirtyExitGuard } from "./dirty-exit";

export function OpeningBalanceEditor() {
  const { palette } = useTheme();
  const userId = useUserId();
  const settingsState = useSettingsMapState();
  const settings = settingsState.data;
  const router = useRouter();
  const ledgerState = useLedgerState(yearOf(todayISO()));
  const adjustmentsState = useAdjustmentsState();
  const bundle = ledgerState.data;
  const adjustments = adjustmentsState.data;
  const undo = useUndo();
  const computed = bundle?.actualBalanceMinor ?? null;
  const liveStates = [settingsState, ledgerState, adjustmentsState];
  const dataStatus = combineLiveQueryStatus(liveStates);
  const dataReady = liveStates.every((state) => state.updatedAt != null);
  const retryData = () => {
    settingsState.retry();
    ledgerState.retry();
    adjustmentsState.retry();
  };

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
      // The note carries what the delta cannot: an adjustment row stores only
      // the difference, so "+₺95.000,00" on its own never said what the balance
      // went from or to.
      await setCurrentBalance(
        userId,
        effectiveTarget,
        computed,
        tr.settings.balanceAdjustmentNote(formatMinor(computed), formatMinor(effectiveTarget)),
      );
      scheduleSync(userId);
      successNotice();
      // Stays put. Correcting a balance is usually followed by looking at what
      // it did to the history right below, and closing the screen took that
      // away. The field re-derives from the new computed balance once the
      // draft is dropped, so it shows the figure that was just saved.
      setTargetRaw(null);
      setTargetMinor(null);
      undo.show(tr.settings.balanceAdjustmentSaved, null, "success");
    } catch (e) {
      errorNotice();
      devError("balance.current", e);
      void appAlert(userMessage(e, tr.errors.saveFailed), tr.errors.title);
    } finally {
      setSavingBalance(false);
    }
  };

  // Historical anchor: rarely needed, but necessary when the original setup
  // month/balance was wrong. Keep it separate from today's reconciliation.
  const currentStart = settingValue<string>(settings, "start_month", monthKeyOf(todayISO()));
  const currentOpening = settingValue<number>(settings, "opening_balance_minor", 0);
  const [showHistory, setShowHistory] = useState(false);
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
      await setOpeningBalance(userId, startMonth, openingMinor);
      scheduleSync(userId);
      allowExit(close);
    } catch (e) {
      devError("balance.opening", e);
      void appAlert(userMessage(e, tr.errors.saveFailed), tr.errors.title);
    } finally {
      setSavingOpening(false);
    }
  };

  const removeAdjustment = async (id: string) => {
    try {
      const snapshot = await deleteBalanceAdjustment(userId, id);
      if (!snapshot) return;
      scheduleSync(userId);
      undo.show(
        tr.settings.balanceAdjustmentDeleted,
        () => {
          return restoreBalanceAdjustment(userId, snapshot).then(() => scheduleSync(userId));
        },
        "warning",
      );
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
  };

  // Never let the async ledger's pre-load fallback masquerade as a real zero
  // balance; the editor becomes actionable only after its accounting inputs load.
  if (!dataReady || computed == null) {
    return (
      <Screen>
        <DataStateNotice status={computed == null && dataReady ? "error" : dataStatus} retry={retryData} />
      </Screen>
    );
  }
  const visibleAdjustments = [...adjustments].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Screen>
      <DataStateNotice status={dataStatus} retry={retryData} />
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
        {/* Said before the save, not only after it: a mark appearing in the
            table is a consequence worth knowing about while deciding. */}
        <Row gap={spacing.sm} style={{ marginBottom: spacing.md, alignItems: "flex-start" }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.primary, marginTop: 6 }} />
          <Body muted style={{ fontSize: 12, flex: 1 }}>{tr.settings.balanceWillMark}</Body>
        </Row>
        <Button label={tr.common.save} onPress={() => void saveCurrent()} disabled={!balanceDirty} loading={savingBalance} haptic="none" />
      </Card>

      <CardList
        items={visibleAdjustments}
        keyExtractor={(adjustment) => adjustment.id}
        header={
          <View style={{ marginBottom: spacing.sm }}>
            <Heading style={{ marginTop: 0 }}>{tr.settings.balanceAdjustmentsTitle}</Heading>
            <Body muted style={{ fontSize: 12 }}>{tr.settings.balanceAdjustmentsHint}</Body>
            {/* The marker is only meaningful if its meaning is stated somewhere,
                and this screen is where someone arrives after tapping it. */}
            <Row gap={spacing.sm} style={{ marginTop: spacing.sm, alignItems: "flex-start" }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.primary, marginTop: 6 }} />
              <Body muted style={{ fontSize: 12, flex: 1 }}>{tr.settings.balanceAdjustmentMarkerHint}</Body>
            </Row>
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

      {showHistory ? (
        <Card>
          <Spread style={{ marginBottom: spacing.sm }}>
            <Heading style={{ marginTop: 0, marginBottom: 0, flex: 1 }}>{tr.settings.historyOpeningTitle}</Heading>
            <Button label={tr.common.close} variant="ghost" size="sm" onPress={() => setShowHistory(false)} />
          </Spread>
          <Body muted style={{ marginBottom: spacing.md, fontSize: 12 }}>{tr.settings.historyOpeningHint}</Body>
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
        <Card>
          <ListRow
            icon={History}
            title={tr.settings.historyOpeningTitle}
            subtitle={tr.settings.historyOpeningSummary}
            chevron
            onPress={() => setShowHistory(true)}
          />
        </Card>
      )}

      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}
