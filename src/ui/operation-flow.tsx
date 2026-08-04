import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import {
  Check,
  CheckCircle2,
  CircleAlert,
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
import { circle, radius, spacing, type, type Palette, useTheme } from "./theme";
import { tr } from "../i18n/tr";
import { useReducedMotion } from "./motion";

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

type Tone = "primary" | "secondary" | "success" | "warning" | "destructive";
type Visual = readonly [LucideIcon, Tone?];
const operationVisuals: Record<OperationFlowKind, Visual> = {
  "sign-in": [KeyRound, "primary"],
  "sign-up": [ShieldCheck, "success"],
  reset: [Mail, "secondary"],
  initialize: [WalletCards, "primary"],
  restore: [RefreshCw, "secondary"],
  "sign-out": [LogOut, "secondary"],
  "local-sign-out": [LogOut, "destructive"],
  delete: [Trash2, "destructive"],
  freeze: [Snowflake, "warning"],
  reactivate: [KeyRound, "success"],
};

function operationColor(palette: Palette, tone: Tone): string {
  if (tone === "destructive") return palette.destructive;
  if (tone === "warning") return palette.warning;
  if (tone === "success") return palette.success;
  if (tone === "secondary") return palette.secondary;
  return palette.primary;
}

function operationSupportIcon(kind: OperationFlowKind): LucideIcon {
  switch (kind) {
    case "freeze":
      return RefreshCw;
    case "delete":
      return Trash2;
    case "sign-in":
    case "sign-up":
    case "local-sign-out":
      return WalletCards;
    default:
      return ShieldCheck;
  }
}

/** One operation-specific visual and one caption; callers cannot duplicate it. */
export function OperationFlow({
  kind,
  label,
  title,
  presentation = "inline",
}: {
  kind: OperationFlowKind;
  label: string;
  /** Names the operation on the full-page waiting view. */
  title?: string;
  presentation?: "inline" | "waiting" | "hero";
}) {
  const { palette } = useTheme();
  const [Icon, tone = "primary"] = operationVisuals[kind];
  const color = operationColor(palette, tone);
  const destructive = tone === "destructive";
  const hero = presentation === "hero";
  const waiting = presentation === "waiting";
  const reducedMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!waiting) return;
    if (reducedMotion) {
      pulse.setValue(0.7);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [waiting, reducedMotion, pulse]);

  if (waiting) {
    // A whole-page composition: the operation's own mark, its name, and the
    // sentence that says what is happening to the data. The medallion carries
    // the running indicator so the page never shows a bare spinner with no
    // subject, and the tone comes from the operation — a deletion is not the
    // same event as a sign-out and must not look like one.
    return (
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={title ? `${title}. ${label}` : label}
        accessibilityValue={{ text: label }}
        style={{ width: "100%", maxWidth: 440, alignItems: "center", gap: spacing.lg }}
      >
        <View accessible={false} style={{ width: 128, height: 128, alignItems: "center", justifyContent: "center" }}>
          {/* One slow breath, in the operation's own colour. A bare spinner
              says "something is happening"; this says which something, and it
              is the only motion on the page so it cannot compete with
              anything. Reduce Motion gets the same composition, still. */}
          <Animated.View
            style={{
              position: "absolute",
              width: 128,
              height: 128,
              borderRadius: circle(128),
              backgroundColor: color + "12",
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }],
            }}
          />
          <View
            style={{
              width: 96,
              height: 96,
              borderRadius: circle(96),
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: color + "1A",
              borderWidth: 1,
              borderColor: color + "3A",
            }}
          >
            <Icon accessible={false} size={34} color={color} strokeWidth={2} />
          </View>
        </View>
        <View style={{ gap: spacing.sm, alignItems: "center" }}>
          {title ? (
            <Text style={[type.heading, { color: destructive ? palette.errorText : palette.textStrong, textAlign: "center" }]}>
              {title}
            </Text>
          ) : null}
          <Text
            accessibilityLiveRegion="polite"
            style={[type.body, { color: palette.textSecondary, textAlign: "center", maxWidth: 380 }]}
          >
            {label}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ text: label }}
      style={{
        width: "100%",
        maxWidth: hero ? 480 : undefined,
        alignItems: hero ? "stretch" : "flex-start",
        backgroundColor: hero ? palette.surface : "transparent",
        borderRadius: hero ? radius.lg : 0,
        borderWidth: hero ? StyleSheet.hairlineWidth : 0,
        borderColor: hero ? palette.border : "transparent",
        padding: hero ? spacing.lg : 0,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: hero ? spacing.md : spacing.sm }}>
        <View
          style={{
            width: hero ? 48 : 36,
            height: hero ? 48 : 36,
            flexShrink: 0,
            borderRadius: hero ? radius.md : 12,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: color + "18",
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: color + "80",
          }}
        >
          <Icon accessible={false} size={hero ? 28 : 17} color={color} strokeWidth={2.3} />
        </View>
        <Text
          accessibilityLiveRegion="polite"
          style={[
            hero ? type.label : type.small,
            {
              color: destructive ? palette.errorText : palette.text,
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
 * A persistent operation signature. The in-flight status above is intentionally
 * separate; this surface explains an action before it starts with a quiet,
 * static visual signal and consequence line.
 */
export function OperationSignature({
  kind,
  eyebrow,
  title,
  description,
  detail,
  compact = false,
  testID,
}: {
  kind: OperationFlowKind;
  eyebrow: string;
  title: string;
  description: string;
  detail?: string;
  compact?: boolean;
  testID?: string;
}) {
  const { palette } = useTheme();
  const [Icon, tone = "primary"] = operationVisuals[kind];
  const color = operationColor(palette, tone);
  const foreground = tone === "destructive"
    ? palette.errorText
    : tone === "warning"
      ? palette.warningText
      : tone === "success"
        ? palette.successText
        : palette.textStrong;
  const SupportIcon = operationSupportIcon(kind);
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
        width: "100%",
        ...(compact
          ? {}
          : {
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
            }),
      }}
    >
      {/* The compact signature is a two-line block beside one mark, so the mark
          belongs on its centre line. Top-aligned it floated against the first
          line and the row read as two unrelated things. The full form keeps the
          top alignment: it carries an eyebrow, a heading and a paragraph, and
          its mark belongs with the eyebrow. */}
      <View style={{ flexDirection: "row", alignItems: compact ? "center" : "flex-start", gap: spacing.md }}>
        <View
          testID={testID ? `${testID}-icon` : undefined}
          style={{
            width: compact ? 34 : 46,
            height: compact ? 34 : 46,
            flexShrink: 0,
            borderRadius: compact || kind === "delete" ? radius.sm : radius.full,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: color + "18",
            borderWidth: compact ? StyleSheet.hairlineWidth : kind === "delete" ? 2 : StyleSheet.hairlineWidth,
            borderColor: color,
          }}
        >
          <Icon accessible={false} size={compact ? 17 : 21} color={color} strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          {!compact ? <Text style={[type.small, { color, textTransform: "uppercase", letterSpacing: 0.7 }]}>{eyebrow}</Text> : null}
          <Text style={[compact ? type.body : type.heading, { color: foreground, marginTop: compact ? 0 : 2 }]}>{title}</Text>
          <Text style={[compact ? type.small : type.body, { color: palette.textSecondary, marginTop: compact ? 1 : 3 }]}>{description}</Text>
        </View>
      </View>
      {!compact ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color + "40" }}>
          <SupportIcon accessible={false} size={15} color={color} strokeWidth={2.1} />
          <Text style={[type.small, { color: palette.textSecondary, flex: 1 }]}>{support}</Text>
        </View>
      ) : null}
    </View>
  );
}

