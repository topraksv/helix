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
import { setAccountFrozen } from "../data/repo";
import { scheduleSync } from "../sync/engine";
import { isSupabaseConfigured } from "../sync/supabase";
import { useSession } from "../auth/session";
import { useUserId } from "../data/hooks";
import { kv } from "../services/kv";
import { tr } from "../i18n/tr";
import { Body, Button, Screen, Title, WaitingText } from "./components";
import { appAlert } from "./dialog";
import { spacing, useTheme } from "./theme";
import { useOperationGuard } from "./operation-guard";

export function FrozenGate() {
  const userId = useUserId();
  const { palette } = useTheme();
  const { signOut } = useSession();
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [operation, setOperation] = useState<"idle" | "reactivating" | "signing-out">("idle");
  const operationGuard = useOperationGuard();
  const useBiometric = Platform.OS !== "web" && biometricEnabled;

  useEffect(() => {
    void kv.get("helix.biometric").then((v) => setBiometricEnabled(v === "true"));
  }, []);

  const unlock = async () => {
    await setAccountFrozen(userId, false);
    scheduleSync(userId);
  };

  const unlockBiometric = async () => {
    try {
      await operationGuard.run(async () => {
        setOperation("reactivating");
        try {
          const result = await LocalAuthentication.authenticateAsync({ promptMessage: tr.account.reactivate });
          if (result.success) await unlock();
        } finally {
          setOperation("idle");
        }
      });
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
  };

  const unlockDirectly = async () => {
    try {
      await operationGuard.run(async () => {
        setOperation("reactivating");
        try {
          await unlock();
        } finally {
          setOperation("idle");
        }
      });
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
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
          <Title>{operation === "reactivating" ? tr.account.reactivatingTitle : operation === "signing-out" ? tr.operation.signingOutTitle : tr.account.frozenTitle}</Title>
          {operation === "reactivating" ? (
            <WaitingText message={tr.account.reactivatingBody} heading />
          ) : operation === "signing-out" ? (
            <WaitingText message={tr.operation.signingOut} heading />
          ) : (
            <Body muted style={{ textAlign: "center" }}>{tr.account.frozenBody}</Body>
          )}
        </View>
        {useBiometric ? (
          <Button
            label={operation === "reactivating" ? tr.account.reactivatingTitle : tr.account.reactivate}
            loading={operation === "reactivating"}
            disabled={operation === "signing-out"}
            onPress={() => void unlockBiometric()}
          />
        ) : null}
        {isSupabaseConfigured ? (
          <Button
            label={tr.account.frozenSignOut}
            variant={useBiometric ? "secondary" : "primary"}
            loading={operation === "signing-out"}
            disabled={operation === "reactivating"}
            onPress={async () => {
              await operationGuard.run(async () => {
                setOperation("signing-out");
                try {
                  const error = await signOut();
                  if (error) void appAlert(error, tr.errors.title);
                } finally {
                  setOperation("idle");
                }
              });
            }}
          />
        ) : (
          <Button
            label={operation === "reactivating" ? tr.account.reactivatingTitle : tr.account.reactivate}
            loading={operation === "reactivating"}
            onPress={() => void unlockDirectly()}
          />
        )}
      </View>
    </Screen>
  );
}
