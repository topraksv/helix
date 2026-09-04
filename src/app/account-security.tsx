/**
 * Account security modal: change the sign-in e-mail or password. Both require
 * the current password (re-authentication), matching the delete/freeze gate.
 */

import { useState } from "react";
import { View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import KeyRound from "lucide-react-native/icons/key-round";
import Mail from "lucide-react-native/icons/mail";
import Eraser from "lucide-react-native/icons/eraser";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import Snowflake from "lucide-react-native/icons/snowflake";
import Trash2 from "lucide-react-native/icons/trash-2";
import { useSession } from "../auth/session";
import { performAccountFreeze, type AccountFreezePhase } from "../auth/freeze";
import { useUserId } from "../data/hooks";
import { pendingSyncChangeCount, setAccountFrozen } from "../data/repo";
import { tr } from "../i18n/tr";
import { Body, Button, Card, Divider, Field, ListRow, PanelHeader, Screen } from "../ui/components";
import { appAlert, appConfirm, appPrompt } from "../ui/dialog";
import { density, spacing, type, useTheme } from "../ui/theme";
import { navigateBack } from "../ui/navigation";
import { useOperationGuard } from "../ui/operation-guard";
import { useDirtyExitGuard } from "../ui/dirty-exit";
import { scheduleSync, syncNow } from "../sync/engine";
import { isSupabaseConfigured } from "../sync/supabase";
import { WorkspaceGrid } from "../ui/workspace-layout";
import { OperationFlow } from "../ui/operation-flow";
import { clearLifecycleIntent, setLifecycleIntent } from "../ui/lifecycle-intent";
import { DelayedLoadingIndicator } from "../ui/loading-indicator";
import { isValidNewPassword } from "../domain/input";

export default function AccountSecurityScreen() {
  // Account freeze promises a cloud-confirmed write followed by sign-out. A
  // local-only workspace cannot honor either promise, so it has no security
  // action surface and direct links return to the honest local settings page.
  if (!isSupabaseConfigured) return <Redirect href="/(tabs)/settings" />;
  return <CloudAccountSecurityScreen />;
}

function CloudAccountSecurityScreen() {
  const { email, verifyPassword, changeEmail, changePassword, requestPasswordReset, signOut, deleteAccount } = useSession();
  const userId = useUserId();
  const router = useRouter();
  const operationGuard = useOperationGuard();
  const { palette } = useTheme();

  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [freezing, setFreezing] = useState(false);
  const [freezePhase, setFreezePhase] = useState<AccountFreezePhase | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { allowExit } = useDirtyExitGuard(Boolean(newEmail || emailPassword || currentPassword || newPassword));

  const emailValid = /.+@.+\..+/.test(newEmail.trim());

  const submitEmail = async () => {
    if (!emailValid || emailPassword.length < 6) return;
    try {
      await operationGuard.run(async () => {
        setEmailBusy(true);
        try {
          const verifyError = await verifyPassword(emailPassword);
          if (verifyError) {
            void appAlert(verifyError, tr.errors.title);
            return;
          }
          const err = await changeEmail(newEmail.trim());
          if (err) {
            void appAlert(err, tr.errors.title);
            return;
          }
          setNewEmail("");
          setEmailPassword("");
          void appAlert(tr.account.emailChangeSent);
        } finally {
          setEmailBusy(false);
        }
      });
    } catch {
      void appAlert(tr.errors.requestFailed, tr.errors.title);
    }
  };

  const submitPassword = async () => {
    if (currentPassword.length < 6 || !isValidNewPassword(newPassword)) return;
    try {
      await operationGuard.run(async () => {
        setPwBusy(true);
        try {
          const verifyError = await verifyPassword(currentPassword);
          if (verifyError) {
            void appAlert(verifyError, tr.errors.title);
            return;
          }
          const err = await changePassword(currentPassword, newPassword);
          if (err) {
            void appAlert(err, tr.errors.title);
            return;
          }
          setCurrentPassword("");
          setNewPassword("");
          void appAlert(tr.account.passwordChanged);
          allowExit(() => navigateBack(router, "/(tabs)/settings"));
        } finally {
          setPwBusy(false);
        }
      });
    } catch {
      void appAlert(tr.errors.requestFailed, tr.errors.title);
    }
  };

  const sendResetLink = async () => {
    if (!email) return;
    try {
      await operationGuard.run(async () => {
        setResetBusy(true);
        try {
          const error = await requestPasswordReset(email);
          void appAlert(
            error ?? tr.auth.resetSentToOwnAddress(email),
            error ? tr.errors.title : tr.account.resetLinkTitle,
          );
        } finally {
          setResetBusy(false);
        }
      });
    } catch {
      void appAlert(tr.errors.requestFailed, tr.errors.title);
    }
  };

  // The confirmation and re-authentication run inside the shared guard too, so
  const confirmWithPassword = async (message: string, confirmLabel: string): Promise<boolean> => {
    const password = await appPrompt(tr.account.confirmPasswordTitle, message, {
      secure: true,
      placeholder: tr.auth.password,
      confirmLabel,
      danger: true,
      operation: "delete",
    });
    if (password == null) return false;
    const verifyError = await verifyPassword(password);
    if (verifyError) {
      void appAlert(verifyError, tr.errors.title);
      return false;
    }
    return true;
  };

  const handleDeleteAccount = async () => {
    if (deleting) return;
    const accepted = await appConfirm(tr.account.deleteConfirm1Title, tr.account.deleteConfirm1Body, {
      confirmLabel: tr.common.delete,
      danger: true,
      operation: "delete",
    });
    if (!accepted) return;
    if (!(await confirmWithPassword(tr.account.deletePasswordBody, tr.account.deleteConfirm))) return;
    setLifecycleIntent("delete");
    setDeleting(true);
    try {
      const error = await deleteAccount();
      if (error) {
        clearLifecycleIntent();
        void appAlert(error, tr.errors.title);
      }
    } finally {
      // The intent outlives the call so the waiting screen can name the
      // operation the user actually confirmed.
      setDeleting(false);
    }
  };

  // a second press cannot arm a second freeze while the first is still asking
  // for the password.
  const freezeAccount = () =>
    operationGuard.run(async () => {
      const accepted = await appConfirm(tr.account.freezeConfirmTitle, tr.account.freezeConfirmBody, {
        confirmLabel: tr.account.freezeConfirm,
        danger: true,
        operation: "freeze",
      });
      if (!accepted) return;
      const password = await appPrompt(tr.account.confirmPasswordTitle, tr.account.freezePasswordBody, {
        secure: true,
        placeholder: tr.auth.password,
        confirmLabel: tr.account.freezeConfirm,
        danger: true,
        operation: "freeze",
      });
      if (password == null) return;
      const verifyError = await verifyPassword(password);
      if (verifyError) {
        void appAlert(verifyError, tr.errors.title);
        return;
      }

      setLifecycleIntent("freeze");
      setFreezing(true);
      useSession.setState({ isFreezing: true });
      try {
        const outcome = await performAccountFreeze({
          setFrozen: (frozen) => setAccountFrozen(userId, frozen),
          syncNow: () => syncNow(userId),
          pendingOutboxCount: pendingSyncChangeCount,
          signOut,
          scheduleSync: () => scheduleSync(userId),
          onPhase: setFreezePhase,
        });
        if (outcome.status === "failed") {
          // A failure that could not even be rolled back leaves the account
          // marked frozen locally, so it gets its own honest message instead of
          // the reassuring "nothing was frozen" one.
          const message = !outcome.rolledBack
            ? tr.account.freezeRollbackFailed
            : outcome.reason === "sync"
              ? tr.account.freezeSyncFailed
              : (outcome.message ?? tr.account.freezeSyncFailed);
          clearLifecycleIntent();
          void appAlert(message, tr.errors.title);
        }
      } finally {
        // Both flags always release. `isFreezing` suppresses the reactivation
        // gate, so leaving it set after a failure hides the one screen that
        // could explain the state. A successful freeze has already signed out.
        useSession.setState({ isFreezing: false });
        setFreezing(false);
        setFreezePhase(null);
        // The intent survives a successful freeze: the app is signing out and
        // the waiting screen has to say so. The failure path above clears it.
      }
    }).catch(() => {
      void appAlert(tr.errors.requestFailed, tr.errors.title);
    });

  return (
    <Screen width="workspace">
      <WorkspaceGrid testID="account-security-grid" layout="stack">
      <Card>
        <PanelHeader icon={Mail} title={tr.account.changeEmail} description={tr.account.changeEmailSectionHint} />
        {email ? <Body muted style={{ marginBottom: spacing.md }}>{tr.account.currentEmail(email)}</Body> : null}
        <Field
          label={tr.account.newEmail}
          value={newEmail}
          onChangeText={setNewEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          placeholder={tr.placeholders.email}
        />
        <Field
          label={tr.auth.password}
          value={emailPassword}
          onChangeText={setEmailPassword}
          secure
          autoComplete="current-password"
          textContentType="password"
          placeholder={tr.account.currentPasswordPlaceholder}
        />
        <Button label={tr.account.changeEmail} onPress={() => void submitEmail()} loading={emailBusy} disabled={!emailValid || emailPassword.length < 6} />
        <Body muted style={{ fontSize: type.small.fontSize, marginTop: spacing.sm }}>{tr.account.emailChangeHint}</Body>
      </Card>

      <Card>
        <PanelHeader icon={KeyRound} title={tr.account.changePassword} description={tr.account.changePasswordSectionHint} />
        <Field
          label={tr.account.currentPassword}
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secure
          autoComplete="current-password"
          textContentType="password"
          placeholder={tr.account.currentPasswordPlaceholder}
        />
        <Field
          label={tr.account.newPassword}
          value={newPassword}
          onChangeText={setNewPassword}
          secure
          autoComplete="new-password"
          textContentType="newPassword"
          placeholder={tr.account.newPasswordPlaceholder}
          error={newPassword.length > 0 && !isValidNewPassword(newPassword) ? tr.auth.passwordMin : null}
        />
        <Button
          label={tr.account.changePassword}
          onPress={() => void submitPassword()}
          loading={pwBusy}
          disabled={currentPassword.length < 6 || !isValidNewPassword(newPassword)}
        />
      </Card>

      <Card>
        <PanelHeader icon={RotateCcw} title={tr.auth.forgotPassword} description={tr.account.resetLinkHint} />
        <Button
          label={tr.auth.sendResetLink}
          variant="secondary"
          onPress={() => void sendResetLink()}
          loading={resetBusy}
          disabled={!email || resetBusy}
        />
      </Card>

      {/* Erasing records, above the two ways an account ends: the same kind of
          decision at a smaller scale, and the one a person reaches for first
          when what they actually want is a clean table rather than no account.
          Keeping it here means every irreversible choice is on one screen. */}
      {/* `rows`: the row IS the card here, so the card's own vertical padding
          would sit outside its pressable and the hover would light a band
          narrower than the box it lives in. */}
      <Card rows>
        <View testID="account-data-reset-action">
          <ListRow
            icon={Eraser}
            title={tr.dataReset.title}
            subtitle={tr.dataReset.entryDescription}
            chevron
            onPress={() => router.push("/data-reset")}
          />
        </View>
      </Card>

      {/* The two ways an account ends, in order of severity and in one place.
          Deleting used to live at the foot of Settings, a screen away from the
          reversible version of the same decision. */}
      <Card rows>
        <View testID="account-freeze-action">
          <ListRow
            icon={Snowflake}
            title={tr.account.freeze}
            subtitle={tr.account.freezeSignatureDescription}
            chevron={!freezing}
            right={freezing ? <DelayedLoadingIndicator size={7} label={tr.account.freeze} /> : undefined}
            onPress={freezing ? undefined : () => void freezeAccount()}
          />
        </View>
        {freezePhase ? (
          <View style={{ paddingBottom: density.list.cardPadding }}>
            <OperationFlow kind="freeze" label={tr.operation.freezePhase[freezePhase]} />
          </View>
        ) : null}
        <Divider flush />
        <View testID="account-delete-action">
          <ListRow
            icon={Trash2}
            iconColor={palette.destructive}
            title={tr.account.delete}
            subtitle={tr.account.deleteSignatureDescription}
            chevron={!deleting}
            right={deleting ? <DelayedLoadingIndicator size={7} label={tr.account.delete} /> : undefined}
            onPress={deleting ? undefined : () => void handleDeleteAccount()}
          />
        </View>
        {deleting ? (
          <View style={{ paddingBottom: density.list.cardPadding }}>
            <OperationFlow kind="delete" label={tr.operation.deletingAccount} />
          </View>
        ) : null}
      </Card>
      </WorkspaceGrid>
    </Screen>
  );
}
