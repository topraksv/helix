/**
 * Data reset: empty a chosen part of the workspace without dismantling it.
 *
 * It sits under Hesap Güvenliği beside freezing and deleting the account,
 * because it is the same kind of decision at a smaller scale — and it is
 * guarded the same way, with the password prompt those two already use.
 *
 * The screen's whole job is to make sure nobody is surprised by what it does.
 * Nothing is destroyed until the exact number of rows has been shown, the
 * scopes have said in words what they take and what they leave, and anything
 * the selection cannot do has been explained BEFORE the confirmation rather
 * than as an error after it. `data/repo/reset.ts` owns the rules; this screen
 * owns saying them out loud.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import CalendarRange from "lucide-react-native/icons/calendar-range";
import Eraser from "lucide-react-native/icons/eraser";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { useSession } from "../auth/session";
import { useUserId } from "../data/hooks";
import {
  performDataReset,
  previewDataReset,
  RESET_SCOPES,
  UNDATED_SCOPES,
  type ResetPreview,
  type ResetRange,
  type ResetScope,
} from "../data/repo";
import { tr } from "../i18n/tr";
import { Body, Button, Card, Divider, Label, ListRow, PanelHeader, Screen, Toggle } from "../ui/components";
import { DateField } from "../ui/calendar";
import { appAlert, appConfirm, appPrompt } from "../ui/dialog";
import { spacing, type, useTheme } from "../ui/theme";
import { navigateBack } from "../ui/navigation";
import { useOperationGuard } from "../ui/operation-guard";
import { WorkspaceGrid } from "../ui/workspace-layout";
import { OperationFlow } from "../ui/operation-flow";
import { DelayedLoadingIndicator } from "../ui/loading-indicator";
import { isSupabaseConfigured } from "../sync/supabase";
import { scheduleSync } from "../sync/engine";
import { devWarning } from "../services/logger";

const EMPTY_RANGE: ResetRange = { from: null, to: null };

export default function DataResetScreen() {
  // Same gate as the screen this is reached from: the password re-check below
  // is a cloud credential, so a local-only workspace has no way to run it.
  if (!isSupabaseConfigured) return <Redirect href="/(tabs)/settings" />;
  return <CloudDataResetScreen />;
}

function CloudDataResetScreen() {
  const userId = useUserId();
  const router = useRouter();
  const { palette } = useTheme();
  const { verifyPassword } = useSession();
  const operationGuard = useOperationGuard();

  const [scopes, setScopes] = useState<ResetScope[]>([]);
  const [range, setRange] = useState<ResetRange>(EMPTY_RANGE);
  const [preview, setPreview] = useState<ResetPreview | null>(null);
  const [counting, setCounting] = useState(false);
  const [running, setRunning] = useState(false);

  const rangeInvalid = range.from != null && range.to != null && range.from > range.to;
  const selection = useMemo(() => ({ scopes, range }), [scopes, range]);

  /**
   * Re-count on every change to the selection.
   *
   * The cleanup flag is the point: two quick taps start two counts, and the
   * slower one must not overwrite the newer answer with a stale number that
   * names a selection the screen is no longer showing. A count is the only
   * thing standing between the owner and an irreversible write.
   */
  useEffect(() => {
    if (scopes.length === 0 || rangeInvalid) {
      setPreview(null);
      setCounting(false);
      return;
    }
    let live = true;
    setCounting(true);
    previewDataReset(userId, selection)
      .then((result) => {
        if (live) setPreview(result);
      })
      .catch((error) => {
        devWarning("data-reset.preview", String(error));
        if (live) setPreview(null);
      })
      .finally(() => {
        if (live) setCounting(false);
      });
    return () => {
      live = false;
    };
  }, [userId, selection, scopes.length, rangeInvalid]);

  const toggleScope = useCallback((scope: ResetScope) => {
    setScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  }, []);

  const blockerMessage = preview?.blocker == null
    ? null
    : preview.blocker === "insufficient_cash"
      ? tr.dataReset.blockerCash
      : tr.dataReset.blockerGeneric;

  const total = preview?.total ?? 0;
  const canRun = !running && !counting && !rangeInvalid && blockerMessage == null && total > 0;

  const submit = () =>
    operationGuard.run(async () => {
      const accepted = await appConfirm(tr.dataReset.confirmTitle, tr.dataReset.confirmBody(total), {
        confirmLabel: tr.dataReset.confirmLabel,
        danger: true,
        operation: "delete",
      });
      if (!accepted) return;
      const password = await appPrompt(tr.account.confirmPasswordTitle, tr.dataReset.passwordBody, {
        secure: true,
        placeholder: tr.auth.password,
        confirmLabel: tr.dataReset.confirmLabel,
        danger: true,
        operation: "delete",
      });
      if (password == null) return;
      const verifyError = await verifyPassword(password);
      if (verifyError) {
        void appAlert(verifyError, tr.errors.title);
        return;
      }
      setRunning(true);
      try {
        const outcome = await performDataReset(userId, selection);
        scheduleSync(userId);
        setScopes([]);
        setRange(EMPTY_RANGE);
        void appAlert(outcome.deleted > 0 ? tr.dataReset.done(outcome.deleted) : tr.dataReset.doneNothing);
        navigateBack(router, "/account-security");
      } finally {
        setRunning(false);
      }
    }).catch((error) => {
      // The write is one transaction, so a failure here left the workspace
      // exactly as it was. Say so, rather than leaving the owner wondering how
      // much of it went through.
      devWarning("data-reset.perform", String(error));
      void appAlert(tr.dataReset.failed, tr.errors.title);
    });

  return (
    <Screen width="workspace">
      <WorkspaceGrid testID="data-reset-grid" layout="stack">
        <Card>
          <PanelHeader icon={Eraser} title={tr.dataReset.scopeSection} description={tr.dataReset.intro} />
          {RESET_SCOPES.map((scope, index) => (
            <View key={scope}>
              {index > 0 ? <Divider /> : null}
              <ListRow
                title={tr.dataReset.scope[scope]}
                subtitle={tr.dataReset.scopeHint[scope]}
                stackRightOnNarrow
                right={
                  <Toggle
                    label={tr.dataReset.scope[scope]}
                    value={scopes.includes(scope)}
                    disabled={running}
                    onValueChange={() => toggleScope(scope)}
                  />
                }
              />
            </View>
          ))}
        </Card>

        <Card>
          <PanelHeader
            icon={CalendarRange}
            title={tr.dataReset.rangeSection}
            description={tr.dataReset.allDatesHint}
          />
          <DateField label={tr.dataReset.from} value={range.from} onChange={(from) => setRange((r) => ({ ...r, from }))} placeholder={tr.dataReset.allDates} />
          <DateField label={tr.dataReset.to} value={range.to} onChange={(to) => setRange((r) => ({ ...r, to }))} placeholder={tr.dataReset.allDates} />
          {range.from != null || range.to != null ? (
            <Button label={tr.dataReset.clearRange} variant="secondary" disabled={running} onPress={() => setRange(EMPTY_RANGE)} />
          ) : null}
          {rangeInvalid ? (
            <Body style={{ color: palette.destructive, marginTop: spacing.sm }}>{tr.dataReset.rangeInvalid}</Body>
          ) : null}
          {/* Said where the range is chosen, not in a footnote: a scope the
              range does not reach is the one thing a person cannot see from
              the count alone. */}
          {scopes.some((scope) => UNDATED_SCOPES.includes(scope)) ? (
            <Body muted style={{ fontSize: type.small.fontSize, marginTop: spacing.sm }}>{tr.dataReset.undatedNote}</Body>
          ) : null}
          {scopes.includes("investments") && range.to != null ? (
            <Body muted style={{ fontSize: type.small.fontSize, marginTop: spacing.sm }}>{tr.dataReset.investmentTailNote}</Body>
          ) : null}
        </Card>

        <Card>
          <PanelHeader icon={TriangleAlert} tone="error" title={tr.dataReset.summaryTitle} />
          {counting ? (
            <DelayedLoadingIndicator label={tr.dataReset.calculating} />
          ) : preview == null || preview.total === 0 ? (
            <Body muted>{tr.dataReset.summaryEmpty}</Body>
          ) : (
            <>
              {RESET_SCOPES.filter((scope) => preview.counts[scope] > 0).map((scope) => (
                <View key={scope} style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.xs }}>
                  <Body>{tr.dataReset.scope[scope]}</Body>
                  <Body>{preview.counts[scope]}</Body>
                </View>
              ))}
              <Divider />
              <Label>{tr.dataReset.summaryTotal(preview.total)}</Label>
              {preview.clearsLedgerAnchor ? (
                <Body muted style={{ fontSize: type.small.fontSize, marginTop: spacing.sm }}>{tr.dataReset.anchorNote}</Body>
              ) : null}
              {preview.straddlingPlans > 0 ? (
                <Body muted style={{ fontSize: type.small.fontSize, marginTop: spacing.sm }}>
                  {tr.dataReset.straddling(preview.straddlingPlans)}
                </Body>
              ) : null}
            </>
          )}
          {blockerMessage ? (
            <View style={{ marginTop: spacing.md }}>
              <Label style={{ color: palette.destructive }}>{tr.dataReset.blockerTitle}</Label>
              <Body accessibilityRole="alert" style={{ color: palette.destructive }}>{blockerMessage}</Body>
            </View>
          ) : null}
          <View style={{ marginTop: spacing.md }}>
            <Button label={tr.dataReset.action} variant="danger" disabled={!canRun} loading={running} onPress={() => void submit()} />
          </View>
          {running ? <OperationFlow kind="delete" label={tr.dataReset.running} /> : null}
        </Card>
      </WorkspaceGrid>
    </Screen>
  );
}
