/** Settings hub: personalization, notifications, security, backup, sync state. */

import React, { useState } from "react";
import { Platform, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import {
  Banknote,
  Bell,
  BookOpen,
  CalendarClock,
  Calculator,
  CloudUpload,
  Columns3,
  FileDown,
  FileSpreadsheet,
  FileUp,
  Eye,
  KeyRound,
  LogOut,
  PiggyBank,
  Target,
  ScanFace,
  Trash2,
  Users,
  Wallet,
} from "lucide-react-native";
import { useSession } from "../../../auth/session";
import { useSettingsMap, settingValue, useUserId } from "../../../data/hooks";
import { pendingOutboxCount, writeSetting } from "../../../db/mutations";
import { buildExportText, buildTransactionsCsv, importBundle, MAX_BACKUP_BYTES, parseExportBundleText, saveTextFile } from "../../../services/export-import";
import { disableNotifications, enableNotifications, rescheduleAll, updateNotificationDetails } from "../../../services/notifications";
import { syncNow } from "../../../sync/engine";
import { useSyncStatus } from "../../../sync/status";
import { isSupabaseConfigured } from "../../../sync/supabase";
import { setGlobalThemePreference } from "../../_layout";
import { TourModal } from "../../../ui/tour";
import { kv } from "../../../services/kv";
import { useDevicePreferences } from "../../../services/device-preferences";
import { tr } from "../../../i18n/tr";
import { Body, Button, Card, Field, ListRow, Screen, SectionHeader, Segmented, Toggle } from "../../../ui/components";
import { appAlert, appConfirm, appPrompt } from "../../../ui/dialog";
import { spacing, useTheme } from "../../../ui/theme";
import type { ThemePreference } from "../../../ui/theme";
import { readPickedText } from "../../../services/picked-file";

export default function SettingsScreen() {
  const userId = useUserId();
  const { signOut, deleteAccount, verifyPassword } = useSession();
  const settings = useSettingsMap();
  const sync = useSyncStatus();
  const router = useRouter();
  const { palette } = useTheme();
  const [themePref, setThemePref] = useState<ThemePreference>("system");
  const [biometric, setBiometric] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const notifications = useDevicePreferences((state) => state.notifications);
  const notificationDetails = useDevicePreferences((state) => state.notificationDetails);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const reminderDays = settingValue<number>(settings, "reminder_days", 3);
  const showPending = settingValue<boolean>(settings, "show_pending_in_table", true);
  const [reminderStr, setReminderStr] = useState(String(reminderDays));

  React.useEffect(() => {
    void kv.get("helix.theme").then((v) => {
      if (v === "light" || v === "dark" || v === "system") setThemePref(v);
    });
    void kv.get("helix.biometric").then((v) => setBiometric(v === "true"));
  }, []);

  const notify = (msg: string) => void appAlert(msg);

  // Signing out wipes the local workspace (finance data must not linger on a
  // shared device). Before that wipe: flush the outbox with a final sync, and
  // if rows still couldn't be pushed (offline), make the user consciously
  // accept the loss instead of discovering it later.
  const [signingOut, setSigningOut] = useState(false);
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // Local-only mode (no Supabase): sign-out wipes the device with NO cloud
      // to restore from. Make the permanent loss explicit before proceeding.
      if (!isSupabaseConfigured) {
        const proceed = await appConfirm(tr.auth.signOutLocalTitle, tr.auth.signOutLocalWarn, {
          confirmLabel: tr.auth.signOutAnyway,
          danger: true,
        });
        if (!proceed) return;
        const error = await signOut();
        if (error) void appAlert(error, tr.errors.title);
        return;
      }
      if ((await pendingOutboxCount()) > 0) {
        await syncNow(userId);
      }
      const pending = await pendingOutboxCount();
      if (pending > 0) {
        const proceed = await appConfirm(tr.auth.signOutPendingTitle, tr.auth.signOutPendingWarn(pending), {
          confirmLabel: tr.auth.signOutAnyway,
          danger: true,
        });
        if (!proceed) return;
      }
      const error = await signOut();
      if (error) void appAlert(error, tr.errors.title);
    } finally {
      setSigningOut(false);
    }
  };

  const exportJson = async () => {
    const path = await saveTextFile(
      `helix-yedek-${new Date().toISOString().slice(0, 10)}.json`,
      await buildExportText(userId),
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
    const proceed = await appConfirm(tr.settings.import, tr.settings.importConfirm);
    if (!proceed) return;
    const picked = await DocumentPicker.getDocumentAsync({ type: "application/json", copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets[0]) return;
    try {
      if ((picked.assets[0].size ?? 0) > MAX_BACKUP_BYTES) throw new Error(tr.errors.backupTooLarge);
      const content = await readPickedText(picked.assets[0]);
      const result = await importBundle(userId, parseExportBundleText(content));
      const message =
        result.skipped > 0
          ? `${tr.settings.importSuccess(result.imported)} ${tr.errors.importInvalidRows(result.skipped)}`
          : tr.settings.importSuccess(result.imported);
      notify(message);
      void syncNow(userId);
    } catch (e) {
      notify(`⚠ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Re-auth gate for sensitive actions. Only meaningful with a cloud account;
  // local-only mode has no password, so it passes through.
  const confirmWithPassword = async (message: string, confirmLabel: string): Promise<boolean> => {
    if (!isSupabaseConfigured) return true;
    const pw = await appPrompt(tr.account.confirmPasswordTitle, message, {
      secure: true,
      placeholder: tr.auth.password,
      confirmLabel,
      danger: true,
    });
    if (pw == null) return false;
    const verifyError = await verifyPassword(pw);
    if (verifyError) {
      void appAlert(verifyError, tr.errors.title);
      return false;
    }
    return true;
  };

  const [deleting, setDeleting] = useState(false);
  const handleDeleteAccount = async () => {
    if (deleting) return;
    const ok1 = await appConfirm(tr.account.deleteConfirm1Title, tr.account.deleteConfirm1Body, {
      confirmLabel: tr.common.delete,
      danger: true,
    });
    if (!ok1) return;
    // Final gate: verify the password (replaces the old "are you sure?" step).
    if (!(await confirmWithPassword(tr.account.deletePasswordBody, tr.account.deleteConfirm))) return;
    setDeleting(true);
    try {
      const err = await deleteAccount();
      if (err) void appAlert(err, tr.errors.title);
    } finally {
      setDeleting(false);
    }
  };

  const syncStateColor =
    sync.state === "idle" ? palette.positive : sync.state === "error" ? palette.negative : palette.warning;

  return (
    <Screen title={tr.settings.title}>
      <SectionHeader>{tr.settings.balanceSection}</SectionHeader>
      <Card>
        <ListRow icon={PiggyBank} title={tr.settings.opening} subtitle={tr.settings.openingDesc} chevron onPress={() => router.push("/settings/opening-balance")} />
      </Card>

      <SectionHeader>{tr.settings.workspaceSection}</SectionHeader>
      <Card>
        <ListRow icon={Columns3} title={tr.settings.categories} subtitle={tr.settings.categoriesDesc} chevron onPress={() => router.push("/settings/categories")} />
        <ListRow icon={Calculator} title={tr.settings.computed} subtitle={tr.settings.computedDesc} chevron onPress={() => router.push("/settings/computed-columns")} />
        <ListRow icon={Wallet} title={tr.settings.sources} subtitle={tr.settings.sourcesDesc} chevron onPress={() => router.push("/settings/payment-sources")} />
        <ListRow icon={Users} title={tr.settings.persons} subtitle={tr.settings.personsDesc} chevron onPress={() => router.push("/settings/persons")} />
        <ListRow icon={Banknote} title={tr.settings.incomeRules} subtitle={tr.settings.incomeRulesDesc} chevron onPress={() => router.push("/settings/incomes")} />
        <ListRow icon={Target} title={tr.budgets.title} subtitle={tr.budgets.settingsDesc} chevron onPress={() => router.push("/settings/budgets" as Href)} />
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
            void writeSetting(userId, "reminder_days", Number(reminderStr))
              .then(() => rescheduleAll(userId))
              .catch(() => void appAlert(tr.errors.saveFailed, tr.errors.title));
          }}
        />
        {Platform.OS !== "web" ? (
          <>
            <ListRow
              icon={ScanFace}
              title={tr.settings.biometric}
              right={
                <Toggle
                  label={tr.settings.biometric}
                  value={biometric}
                  onValueChange={(v) => {
                    setBiometric(v);
                    void kv.set("helix.biometric", String(v));
                  }}
                />
              }
            />
            <ListRow
              icon={Bell}
              title={tr.settings.notifications}
              subtitle={tr.settings.notificationsDeviceHint}
              right={
                <Toggle
                  label={tr.settings.notifications}
                  value={notifications}
                  disabled={notificationBusy}
                  onValueChange={(enabled) => {
                    if (notificationBusy) return;
                    setNotificationBusy(true);
                    void (enabled ? enableNotifications(userId) : disableNotifications())
                      .then((granted) => {
                        if (enabled && granted === false) void appAlert(tr.settings.notificationsDenied, tr.errors.title);
                      })
                      .catch(() => void appAlert(tr.errors.saveFailed, tr.errors.title))
                      .finally(() => setNotificationBusy(false));
                  }}
                />
              }
            />
            {notifications ? (
              <ListRow
                icon={Eye}
                title={tr.settings.notificationDetails}
                subtitle={tr.settings.notificationDetailsHint}
                right={
                  <Toggle
                    label={tr.settings.notificationDetails}
                    value={notificationDetails}
                    disabled={notificationBusy}
                    onValueChange={(enabled) => {
                      if (notificationBusy) return;
                      setNotificationBusy(true);
                      void (async () => {
                        if (enabled) {
                          const accepted = await appConfirm(
                            tr.settings.notificationDetails,
                            tr.settings.notificationDetailsConfirm,
                            { confirmLabel: tr.settings.notificationDetailsEnable },
                          );
                          if (!accepted) return;
                        }
                        await updateNotificationDetails(userId, enabled);
                      })()
                        .catch(() => void appAlert(tr.errors.saveFailed, tr.errors.title))
                        .finally(() => setNotificationBusy(false));
                    }}
                  />
                }
              />
            ) : null}
          </>
        ) : null}
        <ListRow
          icon={CalendarClock}
          title={tr.settings.showPending}
          subtitle={tr.settings.showPendingHint}
          right={<Toggle label={tr.settings.showPending} value={showPending} onValueChange={(v) => void writeSetting(userId, "show_pending_in_table", v)} />}
        />
      </Card>

      <SectionHeader>{tr.settings.syncSection}</SectionHeader>
      <Card>
        <ListRow
          icon={CloudUpload}
          title={tr.settings.sync}
          subtitle={
            tr.settings.syncState[sync.state] +
            (sync.lastSyncAt ? ` · ${tr.settings.lastSync(new Date(sync.lastSyncAt).toLocaleString("tr-TR"))}` : "") +
            (!isSupabaseConfigured ? ` · ${tr.settings.syncUnconfiguredHint}` : "")
          }
          iconColor={syncStateColor}
          right={
            <Button
              label={tr.settings.syncNow}
              variant="secondary"
              size="sm"
              onPress={() => void syncNow(userId)}
              disabled={!isSupabaseConfigured || sync.state === "syncing"}
              loading={sync.state === "syncing"}
            />
          }
        />
        {sync.error ? (
          <Body accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ fontSize: 12, marginTop: spacing.xs, color: palette.negativeText }}>{sync.error}</Body>
        ) : null}
        <Body muted style={{ fontSize: 12, marginTop: spacing.xs, marginBottom: spacing.sm }}>
          {tr.settings.syncExplain}
        </Body>
      </Card>

      <SectionHeader>{tr.settings.transferSection}</SectionHeader>
      <Card>
        <ListRow icon={FileDown} title={tr.settings.export} subtitle={tr.settings.exportDesc} chevron onPress={() => void exportJson()} />
        <ListRow icon={FileSpreadsheet} title={tr.settings.exportCsv} subtitle={tr.settings.exportCsvDesc} chevron onPress={() => void exportCsv()} />
        <ListRow icon={FileUp} title={tr.settings.import} subtitle={tr.settings.importDesc} chevron onPress={() => void importJson()} />
        <ListRow icon={FileSpreadsheet} title={tr.importer.title} subtitle={tr.importer.settingsDesc} chevron onPress={() => router.push("/import-wizard")} />
      </Card>

      <Card>
        <ListRow icon={BookOpen} title={tr.tour.replay} subtitle={tr.tour.replayDesc} chevron onPress={() => setTourOpen(true)} />
      </Card>

      <SectionHeader>{tr.account.section}</SectionHeader>
      <Card>
        {/* `as Href`: expo-router typegen only refreshes the route-literal union
            on `expo start`, so a freshly added route isn't in it yet. */}
        <ListRow icon={KeyRound} title={tr.account.security} subtitle={tr.account.securityDesc} chevron onPress={() => router.push("/account-security" as Href)} />
        <ListRow icon={LogOut} title={tr.auth.signOut} onPress={() => void handleSignOut()} />
        <ListRow
          icon={Trash2}
          iconColor={palette.negative}
          title={tr.account.delete}
          subtitle={tr.account.deleteDesc}
          onPress={() => void handleDeleteAccount()}
        />
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
