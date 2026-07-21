import React, { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { AlertCircle, CheckCircle2, KeyRound } from "lucide-react-native";
import { useSession } from "../../auth/session";
import { tr } from "../../i18n/tr";
import { Body, Button, Field, Screen } from "../../ui/components";
import { useSubmitOnEnter } from "../../ui/keyboard";
import { radius, spacing, type, useTheme } from "../../ui/theme";
import { useOperationGuard } from "../../ui/operation-guard";

type RecoveryState = "checking" | "ready" | "expired" | "invalid" | "success";

export default function ResetPasswordScreen() {
  const incomingUrl = Linking.useURL();
  const router = useRouter();
  const { preparePasswordRecovery, completePasswordRecovery } = useSession();
  const { palette } = useTheme();
  const [state, setState] = useState<RecoveryState>("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const operationGuard = useOperationGuard();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const initialUrl = incomingUrl ?? await Linking.getInitialURL();
        const result = await preparePasswordRecovery(initialUrl);
        if (active) setState(result);
      } catch {
        if (active) setState("invalid");
      }
    })();
    return () => {
      active = false;
    };
  }, [incomingUrl, preparePasswordRecovery]);

  const valid = password.length >= 6 && confirmation === password && !busy;
  const save = async () => {
    if (!valid) return;
    await operationGuard.run(async () => {
      setBusy(true);
      setError(null);
      try {
        const result = await completePasswordRecovery(password);
        if (result) setError(result);
        else setState("success");
      } catch {
        setError(tr.errors.requestFailed);
      } finally {
        setBusy(false);
      }
    });
  };
  useSubmitOnEnter(() => void save(), valid);

  if (state === "checking") {
    return (
      <Screen scroll={false} maxWidth={440}>
        <View accessible accessibilityLiveRegion="polite" accessibilityLabel={tr.dataState.loading} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator accessibilityLabel={tr.dataState.loading} color={palette.primary} />
        </View>
      </Screen>
    );
  }

  const returnToSignIn = () => router.replace("/(auth)/sign-in");
  if (state === "expired" || state === "invalid" || state === "success") {
    const success = state === "success";
    return (
      <Screen scroll={false} maxWidth={440}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: (success ? palette.positive : palette.negative) + "16" }}>
            {success ? <CheckCircle2 accessible={false} size={28} color={palette.positive} /> : <AlertCircle accessible={false} size={28} color={palette.negative} />}
          </View>
          <Text
            accessibilityRole="header"
            style={[type.heading, { color: palette.text, textAlign: "center" }]}
          >
            {success ? tr.auth.resetSuccessTitle : state === "expired" ? tr.auth.resetExpiredTitle : tr.auth.resetInvalidTitle}
          </Text>
          <Body muted style={{ textAlign: "center", marginBottom: spacing.sm }}>
            {success ? tr.auth.resetSuccessBody : state === "expired" ? tr.auth.resetExpiredBody : tr.auth.resetInvalidBody}
          </Body>
          <Button label={success ? tr.auth.signInAction : tr.auth.requestNewLink} onPress={returnToSignIn} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen maxWidth={440}>
      <View style={{ paddingVertical: spacing.xxl }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: palette.primary + "16", marginBottom: spacing.lg }}>
          <KeyRound accessible={false} size={27} color={palette.primary} />
        </View>
        <Text accessibilityRole="header" style={[type.heading, { color: palette.text, marginBottom: spacing.xs }]}>{tr.auth.resetTitle}</Text>
        <Body muted style={{ marginBottom: spacing.lg }}>{tr.auth.resetSubtitle}</Body>
        <Field
          label={tr.auth.newPassword}
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            setError(null);
          }}
          secure
          autoComplete="new-password"
          textContentType="newPassword"
          error={password.length > 0 && password.length < 6 ? tr.auth.passwordMin : null}
        />
        <Field
          label={tr.auth.confirmNewPassword}
          value={confirmation}
          onChangeText={(value) => {
            setConfirmation(value);
            setError(null);
          }}
          secure
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void save()}
          error={confirmation.length > 0 && confirmation !== password ? tr.auth.passwordsMismatch : null}
        />
        {error ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: palette.negative + "16", borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md }}>
            <AlertCircle accessible={false} size={17} color={palette.negative} />
            <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[type.label, { color: palette.negativeText, flex: 1 }]}>{error}</Text>
          </View>
        ) : null}
        <Button label={tr.auth.resetSave} onPress={() => void save()} loading={busy} disabled={!valid} />
      </View>
    </Screen>
  );
}
