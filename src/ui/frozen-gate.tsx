/**
 * Frozen-account gate. Shown on a device that still holds a session when the
 * account was frozen elsewhere (the freezing device signs out to the login
 * screen). Never traps: unlock with biometrics on a phone, or sign out and log
 * back in (logging in clears the freeze). A local-only workspace just unlocks.
 */

import React, { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { ShieldCheck } from "lucide-react-native";
import { writeSetting } from "../db/mutations";
import { scheduleSync } from "../sync/engine";
import { isSupabaseConfigured } from "../sync/supabase";
import { useSession } from "../auth/session";
import { useUserId } from "../data/hooks";
import { kv } from "../lib/kv";
import { tr } from "../i18n/tr";
import { Body, Button, Screen, Title } from "./components";
import { appAlert } from "./dialog";
import { spacing, useTheme } from "./theme";
import { useOperationGuard } from "./operation-guard";

export function FrozenGate() {
  const userId = useUserId();
  const { palette } = useTheme();
  const { signOut } = useSession();
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const operationGuard = useOperationGuard();
  const useBiometric = Platform.OS !== "web" && biometricEnabled;

  useEffect(() => {
    void kv.get("helix.biometric").then((v) => setBiometricEnabled(v === "true"));
  }, []);

  const unlock = async () => {
    await writeSetting(userId, "account_frozen", false);
    scheduleSync(userId);
  };

  const unlockBiometric = async () => {
    await operationGuard.run(async () => {
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: tr.account.reactivate });
      if (result.success) await unlock();
    });
  };

  const unlockDirectly = async () => {
    await operationGuard.run(unlock);
  };

  // Auto-prompt Face ID when the gate opens with biometrics enabled.
  useEffect(() => {
    if (useBiometric) void unlockBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useBiometric]);

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1, justifyContent: "center", gap: spacing.lg }}>
        <View style={{ alignItems: "center", gap: spacing.md }}>
          <ShieldCheck accessible={false} size={48} color={palette.primary} />
          <Title>{tr.account.frozenTitle}</Title>
          <Body muted style={{ textAlign: "center" }}>{tr.account.frozenBody}</Body>
        </View>
        {useBiometric ? (
          <Button label={tr.account.reactivate} onPress={() => void unlockBiometric()} />
        ) : null}
        {isSupabaseConfigured ? (
          <Button
            label={tr.account.frozenSignOut}
            variant={useBiometric ? "secondary" : "primary"}
            loading={busy}
            onPress={async () => {
              await operationGuard.run(async () => {
                setBusy(true);
                try {
                  const error = await signOut();
                  if (error) void appAlert(error, tr.errors.title);
                } finally {
                  setBusy(false);
                }
              });
            }}
          />
        ) : (
          <Button label={tr.account.reactivate} onPress={() => void unlockDirectly()} />
        )}
      </View>
    </Screen>
  );
}
