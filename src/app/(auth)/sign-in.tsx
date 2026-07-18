import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AlertCircle, CheckCircle2, CloudOff } from "lucide-react-native";
import { useSession } from "../../auth/session";
import { isSupabaseConfigured } from "../../sync/supabase";
import { Body, Button, Field, Screen } from "../../ui/components";
import { useSubmitOnEnter } from "../../ui/keyboard";
import { BrandMark } from "../../ui/brand";
import { radius, spacing, type, useTheme } from "../../ui/theme";
import { tr } from "../../i18n/tr";
import { useOperationGuard } from "../../ui/operation-guard";

export default function SignInScreen() {
  const [mode, setMode] = useState<"signIn" | "signUp" | "forgot">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const { signIn, signUp, requestPasswordReset } = useSession();
  const { palette } = useTheme();
  const operationGuard = useOperationGuard();

  const emailValid = /.+@.+\..+/.test(email.trim());
  const canSubmit = emailValid && (mode === "forgot" || password.length >= 6) && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    await operationGuard.run(async () => {
      setBusy(true);
      setError(null);
      try {
        const err = mode === "signIn"
          ? await signIn(email.trim(), password)
          : mode === "signUp"
            ? await signUp(email.trim(), password)
            : await requestPasswordReset(email.trim());
        // On success, let the root route guard navigate (it keys off userId +
        // onboarded). Replacing to "/" here landed on a length-0 route that made the
        // guard's "(tabs)" redirect loop (React error #185 → white screen).
        if (err) setError(err);
        else if (mode === "forgot") setResetSent(true);
      } finally {
        setBusy(false);
      }
    });
  };

  const switchMode = () => {
    setError(null);
    setResetSent(false);
    setMode(mode === "signIn" ? "signUp" : "signIn");
  };

  const showForgot = () => {
    setMode("forgot");
    setPassword("");
    setError(null);
    setResetSent(false);
  };

  useSubmitOnEnter(() => void submit(), canSubmit);

  return (
    <Screen scroll maxWidth={440}>
      <View style={{ flex: 1, justifyContent: "center", paddingVertical: spacing.xxl }}>
        {/* Brand */}
        <View style={{ alignItems: "center", marginBottom: spacing.xxl }}>
          <BrandMark size={64} />
          <Text style={[type.display, { color: palette.text, fontSize: 28, marginTop: spacing.md }]}>
            {tr.app.name}
          </Text>
          <Body muted style={{ marginTop: spacing.xs, textAlign: "center" }}>
            {tr.app.tagline}
          </Body>
        </View>

        <Text accessibilityRole="header" style={[type.heading, { color: palette.text, marginBottom: spacing.xs }]}>
          {mode === "signIn" ? tr.auth.welcomeBack : mode === "signUp" ? tr.auth.signUpTitle : tr.auth.forgotTitle}
        </Text>
        <Body muted style={{ marginBottom: spacing.lg }}>
          {mode === "signIn" ? tr.auth.signInSubtitle : mode === "signUp" ? tr.auth.signUpSubtitle : tr.auth.forgotSubtitle}
        </Body>

        <Field
          label={tr.auth.email}
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            setError(null);
          }}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          placeholder="ornek@eposta.com"
        />
        {mode !== "forgot" ? (
          <Field
            label={tr.auth.password}
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setError(null);
            }}
            secure
            autoComplete={mode === "signIn" ? "current-password" : "new-password"}
            textContentType={mode === "signIn" ? "password" : "newPassword"}
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            error={mode === "signUp" && password.length > 0 && password.length < 6 ? tr.auth.passwordMin : null}
          />
        ) : null}

        {resetSent ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              backgroundColor: palette.positive + "16",
              borderRadius: radius.sm,
              padding: spacing.md,
              marginBottom: spacing.md,
            }}
          >
            <CheckCircle2 accessible={false} size={17} color={palette.positive} />
            <Text accessibilityLiveRegion="polite" style={[type.label, { color: palette.positiveText, flex: 1 }]}>{tr.auth.resetSent}</Text>
          </View>
        ) : null}

        {error ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              backgroundColor: palette.negative + "16",
              borderRadius: radius.sm,
              padding: spacing.md,
              marginBottom: spacing.md,
            }}
          >
            <AlertCircle accessible={false} size={17} color={palette.negative} />
            <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[type.label, { color: palette.negativeText, flex: 1 }]}>{error}</Text>
          </View>
        ) : null}

        <Button
          label={resetSent ? tr.auth.backToSignIn : mode === "signIn" ? tr.auth.signIn : mode === "signUp" ? tr.auth.signUpTitle : tr.auth.sendResetLink}
          onPress={resetSent ? switchMode : () => void submit()}
          loading={busy}
          disabled={!resetSent && !canSubmit}
        />
        {mode === "signIn" ? (
          <View style={{ marginTop: spacing.sm }}>
            <Button label={tr.auth.forgotPassword} variant="ghost" onPress={showForgot} />
          </View>
        ) : null}

        <View style={{ flexDirection: "row", justifyContent: "center", gap: spacing.xs, marginTop: spacing.lg }}>
          <Body muted>{mode === "signIn" ? tr.auth.noAccount : mode === "signUp" ? tr.auth.haveAccount : tr.auth.rememberedPassword}</Body>
          <Pressable accessibilityRole="button" onPress={switchMode} hitSlop={8}>
            <Text
              style={[type.body, { color: palette.primaryText, fontFamily: "Inter_600SemiBold" }]}
            >
              {mode === "signIn" ? tr.auth.signUpAction : tr.auth.signInAction}
            </Text>
          </Pressable>
        </View>

        {/* Offline / local-only note */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            justifyContent: "center",
            marginTop: spacing.xxl,
            paddingHorizontal: spacing.lg,
          }}
        >
          <CloudOff size={14} color={palette.textMuted} />
          <Text style={[type.small, { color: palette.textMuted, textAlign: "center", flexShrink: 1 }]}>
            {isSupabaseConfigured ? tr.auth.offlineNote : tr.settings.syncUnconfiguredHint}
          </Text>
        </View>
      </View>
    </Screen>
  );
}