function operationEyebrow(kind: OperationFlowKind): string {
  switch (kind) {
    case "sign-in":
      return tr.auth.signInSignatureEyebrow;
    case "sign-out":
      return tr.auth.signOutSignatureEyebrow;
    case "local-sign-out":
      return tr.auth.localSignOutDialogEyebrow;
    case "freeze":
      return tr.account.freezeSignatureEyebrow;
    case "delete":
      return tr.account.deleteSignatureEyebrow;
    default:
      return tr.app.name;
  }
}

function DialogStep({
  index,
  icon: Icon,
  title,
  detail,
  color,
  last = false,
}: {
  index?: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  color: string;
  last?: boolean;
}) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
      <View style={{ alignItems: "center", width: 26 }}>
        <View style={{ width: 26, height: 26, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: color + "18", borderWidth: StyleSheet.hairlineWidth, borderColor: color }}>
          {index ? <Text style={[type.small, { color, fontVariant: ["tabular-nums"] }]}>{index}</Text> : <Icon accessible={false} size={14} color={color} strokeWidth={2.4} />}
        </View>
        {!last ? <View style={{ width: StyleSheet.hairlineWidth, height: 22, backgroundColor: color + "55", marginVertical: 2 }} /> : null}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : spacing.sm }}>
        <Text style={[type.label, { color: palette.text }]}>{title}</Text>
        <Text style={[type.small, { color: palette.textSecondary, marginTop: 2 }]}>{detail}</Text>
      </View>
    </View>
  );
}

