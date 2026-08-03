/** Settings hub: personalization, notifications, security, backup, sync state. */

import React, { useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useContentWidth } from "../../../ui/viewport";
import { useRouter, type Href } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import {
  Banknote,
  Bell,
  BookOpen,
  CalendarClock,
  Calculator,
  Check,
  CloudUpload,
  Columns3,
  FileDown,
  FileSpreadsheet,
  FileUp,
  Eye,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  PiggyBank,
  Target,
  ScanFace,
  Trash2,
  Sun,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
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
import { userMessage } from "../../../domain/user-error";
import { devError } from "../../../services/logger";
import { TourModal } from "../../../ui/tour";
import { kv } from "../../../services/kv";
import { useDevicePreferences } from "../../../services/device-preferences";
import { dateLabel, tr } from "../../../i18n/tr";
import { Body, Button, Card, DataStateNotice, Field, ListRow, OperationStatusNotice, Row, Screen, SectionHeader, Toggle } from "../../../ui/components";
import { appAlert, appConfirm, appPrompt } from "../../../ui/dialog";
import { OperationCancelledError, useTrackedOperation, type TrackedOperationContext } from "../../../ui/operation-guard";
import { font, PALETTES, radius, spacing, type, useTheme, type Palette, type ThemePreference } from "../../../ui/theme";
import { selectionTapIfChanged } from "../../../ui/haptics";
import { todayISO } from "../../../domain/dates";
import { formatMinor } from "../../../domain/money";
import { readPickedText } from "../../../services/picked-file";
import { DelayedLoadingIndicator } from "../../../ui/loading-indicator";
import { OperationFlow, type OperationFlowKind } from "../../../ui/operation-flow";

function ThemeChoice({
  value,
  label,
  selected,
  disabled,
  chrome,
  light,
  dark,
  onPress,
}: {
  value: ThemePreference;
  label: string;
  selected: boolean;
  disabled: boolean;
  chrome: Palette;
  light: Palette;
  dark: Palette;
  onPress: () => void;
}) {
  const Icon = value === "light" ? Sun : value === "dark" ? Moon : Monitor;
  const iconColor = value === "dark" ? dark.textStrong : light.textStrong;
  return (
    <Pressable
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityState={{ checked: selected, selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        minHeight: 82,
        padding: spacing.sm,
        gap: spacing.sm,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.md,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? chrome.primary : chrome.border + "80",
        backgroundColor: chrome.surface,
        opacity: disabled ? 0.56 : pressed ? 0.78 : 1,
        transform: [{ translateY: pressed && !disabled ? 1 : 0 }],
      })}
    >
      <View
        accessible={false}
        style={{
          width: 58,
          height: 34,
          overflow: "hidden",
          flexDirection: "row",
          borderRadius: radius.sm,
          borderWidth: 1,
          borderColor: selected ? light.primary : light.border + "70",
        }}
      >
        <View style={{ flex: 1, backgroundColor: value === "dark" ? dark.background : light.background }} />
        {value === "system" ? <View style={{ flex: 1, backgroundColor: dark.background }} /> : null}
        <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
          <Icon accessible={false} size={16} color={iconColor} strokeWidth={2} />
        </View>
      </View>
      <Text style={[type.small, { color: chrome.text, fontFamily: selected ? font.semibold : font.medium, textAlign: "center" }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function PaletteChoice({
  label,
  description,
  swatch,
  selected,
  disabled,
  stacked,
  onPress,
}: {
  label: string;
  description: string;
  swatch: Palette;
  selected: boolean;
  disabled: boolean;
  stacked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      aria-checked={selected}
      accessibilityState={{ checked: selected, selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: stacked ? "100%" : 0,
        minWidth: 0,
        minHeight: stacked ? 92 : 150,
        padding: spacing.sm,
        flexDirection: stacked ? "row" : "column",
        alignItems: stacked ? "center" : "stretch",
        gap: spacing.md,
        borderRadius: radius.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? swatch.primary : swatch.border + "80",
        backgroundColor: swatch.background,
        opacity: disabled ? 0.56 : pressed ? 0.8 : 1,
        transform: [{ translateY: pressed && !disabled ? 1 : 0 }],
      })}
    >
      <View
        accessible={false}
        style={{
          width: stacked ? 92 : "100%",
          height: stacked ? 68 : 78,
          flexShrink: 0,
          overflow: "hidden",
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: swatch.border + "70",
          backgroundColor: swatch.background,
        }}
      >
        <View
          style={{
            position: "absolute",
            left: spacing.sm,
            top: spacing.sm,
            right: stacked ? 32 : 42,
            bottom: spacing.sm,
            padding: spacing.sm,
            gap: 5,
            borderRadius: radius.sm,
            backgroundColor: swatch.surface,
          }}
        >
          <View style={{ width: "62%", height: 5, borderRadius: 3, backgroundColor: swatch.textStrong }} />
          <View style={{ width: "84%", height: 3, borderRadius: 2, backgroundColor: swatch.border }} />
          <View style={{ width: "70%", height: 3, borderRadius: 2, backgroundColor: swatch.surfaceStrong }} />
        </View>
        <View style={{ position: "absolute", right: spacing.sm, top: spacing.sm, width: 24, height: 24, borderRadius: 12, backgroundColor: swatch.primary }} />
        <View style={{ position: "absolute", right: spacing.sm, bottom: spacing.sm, flexDirection: "row", gap: 3 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: swatch.positive }} />
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: swatch.negative }} />
        </View>
        {selected ? (
          <View
            style={{
              position: "absolute",
              right: spacing.sm + 3,
              top: spacing.sm + 3,
              width: 18,
              height: 18,
              borderRadius: 9,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: swatch.primary,
            }}
          >
            <Check accessible={false} size={12} color={swatch.onPrimary} strokeWidth={3} />
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, justifyContent: "center" }}>
        <Text style={[type.body, { color: swatch.textStrong, fontFamily: font.semibold }]}>{label}</Text>
        <Text style={[type.small, { color: swatch.textSecondary, marginTop: 3, flexShrink: 1 }]}>{description}</Text>
      </View>
    </Pressable>
  );
}

type SettingsDestination = {
  icon: LucideIcon;
  title: string;
  subtitle: ReactNode;
  onPress: () => void;
};

function SettingsDestinationGrid({
  items,
  twoColumns,
  testID,
}: {
  items: SettingsDestination[];
  twoColumns: boolean;
  testID: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        columnGap: spacing.xl,
      }}
    >
      {items.map(({ icon, title, subtitle, onPress }) => (
        <View
          key={title}
          testID={testID}
          style={{
            flexBasis: twoColumns ? "45%" : "100%",
            flexGrow: 1,
            minWidth: 0,
          }}
        >
          <ListRow
            icon={icon}
            title={title}
            subtitle={subtitle}
            chevron
            onPress={onPress}
          />
        </View>
      ))}
    </View>
  );
}

