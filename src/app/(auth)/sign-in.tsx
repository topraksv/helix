import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AlertCircle, CloudOff } from "lucide-react-native";
import { useSession } from "../../auth/session";
import { isSupabaseConfigured } from "../../sync/supabase";
import { Body, Button, Field, Screen } from "../../ui/components";
import { BrandMark } from "../../ui/brand";
import { radius, spacing, type, useTheme } from "../../ui/theme";
import { tr } from "../../i18n/tr";

export default function SignInScreen() {
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { signIn, signUp } = useSession();
  const { palette } = useTheme();

  const emailValid = /.+@.+\..+/.test(email.trim());
  const canSubmit = emailValid && password.length >= 6 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const err = mode === "signIn" ? await signIn(email.trim(), password) : await signUp(email.trim(), password);
    setBusy(false);
    // On success, let the root route guard navigate (it keys off userId +
    // onboarded). Replacing to "/" here landed on a length-0 route that made the
    // guard's "(tabs)" redirect loop (React error #185 → white screen).
    if (err) setError(err);
  };

  const switchMode = () => {
    setError(null);
    setMode(mode === "signIn" ? "signUp" : "signIn");
  };

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

        <Text style={[type.heading, { color: palette.text, marginBottom: spacing.xs }]}>
          {mode === "signIn" ? tr.auth.welcomeBack : tr.auth.signUpTitle}
        </Text>
        <Body muted style={{ marginBottom: spacing.lg }}>
          {mode === "signIn" ? tr.auth.signInSubtitle : tr.auth.signUpSubtitle}
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
            <AlertCircle size={17} color={palette.negative} />
            <Text style={[type.label, { color: palette.negative, flex: 1 }]}>{error}</Text>
          </View>
        ) : null}

        <Button
          label={mode === "signIn" ? tr.auth.signIn : tr.auth.signUpTitle}
          onPress={() => void submit()}
          loading={busy}
          disabled={!canSubmit}
        />

        <View style={{ flexDirection: "row", justifyContent: "center", gap: spacing.xs, marginTop: spacing.lg }}>
          <Body muted>{mode === "signIn" ? tr.auth.noAccount : tr.auth.haveAccount}</Body>
          <Pressable accessibilityRole="button" onPress={switchMode} hitSlop={8}>
            <Text style={[type.body, { color: palette.primary, fontFamily: "Inter_600SemiBold" }]}>
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
