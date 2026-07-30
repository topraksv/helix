import React, { useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AlertCircle, BellRing, CheckCircle2, CloudOff, Table2, WalletCards } from "lucide-react-native";
import { useSession } from "../../auth/session";
import { isSupabaseConfigured } from "../../sync/supabase";
import { Body, Button, Card, Field, Screen } from "../../ui/components";
import { useSubmitOnEnter } from "../../ui/keyboard";
import { BrandMark } from "../../ui/brand";
import { font, radius, spacing, type, useTheme } from "../../ui/theme";
import { tr } from "../../i18n/tr";
import { useOperationGuard } from "../../ui/operation-guard";
import { OperationFlow } from "../../ui/operation-flow";

function JourneyNode({
  icon: Icon,
  label,
  active,
}: {
  icon: typeof WalletCards;
  label: string;
  active?: boolean;
}) {
  const { palette } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", minWidth: 0 }}>
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 16,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: active ? palette.primary : palette.surfaceAlt,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: active ? palette.primaryStrong : palette.border,
        }}
      >
        <Icon accessible={false} size={21} strokeWidth={1.8} color={active ? palette.onPrimary : palette.textSecondary} />
      </View>
      <Text
        style={[type.small, {
          color: active ? palette.accentText : palette.textSecondary,
          fontFamily: font.semibold,
          textAlign: "center",
          marginTop: spacing.xs,
        }]}
      >
        {label}
      </Text>
    </View>
  );
}

