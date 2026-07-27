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
import { SIGN_OUT_PENDING_CHANGES, useSession } from "../../../auth/session";
import { useSettingsMapState, settingValue, useUserId } from "../../../data/hooks";
import { combineLiveQueryStatus } from "../../../data/live-state";
import { asyncFieldState } from "../../../domain/form-state";
import { pendingSyncChangeCount, setPendingTableVisibility, setReminderDays } from "../../../data/repo";
import { buildExportText, buildTransactionsCsv, importBundle, MAX_BACKUP_BYTES, parseExportBundleText, saveTextFile } from "../../../services/export-import";
import { disableNotifications, enableNotifications, rescheduleAll, updateNotificationDetails } from "../../../services/notifications";
import { syncNow } from "../../../sync/engine";
import { useSyncStatus } from "../../../sync/status";
import { isSupabaseConfigured } from "../../../sync/supabase";
import { setGlobalPalettePreference, setGlobalThemePreference } from "../../_layout";
import { UserFacingError, userMessage } from "../../../domain/user-error";
import { devError } from "../../../services/logger";
import { TourModal } from "../../../ui/tour";
import { kv } from "../../../services/kv";
import { useDevicePreferences } from "../../../services/device-preferences";
import { dateLabel, tr } from "../../../i18n/tr";
import { Body, Button, Card, DataStateNotice, Field, ListRow, OperationStatusNotice, Row, Screen, SectionHeader, Segmented, Toggle, WaitingText } from "../../../ui/components";
import { appAlert, appConfirm, appPrompt } from "../../../ui/dialog";
import { OperationCancelledError, useTrackedOperation, type TrackedOperationContext } from "../../../ui/operation-guard";
import { font, radius, spacing, useTheme } from "../../../ui/theme";
import { todayISO } from "../../../domain/dates";
import { formatMinor } from "../../../domain/money";
import type { PaletteId, ThemePreference } from "../../../ui/theme";
import { readPickedText } from "../../../services/picked-file";
import { DelayedLoadingIndicator } from "../../../ui/loading-indicator";