function AccountActionRow({
  testID,
  icon: Icon,
  title,
  subtitle,
  busy,
  onPress,
}: {
  testID: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <View testID={testID}>
      <ListRow
        icon={Icon}
        title={title}
        subtitle={subtitle}
        chevron={!busy}
        right={busy ? <DelayedLoadingIndicator size={7} label={title} /> : undefined}
        onPress={busy ? undefined : onPress}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const userId = useUserId();
  const { signOut, deleteAccount, verifyPassword } = useSession();
  const settingsState = useSettingsMapState();
  const settings = settingsState.data;
  const sync = useSyncStatus();
  const router = useRouter();
  const contentWidth = useContentWidth();
  const { palette, paletteId, scheme } = useTheme();
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
  const signOutLocked = useRef(false);
  const handleSignOut = async () => {
    if (signOutLocked.current) return;
    signOutLocked.current = true;
    try {
      // Local-only mode (no Supabase): sign-out wipes the device with NO cloud
      // to restore from. Make the permanent loss explicit before proceeding.
      if (!isSupabaseConfigured) {
        const proceed = await appConfirm(tr.auth.signOutLocalTitle, tr.auth.signOutLocalWarn, {
          confirmLabel: tr.auth.signOutAnyway,
          danger: true,
          operation: "local-sign-out",
        });
        if (!proceed) return;
        setSigningOut(true);
        const error = await signOut();
        if (error) void appAlert(error, tr.errors.title);
        return;
      }
      const proceed = await appConfirm(tr.auth.signOut, tr.auth.signOutSignatureDescription, {
        confirmLabel: tr.auth.signOut,
        operation: "sign-out",
      });
      if (!proceed) return;
      // The session layer owns the flush and refuses to wipe rows the cloud
      // never received; this screen owns the only thing it cannot decide —
      // whether the user accepts losing them.
      setSigningOut(true);
      const error = await signOut();
      if (error === SIGN_OUT_PENDING_CHANGES) {
        const pending = await pendingSyncChangeCount();
        setSigningOut(false);
        const proceed = await appConfirm(tr.auth.signOutPendingTitle, tr.auth.signOutPendingWarn(pending), {
          confirmLabel: tr.auth.signOutAnyway,
          danger: true,
          operation: "sign-out",
        });
        if (!proceed) return;
        setSigningOut(true);
        const forced = await signOut({ force: true });
        if (forced) void appAlert(forced, tr.errors.title);
        return;
      }
      if (error) void appAlert(error, tr.errors.title);
    } catch {
      void appAlert(tr.errors.requestFailed, tr.errors.title);
    } finally {
      setSigningOut(false);
      signOutLocked.current = false;
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
      const content = await readPickedText(asset, MAX_BACKUP_BYTES, tr.errors.backupTooLarge);
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
  const confirmWithPassword = async (message: string, confirmLabel: string, operation: OperationFlowKind): Promise<boolean> => {
    if (!isSupabaseConfigured) return true;
    const pw = await appPrompt(tr.account.confirmPasswordTitle, message, {
      secure: true,
      placeholder: tr.auth.password,
      confirmLabel,
      danger: true,
      operation,
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
      operation: "delete",
    });
    if (!ok1) return;
    // Final gate: verify the password (replaces the old "are you sure?" step).
    if (!(await confirmWithPassword(tr.account.deletePasswordBody, tr.account.deleteConfirm, "delete"))) return;
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
  const workspaceDestinations: SettingsDestination[] = [
    { icon: Columns3, title: tr.settings.categories, subtitle: tr.settings.categoriesDesc, onPress: () => router.push("/settings/categories") },
    { icon: Calculator, title: tr.settings.computed, subtitle: tr.settings.computedDesc, onPress: () => router.push("/settings/computed-columns") },
    { icon: Wallet, title: tr.settings.sources, subtitle: tr.settings.sourcesDesc, onPress: () => router.push("/settings/payment-sources") },
    { icon: Users, title: tr.settings.persons, subtitle: tr.settings.personsDesc, onPress: () => router.push("/settings/persons") },
    { icon: Banknote, title: tr.settings.incomeRules, subtitle: tr.settings.incomeRulesDesc, onPress: () => router.push("/settings/incomes") },
    { icon: Target, title: tr.budgets.title, subtitle: tr.budgets.settingsDesc, onPress: () => router.push("/settings/budgets" as Href) },
  ];

  return (
    <Screen title={tr.settings.title} width="workspace">
      <DataStateNotice status={combineLiveQueryStatus([settingsState])} retry={settingsState.retry} />
      <SectionHeader>{tr.settings.balanceSection}</SectionHeader>
      <Card>
        <ListRow icon={PiggyBank} title={tr.settings.opening} subtitle={tr.settings.openingDesc} chevron onPress={() => router.push("/settings/opening-balance")} />
      </Card>

      <SectionHeader>{tr.settings.workspaceSection}</SectionHeader>
      <Card>
        <SettingsDestinationGrid
          items={workspaceDestinations}
          twoColumns={contentWidth >= 700}
          testID="settings-workspace-link"
        />
      </Card>

      <SectionHeader>{tr.settings.tools}</SectionHeader>
      <Card>
        <ListRow
          icon={Wrench}
          title={tr.settings.toolsDestination}
          subtitle={tr.settings.toolsDesc}
          chevron
          onPress={() => router.push("/settings/tools" as Href)}
        />
      </Card>

      <SectionHeader>{tr.settings.appSection}</SectionHeader>
      <Card>
        <Body style={{ marginBottom: spacing.sm }}>{tr.settings.theme}</Body>
        <View
          role="radiogroup"
          accessibilityLabel={tr.settings.theme}
          style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg }}
        >
          {([
            ["system", tr.settings.themeSystem],
            ["light", tr.settings.themeLight],
            ["dark", tr.settings.themeDark],
          ] as const).map(([value, label]) => (
            <ThemeChoice
              key={value}
              value={value}
              label={label}
              selected={themePref === value}
              disabled={!localPreferencesLoaded}
              chrome={palette}
              light={PALETTES[paletteId].light}
              dark={PALETTES[paletteId].dark}
              onPress={() => {
                selectionTapIfChanged(themePref, value);
                setThemePref(value);
                setGlobalThemePreference(value);
              }}
            />
          ))}
        </View>
        <Body style={{ marginBottom: spacing.sm }}>{tr.settings.palette}</Body>
        <View
          role="radiogroup"
          accessibilityLabel={tr.settings.palette}
          style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg }}
        >
          {([
            ["clay", tr.settings.paletteClay, tr.settings.paletteClayDesc],
            ["ocean", tr.settings.paletteOcean, tr.settings.paletteOceanDesc],
            ["forest", tr.settings.paletteForest, tr.settings.paletteForestDesc],
          ] as const).map(([id, label, description]) => (
            <PaletteChoice
              key={id}
              label={label}
              description={description}
              swatch={PALETTES[id][scheme]}
              selected={paletteId === id}
              disabled={!localPreferencesLoaded}
              stacked={contentWidth < 700}
              onPress={() => {
                selectionTapIfChanged(paletteId, id);
                setGlobalPalettePreference(id);
              }}
            />
          ))}
        </View>
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
      {isSupabaseConfigured ? (
        <Card>
          <ListRow icon={KeyRound} title={tr.account.security} subtitle={tr.account.securityDesc} chevron onPress={() => router.push("/account-security" as Href)} />
        </Card>
      ) : null}

      <Card testID="account-sign-out-card" padded={false}>
        <View style={{ paddingHorizontal: spacing.md }}>
          <AccountActionRow
            testID="account-sign-out-action"
            icon={LogOut}
            title={tr.auth.signOut}
            subtitle={isSupabaseConfigured ? tr.auth.signOutSignatureDescription : tr.auth.localSignOutSignatureDescription}
            busy={signingOut}
            onPress={() => void handleSignOut()}
          />
        </View>
        {signingOut ? (
          <View style={{ marginHorizontal: spacing.md, marginBottom: spacing.md }}>
            <OperationFlow
              kind={isSupabaseConfigured ? "sign-out" : "local-sign-out"}
              label={isSupabaseConfigured ? tr.operation.signingOut : tr.operation.localSigningOut}
            />
          </View>
        ) : null}
      </Card>

      <Card testID="account-delete-card" padded={false}>
        <View style={{ paddingHorizontal: spacing.md }}>
          <AccountActionRow
            testID="account-delete-action"
            icon={Trash2}
            title={tr.account.delete}
            subtitle={tr.account.deleteSignatureDescription}
            busy={deleting}
            onPress={() => void handleDeleteAccount()}
          />
        </View>
        {deleting ? (
          <View style={{ marginHorizontal: spacing.md, marginBottom: spacing.md }}>
            <OperationFlow kind="delete" label={tr.operation.deletingAccount} />
          </View>
        ) : null}
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
