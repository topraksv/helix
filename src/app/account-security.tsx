/**
 * Account security modal: change the sign-in e-mail or password. Both require
 * the current password (re-authentication), matching the delete/freeze gate.
 */

import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Snowflake } from "lucide-react-native";
import { useSession } from "../auth/session";
import { useUserId } from "../data/hooks";
import { pendingOutboxCount, writeSetting } from "../db/mutations";
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
  };

  const submitPassword = async () => {
    if (currentPassword.length < 6 || newPassword.length < 6) return;
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
  };

  const sendResetLink = async () => {
    if (!email) return;
    await operationGuard.run(async () => {
      setResetBusy(true);
      try {
        const error = await requestPasswordReset(email);
        void appAlert(error ?? tr.auth.resetSent, error ? tr.errors.title : tr.account.resetLinkTitle);
      } finally {
        setResetBusy(false);
      }
    });
  };

  const freezeAccount = async () => {
    if (freezing) return;
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
      await writeSetting(userId, "account_frozen", true);
      if (!isSupabaseConfigured) {
        scheduleSync(userId);
        useSession.setState({ isFreezing: false });
        return;
      }
      const synced = await syncNow(userId);
      if (!synced || (await pendingOutboxCount()) > 0) {
        await writeSetting(userId, "account_frozen", false);
        scheduleSync(userId);
        useSession.setState({ isFreezing: false });
        void appAlert(tr.account.freezeSyncFailed, tr.errors.title);
        return;
      }
      const signOutError = await signOut();
      if (signOutError) {
        await writeSetting(userId, "account_frozen", false);
        scheduleSync(userId);
        useSession.setState({ isFreezing: false });
        void appAlert(signOutError, tr.errors.title);
      }
    } finally {
      setFreezing(false);
    }
  };

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
          placeholder="ornek@eposta.com"
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
