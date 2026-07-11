/**
 * Frozen-account gate. When the user freezes their account the data is kept but
 * the app locks: this screen blocks everything until the user re-authenticates
 * (biometrics on a phone, else the account password; a local-only workspace
 * just confirms). Unlocking clears the synced `account_frozen` flag, so every
 * device unfreezes on the next sync.
 */

import React, { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { ShieldCheck } from "lucide-react-native";
import { writeSetting } from "../db/mutations";
import { scheduleSync } from "../sync/engine";
import { getSupabase, isSupabaseConfigured } from "../sync/supabase";
import { useUserId } from "../data/hooks";
import { kv } from "../lib/kv";
import { tr } from "../i18n/tr";
import { Body, Button, Field, Screen, Title } from "./components";
import { spacing } from "./theme";

export function FrozenGate() {
  const userId = useUserId();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  const useBiometric = Platform.OS !== "web" && biometricEnabled;

  useEffect(() => {
    void kv.get("helix.biometric").then((v) => setBiometricEnabled(v === "true"));
  }, []);

  const clearFrozen = async () => {
    await writeSetting(userId, "account_frozen", false);
    scheduleSync(userId);
  };

  const unlockBiometric = async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: tr.account.reactivate });
    if (result.success) await clearFrozen();
  };

  // Auto-prompt Face ID when the gate is shown with biometrics enabled.
  useEffect(() => {
    if (useBiometric) void unlockBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useBiometric]);

  const unlockPassword = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = getSupabase();
      // Local-only workspace has no password — a plain confirm reactivates.
      if (!isSupabaseConfigured || !supabase) {
        await clearFrozen();
        return;
      }
      const { data } = await supabase.auth.getUser();
      const email = data.user?.email;
      if (!email) {
        setError(tr.auth.errGeneric);
        return;
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(tr.account.reactivateWrongPassword);
        return;
      }
      await clearFrozen();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1, justifyContent: "center", gap: spacing.lg }}>
        <View style={{ alignItems: "center", gap: spacing.md }}>
          <ShieldCheck size={48} color="#d97757" />
          <Title>{tr.account.frozenTitle}</Title>
          <Body muted style={{ textAlign: "center" }}>{tr.account.frozenBody}</Body>
        </View>
        {useBiometric ? (
          <Button label={tr.account.reactivate} onPress={() => void unlockBiometric()} />
        ) : isSupabaseConfigured ? (
          <View style={{ gap: spacing.sm }}>
            <Field
              label={tr.account.reactivatePassword}
              value={password}
              onChangeText={setPassword}
              secure
              error={error}
              autoCapitalize="none"
            />
            <Button label={tr.account.reactivate} onPress={() => void unlockPassword()} loading={busy} disabled={!password} />
          </View>
        ) : (
          <Button label={tr.account.reactivate} onPress={() => void unlockPassword()} loading={busy} />
        )}
      </View>
    </Screen>
  );
}
