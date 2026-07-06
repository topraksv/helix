/** Settings hub: personalization, notifications, security, backup, sync state. */

import React, { useState } from "react";
import { Alert, Platform, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import {
  Banknote,
  BookOpen,
  CalendarClock,
  Calculator,
  CloudUpload,
  Columns3,
  FileDown,
  FileSpreadsheet,
  FileUp,
  LogOut,
  ScanFace,
  Users,
  Wallet,
} from "lucide-react-native";
import { useSession } from "../../../auth/session";
import { useSettingsMap, settingValue, useUserId } from "../../../data/hooks";
import { writeSetting } from "../../../db/mutations";
import { buildExportBundle, buildTransactionsCsv, importBundle, saveTextFile } from "../../../services/export-import";
import { rescheduleAll } from "../../../services/notifications";
import { syncNow } from "../../../sync/engine";
import { useSyncStatus } from "../../../sync/status";
import { isSupabaseConfigured } from "../../../sync/supabase";
import { setGlobalThemePreference } from "../../_layout";
import { TourModal } from "../../../ui/tour";
import { kv } from "../../../lib/kv";
import { tr } from "../../../i18n/tr";
import { Body, Button, Card, Field, ListRow, Screen, SectionHeader, Segmented, Spread } from "../../../ui/components";
import { spacing, useTheme } from "../../../ui/theme";
import type { ThemePreference } from "../../../ui/theme";

export default function SettingsScreen() {
  const userId = useUserId();
  const { signOut } = useSession();
  const settings = useSettingsMap();
  const sync = useSyncStatus();
  const router = useRouter();
  const { palette } = useTheme();
  const [themePref, setThemePref] = useState<ThemePreference>("system");
  const [biometric, setBiometric] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const reminderDays = settingValue<number>(settings, "reminder_days", 3);
  const showPending = settingValue<boolean>(settings, "show_pending_in_table", true);
  const [reminderStr, setReminderStr] = useState(String(reminderDays));

  React.useEffect(() => {
    void kv.get("helix.theme").then((v) => {
      if (v === "light" || v === "dark" || v === "system") setThemePref(v);
    });
    void kv.get("helix.biometric").then((v) => setBiometric(v === "true"));
  }, []);

  const notify = (msg: string) => (Platform.OS === "web" ? window.alert(msg) : Alert.alert(tr.app.name, msg));

  const exportJson = async () => {
    const bundle = await buildExportBundle(userId);
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
      await buildTransactionsCsv(userId),
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

  const syncStateColor =
    sync.state === "idle" ? palette.positive : sync.state === "error" ? palette.negative : palette.warning;

  return (
    <Screen title={tr.settings.title}>
      <SectionHeader>{tr.settings.workspaceSection}</SectionHeader>
      <Card>
        <ListRow icon={Columns3} title={tr.settings.categories} subtitle={tr.settings.categoriesDesc} chevron onPress={() => router.push("/settings/categories")} />
        <ListRow icon={Calculator} title={tr.settings.computed} subtitle={tr.settings.computedDesc} chevron onPress={() => router.push("/settings/computed-columns")} />
        <ListRow icon={Users} title={tr.settings.persons} subtitle={tr.settings.personsDesc} chevron onPress={() => router.push("/settings/persons")} />
        <ListRow icon={Wallet} title={tr.settings.sources} subtitle={tr.settings.sourcesDesc} chevron onPress={() => router.push("/settings/payment-sources")} />
        <ListRow icon={Banknote} title={tr.settings.incomeRules} subtitle={tr.settings.incomeRulesDesc} chevron onPress={() => router.push("/settings/incomes")} />
      </Card>

      <SectionHeader>{tr.settings.appSection}</SectionHeader>
      <Card>
        <Body style={{ marginBottom: spacing.sm }}>{tr.settings.theme}</Body>
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
        <Field
          label={tr.settings.reminderDays}
          value={reminderStr}
          onChangeText={setReminderStr}
          keyboardType="number-pad"
        />
        <Button
          label={tr.common.save}
          variant="secondary"
          size="sm"
          disabled={!Number.isInteger(Number(reminderStr)) || Number(reminderStr) < 0 || Number(reminderStr) === reminderDays}
          onPress={() => {
            void writeSetting(userId, "reminder_days", Number(reminderStr)).then(() => rescheduleAll(userId));
          }}
        />
        {Platform.OS !== "web" ? (
          <Spread style={{ marginTop: spacing.lg }}>
            <ListRow icon={ScanFace} title={tr.settings.biometric} />
            <Switch
              value={biometric}
              onValueChange={(v) => {
                setBiometric(v);
                void kv.set("helix.biometric", String(v));
              }}
            />
          </Spread>
        ) : null}
        <Spread style={{ marginTop: spacing.md }}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <ListRow icon={CalendarClock} title={tr.settings.showPending} subtitle={tr.settings.showPendingHint} />
          </View>
          <Switch
            value={showPending}
            onValueChange={(v) => void writeSetting(userId, "show_pending_in_table", v)}
          />
        </Spread>
      </Card>

      <SectionHeader>{tr.settings.dataSection}</SectionHeader>
      <Card>
        <ListRow
          icon={CloudUpload}
          title={tr.settings.sync}
          subtitle={
            tr.settings.syncState[sync.state] +
            (sync.lastSyncAt ? ` · ${tr.settings.lastSync(new Date(sync.lastSyncAt).toLocaleString("tr-TR"))}` : "") +
            (sync.error ? ` · ${sync.error}` : "") +
            (!isSupabaseConfigured ? ` · ${tr.settings.syncUnconfiguredHint}` : "")
          }
          iconColor={syncStateColor}
          right={
            <Button
              label={tr.settings.syncNow}
              variant="secondary"
              size="sm"
              onPress={() => void syncNow(userId)}
              disabled={!isSupabaseConfigured}
            />
          }
        />
        <ListRow icon={FileDown} title={tr.settings.export} subtitle={tr.settings.exportDesc} chevron onPress={() => void exportJson()} />
        <ListRow icon={FileSpreadsheet} title={tr.settings.exportCsv} subtitle={tr.settings.exportCsvDesc} chevron onPress={() => void exportCsv()} />
        <ListRow icon={FileUp} title={tr.settings.import} subtitle={tr.settings.importDesc} chevron onPress={() => void importJson()} />
        <ListRow icon={FileSpreadsheet} title={tr.importer.title} subtitle={tr.importer.settingsDesc} chevron onPress={() => router.push("/import-wizard")} />
      </Card>

      <Card>
        <ListRow icon={BookOpen} title={tr.tour.replay} subtitle={tr.tour.replayDesc} chevron onPress={() => setTourOpen(true)} />
        <ListRow icon={LogOut} iconColor={palette.negative} title={tr.auth.signOut} onPress={() => void signOut()} />
      </Card>
      {tourOpen ? <TourModal onClose={() => setTourOpen(false)} /> : null}

      <View style={{ alignItems: "center", marginTop: spacing.md }}>
        <Body muted style={{ fontSize: 12 }}>
          {tr.app.name} · {tr.app.tagline}
        </Body>
      </View>
    </Screen>
  );
}
