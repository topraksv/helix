/**
 * The records the cloud would not take (spec §5).
 *
 * This used to be a warning panel in the middle of Settings: a red-toned card
 * headed "Eşitlenmeyi bekleyen kayıtlar", four rows of raw table names and
 * timestamps, and two buttons — permanently, on the screen a person opens to
 * change their theme. The owner's word for it was "zulüm", and the panel had
 * earned it three ways:
 *
 *   - it was alarming about something that is not an emergency. Nothing is
 *     lost; the record is on the device and the app works;
 *   - it said "transactions kaydı · geçersiz veri" and a date, which is a log
 *     line, not a sentence anyone can act on;
 *   - its one button could not work. `requeueSyncDeadLetter` queued the same
 *     local row that had just been refused, the next push refused it again for
 *     the same reason, and the list came back. Pressing it produced an error
 *     every time, which is exactly what the owner reported.
 *
 * So the panel is a single quiet row in Settings, and this screen carries what
 * a person actually needs: what is here, what it means, what the last attempt
 * learned, and — for a row that can never be sent — a way to stop being told
 * about it that does not touch the record itself.
 */

import React, { useState } from "react";
import { View } from "react-native";
import CloudOff from "lucide-react-native/icons/cloud-off";
import FileDown from "lucide-react-native/icons/file-down";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import X from "lucide-react-native/icons/x";
import { isSupabaseConfigured } from "../sync/supabase";
import * as Sharing from "expo-sharing";
import { useSyncDeadLettersState, useUserId } from "../data/hooks";
import { dismissSyncDeadLetter, retrySyncDeadLetter } from "../data/repo";
import { buildExportText, saveTextFile } from "../services/export-import";
import { devError } from "../services/logger";
import { syncNow } from "../sync/engine";
import { dateTimeLabel, tr } from "../i18n/tr";
import {
  Body,
  Button,
  Card,
  DataStateNotice,
  EmptyState,
  IconButton,
  PanelHeader,
  Row,
  Screen,
  Spread,
} from "../ui/components";
import { appConfirm } from "../ui/dialog";
import { useUndo } from "../ui/undo";
import { spacing, type, useTheme } from "../ui/theme";

/** What the last retry learned about one row, keyed by dead-letter id. */
type Outcome = "requeued" | "missing" | "unsupported" | "unrepairable";

