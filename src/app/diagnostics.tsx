/** User-exportable, PII-free local incident evidence. */

import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import * as Sharing from "expo-sharing";
import { Download, RefreshCw } from "lucide-react-native";
import { useUserId } from "../data/hooks";
import { collectDiagnosticSnapshot, type DiagnosticSnapshot } from "../services/diagnostics";
import { saveTextFile } from "../services/export-import";
import { dateTimeLabel, tr } from "../i18n/tr";
import { Body, Button, Card, Screen, SectionHeader, Spread } from "../ui/components";
import { spacing } from "../ui/theme";

function value(value: string | number | boolean | null): string {
  if (value == null || value === "") return tr.common.none;
  if (typeof value === "boolean") return value ? tr.diagnostics.yes : tr.diagnostics.no;
  return String(value);
}

function ageLabel(milliseconds: number | null): string {
  if (milliseconds == null) return tr.common.none;
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 60) return tr.diagnostics.minutes(minutes);
  return tr.diagnostics.hours(Math.floor(minutes / 60));
}

export default function DiagnosticsScreen() {
  const userId = useUserId();
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      setSnapshot(await collectDiagnosticSnapshot(userId));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // userId is stable for this authenticated route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const exportSnapshot = async () => {
    if (!snapshot) return;
    const path = await saveTextFile(
      `helix-diagnostics-${snapshot.generatedAt.slice(0, 10)}.json`,
      JSON.stringify(snapshot, null, 2),
      "application/json",
    );
    if (path && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(path, { mimeType: "application/json" });
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: tr.diagnostics.title }} />
      <Body muted style={{ marginBottom: spacing.md }}>{tr.diagnostics.privacy}</Body>
      <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg }}>
        <View style={{ flex: 1 }}>
          <Button icon={RefreshCw} label={tr.common.retry} variant="secondary" loading={loading} onPress={() => void load()} />
        </View>
        <View style={{ flex: 1 }}>
          <Button icon={Download} label={tr.diagnostics.export} disabled={!snapshot} onPress={() => void exportSnapshot()} />
        </View>
      </View>
      {error ? <Body>{tr.diagnostics.loadFailed}</Body> : null}
      {snapshot ? (
        <>
          <SectionHeader>{tr.diagnostics.release}</SectionHeader>
          <Card>
            <Spread><Body muted>{tr.diagnostics.version}</Body><Body>{value(snapshot.app.version)}</Body></Spread>
            <Spread><Body muted>{tr.diagnostics.runtime}</Body><Body>{value(snapshot.app.runtimeVersion)}</Body></Spread>
            <Spread><Body muted>{tr.diagnostics.channel}</Body><Body>{value(snapshot.app.channel)}</Body></Spread>
            <Spread><Body muted>{tr.diagnostics.update}</Body><Body>{value(snapshot.app.updateId)}</Body></Spread>
            <Spread><Body muted>{tr.diagnostics.embedded}</Body><Body>{value(snapshot.app.embedded)}</Body></Spread>
          </Card>

          <SectionHeader>{tr.diagnostics.sync}</SectionHeader>
          <Card>
            <Spread><Body muted>{tr.diagnostics.state}</Body><Body>{tr.diagnostics.syncState(snapshot.sync.state)}</Body></Spread>
            <Spread><Body muted>{tr.diagnostics.lastSync}</Body><Body>{snapshot.sync.lastSyncAt ? dateTimeLabel(snapshot.sync.lastSyncAt) : tr.common.none}</Body></Spread>
            <Spread><Body muted>{tr.diagnostics.pending}</Body><Body>{snapshot.sync.pendingCount}</Body></Spread>
            <Spread><Body muted>{tr.diagnostics.oldest}</Body><Body>{ageLabel(snapshot.sync.oldestPendingAgeMs)}</Body></Spread>
            <Spread><Body muted>{tr.diagnostics.quarantined}</Body><Body>{snapshot.sync.deadLetterCount}</Body></Spread>
          </Card>

          {snapshot.sync.deadLetters.length > 0 ? (
            <>
              <SectionHeader>{tr.diagnostics.quarantineDetail}</SectionHeader>
              <Card>
                {snapshot.sync.deadLetters.map((row) => (
                  <Spread key={`${row.table}:${row.reason}`}>
                    <Body muted>{row.table} · {tr.diagnostics.quarantineReason(row.reason)}</Body>
                    <Body>{row.count}</Body>
                  </Spread>
                ))}
              </Card>
            </>
          ) : null}

          <SectionHeader>{tr.diagnostics.database}</SectionHeader>
          <Card>
            <Spread><Body muted>{tr.diagnostics.migration}</Body><Body>{value(snapshot.database.migrationId)}</Body></Spread>
            <Spread><Body muted>{tr.diagnostics.recentEvents}</Body><Body>{snapshot.events.length}</Body></Spread>
          </Card>
          {snapshot.events.length > 0 ? (
            <Card>
              {snapshot.events.map((event, index) => (
                <Spread key={`${event.at}:${index}`}>
                  <Body muted>{event.scope} · {tr.diagnostics.eventCode(event.code)}</Body>
                  <Body>{tr.diagnostics.severity(event.severity)}</Body>
                </Spread>
              ))}
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
