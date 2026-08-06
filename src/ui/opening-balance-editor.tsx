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
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ArrowRight, ChevronLeft, ChevronRight, History, Info, Scale, Trash2 } from "lucide-react-native";
import { deleteBalanceAdjustment, restoreBalanceAdjustment, setBalanceDeclaration, setCurrentBalance, setOpeningBalance } from "../data/repo";
import { settingValue, useAdjustmentsState, useLedgerState, useSettingsMapState, useUserId } from "../data/hooks";
import { combineLiveQueryStatus } from "../data/live-state";
import { scheduleSync } from "../sync/engine";
import { addMonthsToKey, isCurrentOrFutureMonth, monthKeyOf, todayISO, yearOf } from "../domain/dates";
import { balanceDeclarationDrift, parseBalanceDeclaration } from "../domain/balance-declaration";
import { formatMinorCompact, formatMinorInput } from "../domain/money";
import { dateLabel, monthLabel, tr } from "../i18n/tr";
import { Amount, Badge, Body, Button, Card, CardList, DataStateNotice, EmptyState, FadeIn, IconButton, MoneyField, PanelHeader, Row, Screen, SectionHeader, Spread } from "./components";
import { appAlert } from "./dialog";
import { errorNotice, successNotice } from "./haptics";
import { userMessage } from "../domain/user-error";
import { devError } from "../services/logger";
import { circle, radius, spacing, type, useTheme } from "./theme";
import { useUndo } from "./undo";
import { navigateBack } from "./navigation";
import { useDirtyExitGuard } from "./dirty-exit";
import { WorkspaceSplit } from "./workspace-layout";