export default function SyncIssuesScreen() {
  const { palette } = useTheme();
  const userId = useUserId();
  const undo = useUndo();
  const deadLettersState = useSyncDeadLettersState();
  const deadLetters = deadLettersState.data;
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});

  const retryAll = async () => {
    if (busy || deadLetters.length === 0) return;
    setBusy(true);
    try {
      const results: Record<number, Outcome> = {};
      let requeued = 0;
      for (const deadLetter of deadLetters) {
        const result = await retrySyncDeadLetter(userId, deadLetter.id);
        results[deadLetter.id] = result;
        if (result === "requeued") requeued += 1;
      }
      setOutcomes((current) => ({ ...current, ...results }));
      if (requeued > 0) {
        void syncNow(userId);
        undo.show(tr.settings.syncQuarantineRetryDone(requeued));
      } else {
        // Not an error dialog. Nothing went wrong here — these rows simply
        // cannot be sent as they stand, and each one now says why.
        undo.show(tr.settings.syncQuarantineRetryNone, null, "warning");
      }
    } catch (error) {
      devError("sync-issues.retry", error);
      undo.show(`⚠ ${tr.errors.requestFailed}`, null, "warning");
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async (id: number, label: string) => {
    if (busy) return;
    if (!(await appConfirm(label, tr.settings.syncQuarantineDismissConfirm, {
      confirmLabel: tr.settings.syncQuarantineDismiss,
    }))) return;
    setBusy(true);
    try {
      if (await dismissSyncDeadLetter(id)) undo.show(tr.settings.syncQuarantineDismissed);
    } catch (error) {
      devError("sync-issues.dismiss", error);
      undo.show(`⚠ ${tr.errors.requestFailed}`, null, "warning");
    } finally {
      setBusy(false);
    }
  };

  const backup = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const path = await saveTextFile(
        `helix-yedek-${new Date().toISOString().slice(0, 10)}.json`,
        await buildExportText(userId),
        "application/json",
      );
      if (path && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(path, { mimeType: "application/json" });
      }
    } catch (error) {
      devError("sync-issues.backup", error);
      undo.show(`⚠ ${tr.errors.requestFailed}`, null, "warning");
    } finally {
      setBusy(false);
    }
  };

  if (deadLettersState.status === "loading") {
    return (
      <Screen width="form">
        <DataStateNotice status={deadLettersState.status} retry={deadLettersState.retry} />
      </Screen>
    );
  }

  if (deadLetters.length === 0) {
    return (
      <Screen width="form">
        <EmptyState
          icon={CloudOff}
          title={tr.settings.syncQuarantineEmpty}
          // An empty quarantine means "nothing is stuck", not "everything
          // reached the cloud". On a device with no cloud configured the
          // second sentence was simply false, and it contradicted Settings
          // one screen away.
          hint={isSupabaseConfigured ? tr.settings.syncQuarantineEmptyHint : tr.settings.syncQuarantineEmptyLocal}
        />
      </Screen>
    );
  }

  return (
    <Screen width="form">
      <DataStateNotice status={deadLettersState.status} retry={deadLettersState.retry} />
      <Card>
        <PanelHeader
          icon={CloudOff}
          title={tr.settings.syncQuarantineTitle}
          description={tr.settings.syncQuarantineIntro}
        />
        <Row gap={spacing.sm} style={{ flexWrap: "wrap" }}>
          <Button
            icon={RefreshCw}
            size="sm"
            label={tr.settings.syncQuarantineRetry}
            loading={busy}
            disabled={busy}
            onPress={() => void retryAll()}
          />
          <Button
            icon={FileDown}
            size="sm"
            variant="secondary"
            label={tr.settings.syncQuarantineBackup}
            disabled={busy}
            onPress={() => void backup()}
          />
        </Row>
      </Card>

      {deadLetters.map((deadLetter) => {
        // `tableName` is a raw DB string, not the finite `SyncedTableName`
        // union — a dead letter can carry a table name from a newer build than
        // this client's i18n map, so the lookup can still miss at runtime.
        const typeLabel = (tr.settings.syncQuarantineTypes as Record<string, string>)[deadLetter.tableName] ?? "kayıt";
        const reason = tr.settings.syncQuarantineReason[deadLetter.reason as keyof typeof tr.settings.syncQuarantineReason]
          ?? tr.settings.syncQuarantineReason.invalid_row;
        const title = tr.settings.syncQuarantineType(typeLabel);
        const outcome = outcomes[deadLetter.id];
        // Only a row that can never be sent offers to be forgotten. Offering it
        // on a row a retry would fix would be inviting someone to hide a
        // problem that was about to solve itself.
        const dismissible = outcome === "missing" || outcome === "unsupported";
        return (
          <Card key={deadLetter.id}>
            <Spread style={{ alignItems: "flex-start", gap: spacing.sm }}>
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Body>{title}</Body>
                <Body muted style={{ fontSize: type.small.fontSize }}>
                  {`${reason} · ${dateTimeLabel(deadLetter.quarantinedAt)}`}
                </Body>
              </View>
              {dismissible ? (
                <IconButton
                  icon={X}
                  label={`${tr.settings.syncQuarantineDismiss} · ${title}`}
                  disabled={busy}
                  onPress={() => void dismiss(deadLetter.id, title)}
                />
              ) : null}
            </Spread>
            <Body
              style={{
                marginTop: spacing.sm,
                fontSize: type.small.fontSize,
                color: outcome === "requeued" ? palette.successText : palette.textSecondary,
              }}
            >
              {outcome ? tr.settings.syncQuarantineOutcome[outcome] : tr.settings.syncQuarantineUntried}
            </Body>
          </Card>
        );
      })}
    </Screen>
  );
}