function DialogMessage({
  label,
  message,
  color,
  tone = "neutral",
}: {
  label: string;
  message: string;
  color: string;
  tone?: "neutral" | "warning" | "danger";
}) {
  const { palette } = useTheme();
  const background = tone === "danger" ? palette.error + "14" : tone === "warning" ? palette.warning + "12" : palette.surfaceAlt;
  return (
    <View testID="operation-dialog-message" style={{ borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: color + "55", backgroundColor: background, padding: spacing.md, marginTop: spacing.lg }}>
      <Text style={[type.small, { color, textTransform: "uppercase", letterSpacing: 0.7 }]}>{label}</Text>
      <Text selectable style={[type.body, { color: palette.text, marginTop: spacing.xs }]}>{message}</Text>
    </View>
  );
}

function DialogFact({
  icon: Icon,
  label,
  detail,
  color,
}: {
  icon: LucideIcon;
  label: string;
  detail: string;
  color: string;
}) {
  const { palette } = useTheme();
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: 180,
        minWidth: 180,
        padding: spacing.md,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: color + "55",
        backgroundColor: palette.surfaceAlt,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon accessible={false} size={16} color={color} strokeWidth={2.2} />
        <Text style={[type.small, { color, textTransform: "uppercase", letterSpacing: 0.6, flex: 1 }]}>{label}</Text>
      </View>
      <Text style={[type.small, { color: palette.text, marginTop: spacing.xs }]}>{detail}</Text>
    </View>
  );
}

function DialogPlan({ children }: { children: React.ReactNode }) {
  const { palette } = useTheme();
  return (
    <View testID="operation-dialog-plan" style={{ marginTop: spacing.lg, gap: spacing.sm }}>
      <Text style={[type.small, { color: palette.textSecondary, textTransform: "uppercase", letterSpacing: 0.7 }]}>{tr.common.operationPlan}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>{children}</View>
    </View>
  );
}

function DialogHeading({
  icon: Icon,
  eyebrow,
  title,
  color,
  shape = "circle",
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  color: string;
  shape?: "circle" | "square";
}) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
      <View style={{ width: 52, height: 52, flexShrink: 0, borderRadius: shape === "square" ? radius.md : radius.full, alignItems: "center", justifyContent: "center", backgroundColor: color + "18", borderWidth: shape === "square" ? 2 : StyleSheet.hairlineWidth, borderColor: color }}>
        <Icon accessible={false} size={24} color={color} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.small, { color, textTransform: "uppercase", letterSpacing: 0.7 }]}>{eyebrow}</Text>
        <Text style={[type.heading, { color: palette.text, marginTop: 2 }]}>{title}</Text>
      </View>
    </View>
  );
}

/**
 * The confirmation surface is deliberately composed per operation. The
 * shared modal shell owns focus, dismissal and button order; this component
 * owns the consequence hierarchy so logout, freeze and deletion cannot look
 * like recoloured copies of the same alert.
 */