function AuthJourneyArtwork({ compact }: { compact: boolean }) {
  const { palette } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${tr.auth.journeyEntry}, ${tr.auth.journeyLedger}, ${tr.auth.journeyTrack}`}
      style={{
        minHeight: compact ? 132 : 286,
        borderRadius: radius.lg,
        backgroundColor: palette.surfaceAlt,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border + "90",
        overflow: "hidden",
        justifyContent: "center",
        padding: compact ? spacing.md : spacing.xl,
      }}
    >
      <View
        accessible={false}
        style={{
          position: "absolute",
          width: compact ? 180 : 320,
          height: compact ? 180 : 320,
          borderRadius: 999,
          backgroundColor: palette.primarySoft,
          opacity: 0.68,
          top: compact ? -105 : -175,
          right: compact ? -65 : -120,
        }}
      />
      <View
        accessible={false}
        style={{
          position: "absolute",
          width: compact ? 95 : 170,
          height: compact ? 95 : 170,
          borderRadius: 999,
          backgroundColor: palette.secondarySoft,
          opacity: 0.72,
          bottom: compact ? -55 : -90,
          left: compact ? -25 : -45,
        }}
      />
      <View style={{ flexDirection: "row", alignItems: "flex-start", width: "100%" }}>
        <JourneyNode icon={WalletCards} label={tr.auth.journeyEntry} active />
        <View style={{ flex: 0.52, height: 1, backgroundColor: palette.border, marginTop: 23 }} />
        <JourneyNode icon={Table2} label={tr.auth.journeyLedger} />
        <View style={{ flex: 0.52, height: 1, backgroundColor: palette.border, marginTop: 23 }} />
        <JourneyNode icon={BellRing} label={tr.auth.journeyTrack} />
      </View>
      {!compact ? (
        <View style={{ marginTop: spacing.xl }}>
          {[0.72, 0.48, 0.86].map((value, index) => (
            <View key={value} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: index ? spacing.sm : 0 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: [palette.primary, palette.secondary, palette.tertiary][index] }} />
              <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: palette.surfaceStrong + "80" }}>
                <View style={{ width: `${value * 100}%`, height: 6, borderRadius: 3, backgroundColor: [palette.primary, palette.secondary, palette.tertiary][index] }} />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function SignInScreen() {
  const [mode, setMode] = useState<"signIn" | "signUp" | "forgot">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const { signIn, signUp, requestPasswordReset } = useSession();
  const { palette } = useTheme();
  const { width } = useWindowDimensions();
  const operationGuard = useOperationGuard();
  const wide = width >= 820;

  const emailValid = /.+@.+\..+/.test(email.trim());
  const canSubmit = emailValid && (mode === "forgot" || password.length >= 6) && !busy;
  const primaryLabel = mode === "signIn"
      ? tr.auth.signIn
      : mode === "signUp"
        ? tr.auth.signUpTitle
        : resetSent
          ? tr.auth.resendResetLink
          : tr.auth.sendResetLink;
  const operationLabel =
    mode === "signIn"
      ? tr.operation.signingIn
      : mode === "signUp"
        ? tr.operation.creatingAccount
        : tr.operation.requestingReset;

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
      } catch {
        setError(tr.errors.requestFailed);
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
    <Screen scroll maxWidth={980}>
      <View
        style={{
          flex: 1,
          minHeight: wide ? 650 : undefined,
          justifyContent: "center",
          paddingVertical: wide ? spacing.xxl : spacing.lg,
          flexDirection: wide ? "row" : "column",
          alignItems: "stretch",
          gap: wide ? spacing.xxl : spacing.lg,
        }}
      >
        <View style={{ flex: wide ? 1.08 : undefined, justifyContent: "center", minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: wide ? spacing.xl : spacing.md }}>
            <BrandMark size={wide ? 48 : 38} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.title, { color: palette.textStrong }]}>{tr.app.name}</Text>
              <Body muted>{tr.auth.journeyEyebrow}</Body>
            </View>
          </View>
          {wide ? (
            <>
              <Text accessibilityRole="header" style={[type.display, { color: palette.textStrong, fontSize: 40, lineHeight: 45 }]}>
                {tr.auth.journeyTitle}
              </Text>
              <Body muted style={{ fontSize: 16, lineHeight: 23, marginTop: spacing.md, marginBottom: spacing.xl, maxWidth: 470 }}>
                {tr.auth.journeySubtitle}
              </Body>
            </>
          ) : null}
          <AuthJourneyArtwork compact={!wide} />
        </View>

        <Card style={{ flex: wide ? 0.92 : undefined, justifyContent: "center", marginBottom: 0, padding: wide ? spacing.xl : spacing.lg }}>
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
            placeholder={tr.placeholders.email}
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: palette.success + "16", borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md }}>
              <CheckCircle2 accessible={false} size={17} color={palette.success} />
              <Text accessibilityLiveRegion="polite" style={[type.label, { color: palette.successText, flex: 1 }]}>{tr.auth.resetSent}</Text>
            </View>
          ) : null}

          {error ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: palette.error + "16", borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md }}>
              <AlertCircle accessible={false} size={17} color={palette.error} />
              <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[type.label, { color: palette.errorText, flex: 1 }]}>{error}</Text>
            </View>
          ) : null}

          {busy ? (
            <OperationFlow
              kind={mode === "signIn" ? "sign-in" : mode === "signUp" ? "sign-up" : "reset"}
              label={operationLabel}
            />
          ) : null}
          <Button
            label={primaryLabel}
            onPress={() => void submit()}
            disabled={!canSubmit}
          />
          {resetSent ? (
            <View style={{ marginTop: spacing.sm }}>
              <Button label={tr.auth.backToSignIn} variant="ghost" onPress={switchMode} disabled={busy} />
            </View>
          ) : null}
          {mode === "signIn" ? (
            <View style={{ marginTop: spacing.sm }}>
              <Button label={tr.auth.forgotPassword} variant="ghost" onPress={showForgot} />
            </View>
          ) : null}

          <View style={{ flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.lg }}>
            <Body muted>{mode === "signIn" ? tr.auth.noAccount : mode === "signUp" ? tr.auth.haveAccount : tr.auth.rememberedPassword}</Body>
            <Pressable accessibilityRole="button" onPress={switchMode} hitSlop={8}>
              <Text style={[type.body, { color: palette.primaryText, fontFamily: font.semibold }]}>
                {mode === "signIn" ? tr.auth.signUpAction : tr.auth.signInAction}
              </Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, justifyContent: "center", marginTop: spacing.xl }}>
            <CloudOff accessible={false} size={14} color={palette.textSecondary} />
            <Text style={[type.small, { color: palette.textSecondary, textAlign: "center", flexShrink: 1 }]}>
              {isSupabaseConfigured ? tr.auth.offlineNote : tr.settings.syncUnconfiguredHint}
            </Text>
          </View>
        </Card>
      </View>
    </Screen>
  );
}