function BalanceBridge({
  computedMinor,
  targetMinor,
}: {
  computedMinor: number;
  targetMinor: number;
}) {
  const { palette } = useTheme();
  const differenceMinor = targetMinor - computedMinor;
  const changed = differenceMinor !== 0;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${tr.settings.computedBalance}: ${formatMinorCompact(computedMinor)}. ${tr.settings.balanceDifference}: ${formatMinorCompact(differenceMinor)}. ${tr.settings.realBalance}: ${formatMinorCompact(targetMinor)}.`}
      style={{
        flexDirection: "row",
        alignItems: "stretch",
        gap: spacing.sm,
        marginBottom: spacing.lg,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, justifyContent: "center" }}>
        <Body muted style={{ fontSize: type.micro.fontSize, marginBottom: spacing.xs }}>{tr.settings.computedBalance}</Body>
        <Amount minor={computedMinor} colorized={false} style={{ fontSize: type.label.fontSize, textAlign: "left" }} />
      </View>
      <View
        style={{
          width: 82,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.md,
          backgroundColor: changed ? palette.warning + "14" : palette.surfaceAlt,
          paddingHorizontal: spacing.xs,
          paddingVertical: spacing.sm,
        }}
      >
        <ArrowRight accessible={false} size={15} color={changed ? palette.warningText : palette.textSecondary} />
        <Amount
          minor={differenceMinor}
          color={differenceMinor > 0 ? palette.positiveText : differenceMinor < 0 ? palette.negativeText : palette.text}
          style={{ fontSize: type.caption.fontSize, marginTop: 2 }}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0, justifyContent: "center", alignItems: "flex-end" }}>
        <Body muted style={{ fontSize: type.micro.fontSize, marginBottom: spacing.xs, textAlign: "right" }}>{tr.settings.realBalance}</Body>
        <Amount minor={targetMinor} colorized={false} style={{ fontSize: type.label.fontSize }} />
      </View>
    </View>
  );
}

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
  const targetValue = targetRaw ?? (computed == null ? "" : formatMinorInput(computed));
  const effectiveTarget = targetRaw === null ? computed : targetMinor;
  const balanceDirty = computed != null && effectiveTarget != null && effectiveTarget !== computed;
  // What the user last confirmed against a real account, and how far the ledger
  // has moved since. Every other surface links here when this is set.
  const declaration = parseBalanceDeclaration(settingValue<unknown>(settings, "balance_declared", null));
  const declarationDrift = balanceDeclarationDrift(declaration, computed);

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
        tr.settings.balanceAdjustmentNote(formatMinorCompact(computed), formatMinorCompact(effectiveTarget)),
      );
      // Remember what was confirmed, not just the delta that made it true. It
      // is the only way a later screen can say "you told me this on that day".
      await setBalanceDeclaration(userId, effectiveTarget, todayISO());
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
  const openingRaw = draftRaw ?? formatMinorInput(currentOpening);
  const openingMinor = draftRaw === null ? currentOpening : draftMinor;
  const openingDirty = openingMinor !== currentOpening || startMonth !== currentStart;

  const close = () => navigateBack(router, "/(tabs)/cash-flow");
  const { allowExit } = useDirtyExitGuard((balanceDirty || openingDirty) && !savingBalance && !savingOpening);

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
    <Screen width="workspace">
      <DataStateNotice status={dataStatus} retry={retryData} />
      <WorkspaceSplit
        testID="balance-workspace"
        primary={(
          <Card>
        <PanelHeader
          icon={Scale}
          title={tr.settings.realBalance}
          description={tr.settings.currentBalanceFormHint}
          right={(
            <Badge
              text={balanceDirty ? tr.settings.balanceChangeReady : declarationDrift != null ? tr.settings.balanceDriftShort : tr.settings.balanceMatchesShort}
              tone={balanceDirty || declarationDrift != null ? "warning" : "success"}
            />
          )}
        />
        {declarationDrift != null && declaration ? (
          // The whole point of keeping the declaration: say the two numbers out
          // loud, with the date the user confirmed one of them.
          <View
            style={{
              marginBottom: spacing.md,
              padding: spacing.md,
              borderRadius: radius.md,
              backgroundColor: palette.warning + "16",
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: palette.warning + "70",
            }}
          >
            <Text style={[type.label, { color: palette.warningText }]}>{tr.settings.balanceDriftTitle}</Text>
            <Body muted style={{ marginTop: spacing.xs }}>
              {tr.settings.balanceDriftBody(
                formatMinorCompact(declaration.minor),
                formatMinorCompact(computed ?? 0),
                dateLabel(declaration.at),
              )}
            </Body>
          </View>
        ) : null}
        <MoneyField
          label={tr.settings.realBalance}
          value={targetValue}
          onChangeMinor={(raw, minor) => {
            setTargetRaw(raw);
            setTargetMinor(minor);
          }}
        />
        <BalanceBridge computedMinor={computed} targetMinor={effectiveTarget ?? computed} />
        <Row
          gap={spacing.sm}
          style={{
            alignItems: "flex-start",
            padding: spacing.md,
            borderRadius: radius.md,
            backgroundColor: palette.surfaceAlt,
            marginBottom: spacing.md,
          }}
        >
          <Info accessible={false} size={17} color={palette.primaryText} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Body muted style={{ fontSize: type.small.fontSize }}>{tr.settings.balanceScopeHint}</Body>
            <Body muted style={{ fontSize: type.small.fontSize }}>{tr.settings.balanceWillMark}</Body>
          </View>
        </Row>
        <Button label={tr.common.save} onPress={() => void saveCurrent()} disabled={!balanceDirty} loading={savingBalance} haptic="none" />
          </Card>
        )}
        secondary={(
          <View>
            <SectionHeader>{tr.settings.balanceAdjustmentsTitle}</SectionHeader>
            <Body muted style={{ fontSize: type.small.fontSize, marginBottom: spacing.md }}>
              {tr.settings.balanceAdjustmentsHint}
            </Body>
            <CardList
              items={visibleAdjustments}
              keyExtractor={(adjustment) => adjustment.id}
              renderItem={(adjustment) => (
                <Spread>
                  <View style={{ flex: 1, paddingRight: spacing.md }}>
                    <Body>{dateLabel(adjustment.date)}</Body>
                    <Body muted style={{ fontSize: type.small.fontSize }}>{adjustment.note ?? tr.settings.balanceAdjustmentFallback}</Body>
                  </View>
                  <Row gap={spacing.sm}>
                    <Amount minor={adjustment.amountMinor} />
                    <IconButton
                      icon={Trash2}
                      tone="danger"
                      label={`${tr.common.delete} · ${dateLabel(adjustment.date)}`}
                      haptic="none"
                      onPress={() => void removeAdjustment(adjustment.id)}
                    />
                  </Row>
                </Spread>
              )}
            />
            {visibleAdjustments.length === 0 ? (
              <EmptyState
                icon={History}
                title={tr.settings.noBalanceAdjustments}
                hint={tr.settings.noBalanceAdjustmentsHint}
              />
            ) : null}

            <SectionHeader>{tr.settings.historyOpeningTitle}</SectionHeader>
            <Card>
        <Row gap={spacing.md} style={{ alignItems: "flex-start", marginBottom: showHistory ? spacing.lg : spacing.md }}>
          <View
            accessible={false}
            style={{
              width: 36,
              height: 36,
              borderRadius: circle(36),
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: palette.surfaceAlt,
            }}
          >
            <History accessible={false} size={18} color={palette.textSecondary} />
          </View>
          <Body muted style={{ flex: 1 }}>{showHistory ? tr.settings.historyOpeningHint : tr.settings.historyOpeningSummary}</Body>
          {showHistory ? <Button label={tr.common.close} variant="ghost" size="sm" onPress={() => setShowHistory(false)} /> : null}
        </Row>
        {showHistory ? (
          <FadeIn>
            <Body muted style={{ marginBottom: spacing.sm }}>{tr.onboarding.startMonth}</Body>
            <Spread style={{ marginBottom: spacing.lg }}>
              <IconButton icon={ChevronLeft} label={tr.onboarding.startMonth} onPress={() => setDraftStart(addMonthsToKey(startMonth, -1))} />
              <Body style={{ fontSize: type.heading.fontSize }}>{monthLabel(startMonth)}</Body>
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
          </FadeIn>
        ) : (
          <Button label={tr.settings.historyOpeningAction} variant="secondary" onPress={() => setShowHistory(true)} />
        )}
            </Card>
          </View>
        )}
      />

      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}