export function OperationDialogHeader({
  kind,
  title,
  message,
  testID,
}: {
  kind: OperationFlowKind;
  title: string;
  message: string;
  testID?: string;
}) {
  const { palette } = useTheme();
  const [Icon, tone = "primary"] = operationVisuals[kind];
  const color = operationColor(palette, tone);
  const eyebrow = operationEyebrow(kind);

  return (
    <View
      testID={testID ?? `operation-dialog-${kind}`}
      style={{ width: "100%" }}
    >
      {kind === "sign-out" ? (
        <>
          <DialogHeading icon={LogOut} eyebrow={eyebrow} title={title} color={color} />
          <DialogMessage label={tr.auth.signOutDialogSection} message={message} color={color} />
          <DialogPlan>
            <DialogFact icon={CheckCircle2} label={tr.auth.signOutDialogAccountTitle} detail={tr.auth.signOutDialogAccountDetail} color={palette.success} />
            <DialogFact icon={RefreshCw} label={tr.auth.signOutDialogReturnTitle} detail={tr.auth.signOutDialogReturnDetail} color={color} />
          </DialogPlan>
          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            <DialogStep index="1" icon={LogOut} title={tr.auth.signOutDialogStepSessionTitle} detail={tr.auth.signOutDialogStepSessionDetail} color={color} />
            <DialogStep index="2" icon={KeyRound} title={tr.auth.signOutDialogStepReturnTitle} detail={tr.auth.signOutDialogStepReturnDetail} color={palette.primary} last />
          </View>
        </>
      ) : kind === "local-sign-out" ? (
        <>
          <DialogHeading icon={LogOut} eyebrow={eyebrow} title={title} color={palette.destructive} shape="square" />
          <DialogMessage label={tr.auth.localSignOutDialogSection} message={message} color={palette.destructive} tone="danger" />
          <DialogPlan>
            <DialogFact icon={CircleAlert} label={tr.auth.localSignOutDialogDeviceTitle} detail={tr.auth.localSignOutDialogDeviceDetail} color={palette.destructive} />
            <DialogFact icon={Check} label={tr.auth.localSignOutDialogBackupTitle} detail={tr.auth.localSignOutDialogBackupDetail} color={palette.warning} />
          </DialogPlan>
          <View style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.surfaceAlt, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, gap: spacing.md }}>
            <DialogStep index="1" icon={CircleAlert} title={tr.auth.localSignOutDialogStepDeviceTitle} detail={tr.auth.localSignOutDialogStepDeviceDetail} color={palette.destructive} />
            <DialogStep index="2" icon={Check} title={tr.auth.localSignOutDialogStepBackupTitle} detail={tr.auth.localSignOutDialogStepBackupDetail} color={palette.warning} last />
          </View>
        </>
      ) : kind === "freeze" ? (
        <>
          <DialogHeading icon={Snowflake} eyebrow={eyebrow} title={title} color={palette.warning} />
          <DialogMessage label={tr.account.freezeDialogSection} message={message} color={palette.warning} tone="warning" />
          <DialogPlan>
            <DialogFact icon={ShieldCheck} label={tr.account.freezeDialogProtectTitle} detail={tr.account.freezeDialogProtectDetail} color={palette.success} />
            <DialogFact icon={LogOut} label={tr.account.freezeDialogCloseTitle} detail={tr.account.freezeDialogCloseDetail} color={palette.warning} />
          </DialogPlan>
          <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
            <DialogStep index="1" icon={ShieldCheck} title={tr.account.freezeDialogProtectTitle} detail={tr.account.freezeDialogProtectDetail} color={palette.success} />
            <DialogStep index="2" icon={LogOut} title={tr.account.freezeDialogCloseTitle} detail={tr.account.freezeDialogCloseDetail} color={palette.warning} />
            <DialogStep index="3" icon={KeyRound} title={tr.account.freezeDialogReturnTitle} detail={tr.account.freezeDialogReturnDetail} color={palette.primary} last />
          </View>
        </>
      ) : kind === "delete" ? (
        <>
          <DialogHeading icon={Trash2} eyebrow={eyebrow} title={title} color={palette.destructive} shape="square" />
          <DialogMessage label={tr.account.deleteDialogSection} message={message} color={palette.destructive} tone="danger" />
          <DialogPlan>
            <DialogFact icon={Trash2} label={tr.account.deleteDialogListTitle} detail={tr.account.deleteDialogIrreversible} color={palette.destructive} />
            <DialogFact icon={CircleAlert} label={tr.account.deleteDialogFinalCheckTitle} detail={tr.account.deleteDialogFinalCheckDetail} color={palette.warning} />
          </DialogPlan>
          <View style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: palette.destructive + "75", backgroundColor: palette.error + "0D", gap: spacing.sm }}>
            <Text style={[type.label, { color: palette.errorText }]}>{tr.account.deleteDialogListTitle}</Text>
            {[tr.account.deleteDialogItemAccount, tr.account.deleteDialogItemFinance, tr.account.deleteDialogItemSettings].map((item) => (
              <View key={item} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <Check accessible={false} size={15} color={palette.errorText} strokeWidth={2.4} />
                <Text style={[type.small, { color: palette.text }]}>{item}</Text>
              </View>
            ))}
            <Text style={[type.small, { color: palette.errorText, marginTop: spacing.xs }]}>{tr.account.deleteDialogIrreversible}</Text>
          </View>
        </>
      ) : (
        <>
          <DialogHeading icon={Icon} eyebrow={eyebrow} title={title} color={color} />
          <DialogMessage label={tr.common.operationSummary} message={message} color={color} />
        </>
      )}
    </View>
  );
}
