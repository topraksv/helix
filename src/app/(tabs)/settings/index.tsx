/** Settings hub: personalization, notifications, security, backup, sync state. */

import React, { useState } from "react";
import { Alert, Platform, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useSession } from "../../../auth/session";
import { useSettingsMap, settingValue, useUserId } from "../../../data/hooks";
import { writeSetting } from "../../../db/mutations";
import { buildExportBundle, buildTransactionsCsv, importBundle, saveTextFile } from "../../../services/export-import";
import { rescheduleAll } from "../../../services/notifications";
import { syncNow } from "../../../sync/engine";
import { useSyncStatus } from "../../../sync/status";
import { isSupabaseConfigured } from "../../../sync/supabase";
import { setGlobalThemePreference } from "../../_layout";
import { kv } from "../../../lib/kv";
import { tr } from "../../../i18n/tr";
import { Body, Button, Card, Divider, Field, Heading, Screen, Spread, Title } from "../../../ui/components";
import { spacing } from "../../../ui/theme";
import type { ThemePreference } from "../../../ui/theme";
import { Segmented } from "../../../ui/components";

export default function SettingsScreen() {
  const userId = useUserId();
  const { signOut } = useSession();
  const settings = useSettingsMap();
  const sync = useSyncStatus();
  const router = useRouter();
  const [themePref, setThemePref] = useState<ThemePreference>("system");
  const [biometric, setBiometric] = useState(false);
  const reminderDays = settingValue<number>(settings, "reminder_days", 3);
  const [reminderStr, setReminderStr] = useState(String(reminderDays));

  React.useEffect(() => {
    void kv.get("helix.theme").then((v) => {
      if (v === "light" || v === "dark" || v === "system") setThemePref(v);
    });
    void kv.get("helix.biometric").then((v) => setBiometric(v === "true"));
  }, []);

  const notify = (msg: string) => (Platform.OS === "web" ? window.alert(msg) : Alert.alert(tr.app.name, msg));

  const exportJson = async () => {
    const bundle = buildExportBundle(userId);
    const path = await saveTextFile(
      `helix-yedek-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(bundle, null, 1),
      "application/json",
    );
    if (path && (await Sharing.isAvailableAsync())) await Sharing.shareAsync(path, { mimeType: "application/json" });
  };

  const exportCsv = async () => {
    const path = await saveTextFile(
      `helix-islemler-${new Date().toISOString().slice(0, 10)}.csv`,
      buildTransactionsCsv(userId),
      "text/csv",
    );
    if (path && (await Sharing.isAvailableAsync())) await Sharing.shareAsync(path, { mimeType: "text/csv" });
  };

  const importJson = async () => {
    const proceed =
      Platform.OS === "web"
        ? window.confirm(tr.settings.importConfirm)
        : await new Promise<boolean>((resolve) =>
            Alert.alert(tr.settings.import, tr.settings.importConfirm, [
              { text: tr.common.cancel, onPress: () => resolve(false), style: "cancel" },
              { text: tr.common.confirm, onPress: () => resolve(true) },
            ]),
          );
    if (!proceed) return;
    const picked = await DocumentPicker.getDocumentAsync({ type: "application/json", copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets[0]) return;
    try {
      const content = await new File(picked.assets[0].uri).text();
      const result = await importBundle(userId, JSON.parse(content));
      notify(tr.settings.importSuccess(result.imported));
      void syncNow(userId);
    } catch (e) {
      notify(`⚠ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <Screen>
      <Title>{tr.settings.title}</Title>

      <Card>
        <Button label={tr.settings.categories} variant="secondary" onPress={() => router.push("/settings/categories")} />
        <View style={{ height: spacing.sm }} />
        <Button label={tr.settings.computed} variant="secondary" onPress={() => router.push("/settings/computed-columns")} />
        <View style={{ height: spacing.sm }} />
        <Button label={tr.settings.persons} variant="secondary" onPress={() => router.push("/settings/persons")} />
        <View style={{ height: spacing.sm }} />
        <Button label={tr.settings.sources} variant="secondary" onPress={() => router.push("/settings/payment-sources")} />
        <View style={{ height: spacing.sm }} />
        <Button label={tr.settings.incomeRules} variant="secondary" onPress={() => router.push("/settings/incomes")} />
      </Card>

      <Card>
        <Heading style={{ marginTop: 0 }}>{tr.settings.theme}</Heading>
        <Segmented
          options={[
            { value: "system", label: tr.settings.themeSystem },
            { value: "light", label: tr.settings.themeLight },
            { value: "dark", label: tr.settings.themeDark },
          ]}
          value={themePref}
          onChange={(v) => {
            setThemePref(v);
            setGlobalThemePreference(v);
          }}
        />
      </Card>

      <Card>
        <Heading style={{ marginTop: 0 }}>{tr.settings.notifications}</Heading>
        <Field
          label={tr.settings.reminderDays}
          value={reminderStr}
          onChangeText={setReminderStr}
          keyboardType="number-pad"
        />
        <Button
          label={tr.common.save}
          variant="secondary"
          disabled={!Number.isInteger(Number(reminderStr)) || Number(reminderStr) < 0 || Number(reminderStr) === reminderDays}
          onPress={() => {
            void writeSetting(userId, "reminder_days", Number(reminderStr)).then(() => rescheduleAll(userId));
          }}
        />
        {Platform.OS !== "web" ? (
          <Spread style={{ marginTop: spacing.md }}>
            <Body>{tr.settings.biometric}</Body>
            <Switch
              value={biometric}
              onValueChange={(v) => {
                setBiometric(v);
                void kv.set("helix.biometric", String(v));
              }}
            />
          </Spread>
        ) : null}
      </Card>

      <Card>
        <Heading style={{ marginTop: 0 }}>{tr.settings.sync}</Heading>
        <Body muted>
          {tr.settings.syncState[sync.state]}
          {sync.lastSyncAt ? ` · ${tr.settings.lastSync(new Date(sync.lastSyncAt).toLocaleString("tr-TR"))}` : ""}
        </Body>
        {sync.error ? <Body style={{ marginTop: spacing.xs }}>⚠ {sync.error}</Body> : null}
        {!isSupabaseConfigured ? <Body muted style={{ marginTop: spacing.xs }}>⚠ {tr.settings.syncUnconfiguredHint}</Body> : null}
        <View style={{ height: spacing.md }} />
        <Button label={tr.settings.syncNow} variant="secondary" onPress={() => void syncNow(userId)} disabled={!isSupabaseConfigured} />
      </Card>

      <Card>
        <Button label={tr.settings.export} variant="secondary" onPress={() => void exportJson()} />
        <View style={{ height: spacing.sm }} />
        <Button label={tr.settings.exportCsv} variant="secondary" onPress={() => void exportCsv()} />
        <View style={{ height: spacing.sm }} />
        <Button label={tr.settings.import} variant="secondary" onPress={() => void importJson()} />
      </Card>

      <Divider />
      <Button label={tr.auth.signOut} variant="danger" onPress={() => void signOut()} />
    </Screen>
  );
}