export default function SettingsScreen() {
  const userId = useUserId();
  const { signOut, deleteAccount, verifyPassword } = useSession();
  const settingsState = useSettingsMapState();
  const settings = settingsState.data;
  const sync = useSyncStatus();
  const router = useRouter();
  const { palette, paletteId } = useTheme();
  const [themePref, setThemePref] = useState<ThemePreference>("system");
  const [biometric, setBiometric] = useState(false);
  const [localPreferencesLoaded, setLocalPreferencesLoaded] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const notifications = useDevicePreferences((state) => state.notifications);
  const notificationDetails = useDevicePreferences((state) => state.notificationDetails);
  const devicePreferencesLoaded = useDevicePreferences((state) => state.loaded);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const reminderDays = settingValue<number>(settings, "reminder_days", 3);
  const showPending = settingValue<boolean>(settings, "show_pending_in_table", true);
  // Explicit dirty state, decided in `asyncFieldState` (domain/form-state.ts).
  // `updatedAt` is the ONLY proof the settings query ran for this account, so it
  // is what separates "not loaded yet / read failed" from "loaded". While it is
  // null nothing may be saved — writing over a value that was never loaded is
  // exactly the overwrite this guards against.
  const [reminderDraft, setReminderDraft] = useState<string | null>(null);
  const reminderResolved = settingsState.updatedAt != null ? String(reminderDays) : null;
  const reminderField = asyncFieldState(reminderDraft, reminderResolved, (value) =>
    value.trim() !== "" && Number.isInteger(Number(value)) && Number(value) >= 0);
  const reminderStr = reminderField.value;

  React.useEffect(() => {
    void Promise.all([kv.get("helix.theme"), kv.get("helix.biometric")]).then(([theme, biometricValue]) => {
      if (theme === "light" || theme === "dark" || theme === "system") setThemePref(theme);
      setBiometric(biometricValue === "true");
    }).finally(() => setLocalPreferencesLoaded(true));
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
      // The session layer owns the flush and refuses to wipe rows the cloud
      // never received; this screen owns the only thing it cannot decide —
      // whether the user accepts losing them.
      const error = await signOut();
      if (error === SIGN_OUT_PENDING_CHANGES) {
        const pending = await pendingSyncChangeCount();
        const proceed = await appConfirm(tr.auth.signOutPendingTitle, tr.auth.signOutPendingWarn(pending), {
          confirmLabel: tr.auth.signOutAnyway,
          danger: true,
        });
        if (!proceed) return;
        const forced = await signOut({ force: true });
        if (forced) void appAlert(forced, tr.errors.title);
        return;
      }
      if (error) void appAlert(error, tr.errors.title);
    } catch {
      void appAlert(tr.errors.requestFailed, tr.errors.title);
    } finally {
      setSigningOut(false);
    }
  };

  // Backup/restore reads or rewrites the whole account, so it is slow enough to
  // look like nothing happened. Before, these rows were bare `void export()`
  // calls: a second tap started a concurrent full export, and a failure
  // (storage quota, permission, unreadable file) rejected into nowhere — an
  // error looked exactly like an operation still running. The shared guard
  // serialises them, the busy row reports progress, and every failure surfaces.
  const dataOps = useTrackedOperation();
  const [dataBusy, setDataBusy] = useState<"export" | "csv" | "import" | null>(null);

  const runDataOperation = async (
    kind: "export" | "csv" | "import",
    operation: (context: TrackedOperationContext) => Promise<void>,
  ) => {
    await dataOps.run(async (context) => {
      setDataBusy(kind);
      try {
        await operation(context);
      } catch (e) {
        if (e instanceof OperationCancelledError) return;
        // Backup, CSV and restore failures arrive from the file system, the
        // share sheet or a rejected bundle. Only a message authored for the
        // user may be shown; everything else stays in the dev-only log.
        devError(`settings.${kind}`, e);
        notify(`⚠ ${userMessage(e, tr.errors.requestFailed)}`);
      } finally {
        setDataBusy(null);
      }
    });
  };

  const exportJson = () =>
    runDataOperation("export", async ({ signal }) => {
      const path = await saveTextFile(
        `helix-yedek-${new Date().toISOString().slice(0, 10)}.json`,
        await buildExportText(userId, signal),
        "application/json",
      );
      if (signal.aborted) throw signal.reason;
      if (path && (await Sharing.isAvailableAsync())) await Sharing.shareAsync(path, { mimeType: "application/json" });
    });

  const exportCsv = () =>
    runDataOperation("csv", async ({ signal }) => {
      const path = await saveTextFile(
        `helix-islemler-${new Date().toISOString().slice(0, 10)}.csv`,
        await buildTransactionsCsv(userId, signal),
        "text/csv",
      );
      if (signal.aborted) throw signal.reason;
      if (path && (await Sharing.isAvailableAsync())) await Sharing.shareAsync(path, { mimeType: "text/csv" });
    });

  const importJson = async () => {
    const proceed = await appConfirm(tr.settings.import, tr.settings.importConfirm);
    if (!proceed) return;
    const picked = await DocumentPicker.getDocumentAsync({ type: "application/json", copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    await runDataOperation("import", async ({ signal, report }) => {
      if ((asset.size ?? 0) > MAX_BACKUP_BYTES) throw new UserFacingError(tr.errors.backupTooLarge);
      const content = await readPickedText(asset);
      if (signal.aborted) throw signal.reason;
      const result = await importBundle(userId, parseExportBundleText(content), {
        signal,
        onProgress: report,
      });
      const message =
        result.skipped > 0
          ? `${tr.settings.importSuccess(result.imported)} ${tr.errors.importInvalidRows(result.skipped)}`
          : tr.settings.importSuccess(result.imported);
      notify(message);
      void syncNow(userId);
    });
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
    sync.state === "idle" ? palette.success : sync.state === "error" ? palette.error : palette.warning;

  return (
    <Screen title={tr.settings.title}>
      <DataStateNotice status={combineLiveQueryStatus([settingsState])} retry={settingsState.retry} />
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
          disabled={!localPreferencesLoaded}
          onChange={(v) => {
            setThemePref(v);
            setGlobalThemePreference(v);
          }}
        />
        <Body style={{ marginBottom: spacing.sm }}>{tr.settings.palette}</Body>
        <Segmented<PaletteId>
          options={[
            { value: "clay", label: tr.settings.paletteClay },
            { value: "ocean", label: tr.settings.paletteOcean },
            { value: "forest", label: tr.settings.paletteForest },
          ]}
          value={paletteId}
          disabled={!localPreferencesLoaded}
          onChange={setGlobalPalettePreference}
        />
        {/* The field holds a one- or two-digit number, so a full-width save
            button under it left a wide empty band and read as a second, larger
            action. Beside the input it stays the smaller of the two and the row
            keeps its own bottom margin, which the field no longer carries. */}
        <Row gap={spacing.sm} style={{ alignItems: "flex-end", marginBottom: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Field
              label={tr.settings.reminderDays}
              value={reminderStr}
              onChangeText={setReminderDraft}
              keyboardType="number-pad"
              editable={settingsState.updatedAt != null}
              noMargin
            />
          </View>
          <Button
            label={tr.common.save}
            variant="secondary"
            // Full size on purpose: `sm` is 36 px against the field's 48, so
            // bottom-aligning them left a visible step. Same height, same
            // baseline, no adjustment needed.
            disabled={!reminderField.canSave}
            onPress={() => {
              const next = Number(reminderStr);
              void setReminderDays(userId, next)
                // Release the draft so the field follows the persisted value
                // again instead of pinning the just-saved string over later
                // changes.
                .then(() => {
                  setReminderDraft(null);
                  return rescheduleAll(userId);
                })
                .catch(() => void appAlert(tr.errors.saveFailed, tr.errors.title));
            }}
          />
        </Row>
        {Platform.OS !== "web" ? (
          <>
            <ListRow
              icon={ScanFace}
              title={tr.settings.biometric}
              right={
                <Toggle
                  label={tr.settings.biometric}
                  value={biometric}
                  disabled={!localPreferencesLoaded}
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
                  disabled={notificationBusy || !devicePreferencesLoaded}
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
                    disabled={notificationBusy || !devicePreferencesLoaded}
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
            {/* The switch only changes what a reminder says when it fires, so
                flipping it appeared to do nothing at all. Showing the two
                versions is what makes it a choice rather than a mystery. */}
            {notifications ? (
              <View style={{ paddingBottom: spacing.md, gap: spacing.xs }}>
                <Body muted style={{ fontSize: 12 }}>{tr.settings.notificationPreview}</Body>
                <View style={{ backgroundColor: palette.surfaceAlt, borderRadius: radius.md, padding: spacing.md, gap: 2 }}>
                  <Body style={{ fontFamily: font.medium }}>
                    {notificationDetails ? tr.notif.upcomingTitle : tr.notif.privateTitle}
                  </Body>
                  <Body muted style={{ fontSize: 12 }}>
                    {notificationDetails
                      ? tr.notif.upcoming(tr.settings.notificationSampleName, dateLabel(todayISO()), formatMinor(29_90))
                      : tr.notif.privateBody}
                  </Body>
                </View>
              </View>
            ) : null}
          </>
        ) : null}
        <ListRow
          icon={CalendarClock}
          title={tr.settings.showPending}
          subtitle={tr.settings.showPendingHint}
          right={(
            <Toggle
              label={tr.settings.showPending}
              value={showPending}
              disabled={settingsState.updatedAt == null}
              onValueChange={(value) => {
                void setPendingTableVisibility(userId, value)
                  .catch(() => void appAlert(tr.errors.saveFailed, tr.errors.title));
              }}
            />
          )}
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
          <Body accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ fontSize: 12, marginTop: spacing.xs, color: palette.errorText }}>{sync.error}</Body>
        ) : null}
        <Body muted style={{ fontSize: 12, marginTop: spacing.xs, marginBottom: spacing.sm }}>
          {tr.settings.syncExplain}
        </Body>
      </Card>

      <SectionHeader>{tr.settings.transferSection}</SectionHeader>
      <Card>
        <ListRow
          icon={FileDown}
          title={tr.settings.export}
          subtitle={tr.settings.exportDesc}
          chevron={dataBusy !== "export"}
          right={dataBusy === "export" ? <DelayedLoadingIndicator size={7} label={tr.settings.export} /> : undefined}
          onPress={() => void exportJson()}
        />
        <ListRow
          icon={FileSpreadsheet}
          title={tr.settings.exportCsv}
          subtitle={tr.settings.exportCsvDesc}
          chevron={dataBusy !== "csv"}
          right={dataBusy === "csv" ? <DelayedLoadingIndicator size={7} label={tr.settings.exportCsv} /> : undefined}
          onPress={() => void exportCsv()}
        />
        <ListRow
          icon={FileUp}
          title={tr.settings.import}
          subtitle={tr.settings.importDesc}
          chevron={dataBusy !== "import"}
          right={dataBusy === "import" ? <DelayedLoadingIndicator size={7} label={tr.settings.import} /> : undefined}
          onPress={() => void importJson()}
        />
        <ListRow icon={FileSpreadsheet} title={tr.importer.title} subtitle={tr.importer.settingsDesc} chevron onPress={() => router.push("/import-wizard")} />
      </Card>
      <OperationStatusNotice
        state={dataOps.state}
        label={
          dataBusy === "export"
            ? tr.settings.export
            : dataBusy === "csv"
              ? tr.settings.exportCsv
              : tr.settings.import
        }
        onCancel={dataOps.cancel}
      />

      <Card>
        <ListRow icon={BookOpen} title={tr.tour.replay} subtitle={tr.tour.replayDesc} chevron onPress={() => setTourOpen(true)} />
      </Card>

      <SectionHeader>{tr.account.section}</SectionHeader>
      <Card>
        {isSupabaseConfigured ? (
          <ListRow icon={KeyRound} title={tr.account.security} subtitle={tr.account.securityDesc} chevron onPress={() => router.push("/account-security" as Href)} />
        ) : null}
        {/* Signing out flushes, stops background work, clears device state and
            wipes the workspace before the screen can change. `signingOut` used
            to exist only to block a second tap, so the row sat silent through
            all of it and the wait read as a freeze. */}
        <ListRow
          icon={LogOut}
          title={tr.auth.signOut}
          // The wait is a real flush before a real wipe, and it is kept: a row
          // the user believes is saved must reach the server before the device
          // copy goes. Saying so is what turns it from a stall into a step.
          subtitle={signingOut ? <WaitingText message={tr.operation.signingOut} /> : undefined}
          right={signingOut ? <DelayedLoadingIndicator size={7} label={tr.auth.signOut} /> : undefined}
          onPress={() => void handleSignOut()}
        />
        <ListRow
          icon={Trash2}
          iconColor={palette.destructive}
          title={tr.account.delete}
          subtitle={tr.account.deleteDesc}
          right={deleting ? <DelayedLoadingIndicator size={7} label={tr.account.delete} /> : undefined}
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
