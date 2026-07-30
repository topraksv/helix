import React from "react";
import { Animated, Text, View } from "react-native";
import type { AccountFreezePhase } from "../auth/freeze";
import { useWaitingPulse } from "./motion";
import { font, radius, spacing, type, useTheme } from "./theme";

export type OperationFlowKind =
  | "sign-in"
  | "sign-up"
  | "reset"
  | "restore"
  | "sign-out"
  | "local-sign-out"
  | "delete"
  | "freeze"
  | "reactivate";

/** Three animated segments make a long account operation visible at a glance. */
export function OperationFlow({
  kind,
  label,
  freezePhase,
}: {
  kind: OperationFlowKind;
  label: string;
  freezePhase?: AccountFreezePhase;
}) {
  const { palette } = useTheme();
  const pulse = useWaitingPulse();
  const stage =
    kind === "freeze"
      ? freezePhase === "syncing" || freezePhase === "rolling-back" ? 1 : freezePhase === "signing-out" || freezePhase === "complete" ? 2 : 0
      : kind === "restore" || kind === "delete" ? 1 : 0;
  const destructive = kind === "delete";
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{ width: "100%" }}
    >
      <View style={{ flexDirection: "row", gap: spacing.xs }}>
        {[0, 1, 2].map((index) => (
          <Animated.View
            key={index}
            style={{
              flex: 1,
              height: 5,
              borderRadius: radius.full,
              backgroundColor: index <= stage ? (destructive ? palette.destructive : palette.primary) : palette.surfaceStrong,
              opacity: index === stage ? pulse : 1,
            }}
          />
        ))}
      </View>
      <Text style={[type.small, { color: destructive ? palette.errorText : palette.textSecondary, fontFamily: font.semibold, textAlign: "center", marginTop: spacing.xs, fontSize: 10 }]}>
        {label}
      </Text>
    </View>
  );
}
