import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useSession } from "../../auth/session";
import { isSupabaseConfigured } from "../../sync/supabase";
import { Body, Button, Field, Screen, Title } from "../../ui/components";
import { spacing } from "../../ui/theme";
import { tr } from "../../i18n/tr";

export default function SignInScreen() {
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { signIn, signUp, bootstrap } = useSession();
  const router = useRouter();

  const submit = async () => {
    setBusy(true);
    setError(null);
    const err = mode === "signIn" ? await signIn(email.trim(), password) : await signUp(email.trim(), password);
    setBusy(false);
    if (err) setError(err);
    else router.replace("/");
  };

  return (
    <Screen>
      <View style={{ maxWidth: 420, width: "100%", alignSelf: "center", marginTop: spacing.xxl }}>
        <Title>{tr.app.name}</Title>
        <Body muted style={{ marginBottom: spacing.xl }}>
          {mode === "signIn" ? tr.auth.title : tr.auth.signUp}
        </Body>
        <Field
          label={tr.auth.email}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        <Field
          label={tr.auth.password}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={mode === "signIn" ? "current-password" : "new-password"}
        />
        {error ? <Body style={{ marginBottom: spacing.md }}>⚠ {error}</Body> : null}
        <Button
          label={mode === "signIn" ? tr.auth.signIn : tr.auth.signUp}
          onPress={() => void submit()}
          loading={busy}
          disabled={!email.trim() || password.length < 6}
        />
        <View style={{ height: spacing.md }} />
        <Button
          label={mode === "signIn" ? tr.auth.noAccount : tr.auth.haveAccount}
          variant="ghost"
          onPress={() => setMode(mode === "signIn" ? "signUp" : "signIn")}
        />
        {!isSupabaseConfigured ? (
          <Body muted style={{ marginTop: spacing.xl }}>
            ⚠ {tr.settings.syncUnconfiguredHint}
          </Body>
        ) : (
          <Body muted style={{ marginTop: spacing.xl }}>
            {tr.auth.offlineNote}
          </Body>
        )}
      </View>
    </Screen>
  );
}
