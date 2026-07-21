/**
 * Account security modal: change the sign-in e-mail or password. Both require
 * the current password (re-authentication), matching the delete/freeze gate.
 */

import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Snowflake } from "lucide-react-native";
import { useSession } from "../auth/session";
import { performAccountFreeze } from "../auth/freeze";
import { useUserId } from "../data/hooks";
import { pendingSyncChangeCount, setAccountFrozen } from "../data/repo";
import { tr } from "../i18n/tr";
import { Body, Button, Card, Field, Heading, Screen } from "../ui/components";
import { appAlert, appConfirm, appPrompt } from "../ui/dialog";
import { spacing } from "../ui/theme";
import { navigateBack } from "../ui/navigation";
import { useOperationGuard } from "../ui/operation-guard";
import { useDirtyExitGuard } from "../ui/dirty-exit";
import { scheduleSync, syncNow } from "../sync/engine";
import { isSupabaseConfigured } from "../sync/supabase";

export default function AccountSecurityScreen() {
  const { email, verifyPassword, changeEmail, changePassword, requestPasswordReset, signOut } = useSession();
  const userId = useUserId();
  const router = useRouter();
  const operationGuard = useOperationGuard();

  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [freezing, setFreezing] = useState(false);
  const allowExit = useDirtyExitGuard(Boolean(newEmail || emailPassword || currentPassword || newPassword));

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
    if (currentPassword.length < 6 || newPassword.length < 6) return;
    try {
      await operationGuard.run(async () => {
        setPwBusy(true);
        try {
          const verifyError = await verifyPassword(currentPassword);
          if (verifyError) {
            void appAlert(verifyError, tr.errors.title);
            return;
          }
          const err = await changePassword(newPassword);
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
          void appAlert(error ?? tr.auth.resetSent, error ? tr.errors.title : tr.account.resetLinkTitle);
        } finally {
          setResetBusy(false);
        }
      });
    } catch {
      void appAlert(tr.errors.requestFailed, tr.errors.title);
    }
  };

  // The confirmation and re-authentication run inside the shared guard too, so
  // a second press cannot arm a second freeze while the first is still asking
  // for the password.
  const freezeAccount = () =>
    operationGuard.run(async () => {
      const accepted = await appConfirm(tr.account.freezeConfirmTitle, tr.account.freezeConfirmBody, {
        confirmLabel: tr.account.freezeConfirm,
        danger: true,
      });
      if (!accepted) return;
      if (isSupabaseConfigured) {
        const password = await appPrompt(tr.account.confirmPasswordTitle, tr.account.freezePasswordBody, {
          secure: true,
          placeholder: tr.auth.password,
          confirmLabel: tr.account.freezeConfirm,
          danger: true,
        });
        if (password == null) return;
        const verifyError = await verifyPassword(password);
        if (verifyError) {
          void appAlert(verifyError, tr.errors.title);
          return;
        }
      }

      setFreezing(true);
      useSession.setState({ isFreezing: true });
      try {
        const outcome = await performAccountFreeze({
          setFrozen: (frozen) => setAccountFrozen(userId, frozen),
          syncNow: () => syncNow(userId),
          pendingOutboxCount: pendingSyncChangeCount,
          signOut,
          scheduleSync: () => scheduleSync(userId),
          requiresCloud: isSupabaseConfigured,
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
          void appAlert(message, tr.errors.title);
        }
      } finally {
        // Both flags always release. `isFreezing` suppresses the reactivation
        // gate, so leaving it set after a failure hides the one screen that
        // could explain the state. A successful freeze has already signed out.
        useSession.setState({ isFreezing: false });
        setFreezing(false);
      }
    }).catch(() => {
      void appAlert(tr.errors.requestFailed, tr.errors.title);
    });

  return (
    <Screen>
      {isSupabaseConfigured ? (
        <>
      <Card>
        <Heading style={{ marginTop: 0 }}>{tr.account.changeEmail}</Heading>
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
        <Body muted style={{ fontSize: 12, marginTop: spacing.sm }}>{tr.account.emailChangeHint}</Body>
      </Card>

      <View style={{ height: spacing.md }} />

      <Card>
        <Heading style={{ marginTop: 0 }}>{tr.account.changePassword}</Heading>
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
          error={newPassword.length > 0 && newPassword.length < 6 ? tr.auth.passwordMin : null}
        />
        <Button
          label={tr.account.changePassword}
          onPress={() => void submitPassword()}
          loading={pwBusy}
          disabled={currentPassword.length < 6 || newPassword.length < 6}
        />
      </Card>

      <View style={{ height: spacing.md }} />

      <Card>
        <Heading style={{ marginTop: 0 }}>{tr.auth.forgotPassword}</Heading>
        <Body muted style={{ marginBottom: spacing.md }}>{tr.account.resetLinkHint}</Body>
        <Button
          label={tr.auth.sendResetLink}
          variant="secondary"
          onPress={() => void sendResetLink()}
          loading={resetBusy}
          disabled={!email || resetBusy}
        />
      </Card>

      <View style={{ height: spacing.md }} />
        </>
      ) : null}

      <Card>
        <Heading style={{ marginTop: 0 }}>{tr.account.freeze}</Heading>
        <Body muted style={{ marginBottom: spacing.md }}>{tr.account.freezeDesc}</Body>
        <Button
          icon={Snowflake}
          label={tr.account.freeze}
          variant="danger"
          onPress={() => void freezeAccount()}
          loading={freezing}
        />
      </Card>
    </Screen>
  );
}
