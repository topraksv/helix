import React from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import {
  KeyRound,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  Snowflake,
  Trash2,
  WalletCards,
  type LucideIcon,
} from "lucide-react-native";
import { useWaitingPulse } from "./motion";
import { radius, spacing, type, useTheme } from "./theme";

export type OperationFlowKind =
  | "sign-in"
  | "sign-up"
  | "reset"
  | "initialize"
  | "restore"
  | "sign-out"
  | "local-sign-out"
  | "delete"
  | "freeze"
  | "reactivate";

type Motion = "focus" | "leave" | "turn" | "drop" | "rise";
type Tone = "primary" | "secondary" | "success" | "warning" | "destructive";
type Visual = readonly [LucideIcon, Motion, Tone?];
const operationVisuals: Record<OperationFlowKind, Visual> = {
  "sign-in": [KeyRound, "focus", "primary"],
  "sign-up": [ShieldCheck, "focus", "success"],
  reset: [Mail, "focus", "secondary"],
  initialize: [WalletCards, "rise", "primary"],
  restore: [RefreshCw, "turn", "secondary"],
  "sign-out": [LogOut, "leave", "secondary"],
  "local-sign-out": [LogOut, "leave", "destructive"],
  delete: [Trash2, "drop", "destructive"],
  freeze: [Snowflake, "turn", "warning"],
  reactivate: [KeyRound, "rise", "success"],
};

/** Motion rests at its neutral endpoint when Reduced Motion is enabled. */
function motionStyle(motion: Motion, pulse: Animated.Value) {
  const interpolate = (from: number) =>
    pulse.interpolate({ inputRange: [0.72, 1], outputRange: [from, 0] });
  if (motion === "leave") return { transform: [{ translateX: interpolate(-9) }] };
  if (motion === "turn") {
    return { transform: [{ rotate: pulse.interpolate({ inputRange: [0.72, 1], outputRange: ["-14deg", "0deg"] }) }] };
  }
  if (motion === "drop") {
    return {
      opacity: pulse,
      transform: [
        { translateY: interpolate(6) },
        { scale: pulse.interpolate({ inputRange: [0.72, 1], outputRange: [0.72, 1] }) },
      ],
    };
  }
  if (motion === "rise") return { transform: [{ translateY: interpolate(6) }] };
  return { transform: [{ scale: pulse.interpolate({ inputRange: [0.72, 1], outputRange: [0.9, 1] }) }] };
}

/** One operation-specific visual and one caption; callers cannot duplicate it. */
export function OperationFlow({
  kind,
  label,
  presentation = "inline",
}: {
  kind: OperationFlowKind;
  label: string;
  presentation?: "inline" | "hero";
}) {
  const { palette } = useTheme();
  const pulse = useWaitingPulse();
  const [Icon, motion, tone = "primary"] = operationVisuals[kind];
  const color = tone === "destructive"
    ? palette.destructive
    : tone === "warning"
      ? palette.warning
      : tone === "success"
        ? palette.success
        : tone === "secondary"
          ? palette.secondary
          : palette.primary;
  const destructive = tone === "destructive";
  const hero = presentation === "hero";

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ text: label }}
      style={{
        width: "100%",
        maxWidth: hero ? 440 : undefined,
        alignItems: hero ? "center" : "flex-start",
        backgroundColor: hero ? palette.surface : "transparent",
        borderRadius: hero ? radius.lg : 0,
        padding: hero ? spacing.xl : 0,
      }}
    >
      <View style={{ flexDirection: hero ? "column" : "row", alignItems: "center", gap: hero ? spacing.lg : spacing.sm }}>
        <Animated.View
          style={[
            {
              width: hero ? 64 : 36,
              height: hero ? 64 : 36,
              borderRadius: hero ? 22 : 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: color + "20",
              borderWidth: 2,
              borderColor: color,
            },
            motionStyle(motion, pulse),
          ]}
        >
          <Icon accessible={false} size={hero ? 28 : 17} color={color} strokeWidth={2.3} />
        </Animated.View>
        <Text
          accessibilityLiveRegion="polite"
          style={[
            hero ? type.heading : type.small,
            {
              color: destructive ? palette.errorText : palette.text,
              textAlign: hero ? "center" : "left",
              flexShrink: 1,
            },
          ]}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

/**
 * A persistent operation signature. The waiting state above is intentionally
 * small; these surfaces explain an action before it starts, so each account
 * lifecycle operation gets its own visual signal and consequence line.
 */
export function OperationSignature({
  kind,
  eyebrow,
  title,
  description,
  detail,
  testID,
}: {
  kind: OperationFlowKind;
  eyebrow: string;
  title: string;
  description: string;
  detail?: string;
  testID?: string;
}) {
  const { palette } = useTheme();
  const pulse = useWaitingPulse();
  const [Icon, motion, tone = "primary"] = operationVisuals[kind];
  const color = tone === "destructive"
    ? palette.destructive
    : tone === "warning"
      ? palette.warning
      : tone === "success"
        ? palette.success
        : tone === "secondary"
          ? palette.secondary
          : palette.primary;
  const foreground = tone === "destructive"
    ? palette.errorText
    : tone === "warning"
      ? palette.warningText
      : tone === "success"
        ? palette.successText
        : palette.textStrong;
  const SupportIcon = kind === "freeze"
    ? RefreshCw
    : kind === "delete"
      ? Trash2
      : kind === "sign-in" || kind === "sign-up"
        ? WalletCards
        : ShieldCheck;
  const support = detail ?? (
    kind === "freeze"
      ? "Geçici bir durum; yeniden girişle devam edebilirsin."
      : kind === "delete"
        ? "Bu işlem geri alınamaz."
        : kind === "sign-out" || kind === "local-sign-out"
          ? "Oturum kapanır; hesabın silinmez."
          : "Çalışma alanına güvenle dön."
  );

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${title}. ${description}. ${support}`}
      style={{
        borderLeftWidth: 3,
        borderLeftColor: color,
        borderRadius: radius.md,
        padding: spacing.md,
        backgroundColor: tone === "destructive"
          ? palette.error + "0D"
          : tone === "warning"
            ? palette.warning + "10"
            : palette.surfaceAlt,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: color + "55",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <Animated.View
          style={[
            {
              width: 46,
              height: 46,
              flexShrink: 0,
              borderRadius: kind === "delete" ? radius.sm : radius.full,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: color + "18",
              borderWidth: kind === "delete" ? 2 : StyleSheet.hairlineWidth,
              borderColor: color,
            },
            motionStyle(motion, pulse),
          ]}
        >
          <Icon accessible={false} size={21} color={color} strokeWidth={2.2} />
        </Animated.View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.small, { color, textTransform: "uppercase", letterSpacing: 0.7 }]}>{eyebrow}</Text>
          <Text style={[type.heading, { color: foreground, marginTop: 2 }]}>{title}</Text>
          <Text style={[type.body, { color: palette.textSecondary, marginTop: 3 }]}>{description}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color + "40" }}>
        <SupportIcon accessible={false} size={15} color={color} strokeWidth={2.1} />
        <Text style={[type.small, { color: palette.textSecondary, flex: 1 }]}>{support}</Text>
      </View>
    </View>
  );
}
