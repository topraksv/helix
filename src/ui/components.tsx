/** Shared UI primitives. Accessible touch targets (min 44pt), TR formatting. */

import React, { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatMinor, parseTRAmountToMinor } from "../domain/money";
import { radius, spacing, type, useTheme } from "./theme";

export function Screen({ children, scroll = true, padded = true }: { children: ReactNode; scroll?: boolean; padded?: boolean }) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const style = [{ flex: 1, backgroundColor: palette.background }];
  const inner: StyleProp<ViewStyle> = [
    padded && { padding: spacing.lg },
    { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.xxl },
  ];
  if (!scroll) return <View style={[style, inner, { flex: 1 }]}>{children}</View>;
  return (
    <ScrollView style={style} contentContainerStyle={inner} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const { palette } = useTheme();
  const base = {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  };
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [base, style, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  const { palette } = useTheme();
  return <Text style={[type.title, { color: palette.text, marginBottom: spacing.md }]}>{children}</Text>;
}

export function Heading({ children, style }: { children: ReactNode; style?: object }) {
  const { palette } = useTheme();
  return <Text style={[type.heading, { color: palette.text, marginVertical: spacing.sm }, style]}>{children}</Text>;
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  const { palette } = useTheme();
  return <Text style={[type.body, { color: muted ? palette.textMuted : palette.text }, style]}>{children}</Text>;
}

export function Label({ children, style }: { children: ReactNode; style?: object }) {
  const { palette } = useTheme();
  return <Text style={[type.label, { color: palette.textMuted, marginBottom: spacing.xs }, style]}>{children}</Text>;
}

/** Signed money text: red for negatives, tabular figures. */
export function Amount({ minor, currency = "TRY", large, colorized = true }: { minor: number; currency?: string; large?: boolean; colorized?: boolean }) {
  const { palette } = useTheme();
  const color = colorized && minor < 0 ? palette.negative : palette.text;
  return <Text style={[large ? type.amountLg : type.amount, { color }]}>{formatMinor(minor, currency)}</Text>;
}

export function Row({ children, style, gap = spacing.md }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

export function Spread({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  loading?: boolean;
}) {
  const { palette } = useTheme();
  const background =
    variant === "primary" ? palette.primary : variant === "danger" ? palette.negative : variant === "secondary" ? palette.surfaceAlt : "transparent";
  const color = variant === "primary" || variant === "danger" ? palette.onPrimary : variant === "ghost" ? palette.primary : palette.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: background,
          borderRadius: radius.sm,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          minHeight: 44,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading ? <ActivityIndicator color={color} /> : <Text style={[type.label, { color, fontSize: 15 }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ marginBottom: spacing.md }}>
      {props.label ? <Label>{props.label}</Label> : null}
      <TextInput
        placeholderTextColor={palette.textMuted}
        {...props}
        style={[
          {
            backgroundColor: palette.surfaceAlt,
            color: palette.text,
            borderRadius: radius.sm,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border,
            paddingHorizontal: spacing.md,
            minHeight: 44,
            fontSize: 15,
          },
          props.style,
        ]}
      />
    </View>
  );
}

/** TR money input ("1.234,56"); reports minor units, shows validation state. */
export function MoneyField({
  label,
  value,
  onChangeMinor,
  placeholder = "0,00",
}: {
  label?: string;
  value: string;
  onChangeMinor: (raw: string, minor: number | null) => void;
  placeholder?: string;
}) {
  const { palette } = useTheme();
  const minor = value.trim() === "" ? null : parseTRAmountToMinor(value);
  const invalid = value.trim() !== "" && minor === null;
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        value={value}
        onChangeText={(raw) => onChangeMinor(raw, raw.trim() === "" ? null : parseTRAmountToMinor(raw))}
        keyboardType="decimal-pad"
        inputMode="decimal"
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        style={{
          backgroundColor: palette.surfaceAlt,
          color: invalid ? palette.negative : palette.text,
          borderRadius: radius.sm,
          borderWidth: 1,
          borderColor: invalid ? palette.negative : palette.border,
          paddingHorizontal: spacing.md,
          minHeight: 44,
          fontSize: 16,
          fontVariant: ["tabular-nums"],
        }}
      />
    </View>
  );
}

/** Horizontal segmented selector. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { palette } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: palette.surfaceAlt,
        borderRadius: radius.sm,
        padding: 3,
        marginBottom: spacing.md,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={{
              flex: 1,
              paddingVertical: spacing.sm + 2,
              borderRadius: radius.sm - 2,
              alignItems: "center",
              backgroundColor: selected ? palette.surface : "transparent",
            }}
          >
            <Text style={[type.label, { color: selected ? palette.text : palette.textMuted }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Simple chip-row picker (categories, sources, persons). */
export function ChipPicker<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; color?: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={{
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              borderRadius: radius.full,
              borderWidth: 1,
              borderColor: selected ? palette.primary : palette.border,
              backgroundColor: selected ? palette.primary : palette.surface,
              minHeight: 36,
              justifyContent: "center",
            }}
          >
            <Text style={[type.label, { color: selected ? palette.onPrimary : palette.text }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Badge({ text, tone = "muted" }: { text: string; tone?: "muted" | "positive" | "negative" | "warning" }) {
  const { palette } = useTheme();
  const colors = {
    muted: { bg: palette.surfaceAlt, fg: palette.textMuted },
    positive: { bg: palette.positive + "22", fg: palette.positive },
    negative: { bg: palette.negative + "22", fg: palette.negative },
    warning: { bg: palette.warning + "22", fg: palette.warning },
  }[tone];
  return (
    <View style={{ backgroundColor: colors.bg, borderRadius: radius.full, paddingHorizontal: spacing.sm + 2, paddingVertical: 3 }}>
      <Text style={[type.small, { color: colors.fg }]}>{text}</Text>
    </View>
  );
}

export function EmptyState({ text }: { text: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ padding: spacing.xl, alignItems: "center" }}>
      <Text style={[type.body, { color: palette.textMuted, textAlign: "center" }]}>{text}</Text>
    </View>
  );
}

export function Divider() {
  const { palette } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginVertical: spacing.sm }} />;
}

/** Initials avatar with a deterministic hue from the name (logo fallback). */
export function InitialsBadge({ name, size = 36 }: { name: string; size?: number }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  const bg = `hsl(${hash}, 45%, 45%)`;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toLocaleUpperCase("tr-TR") ?? "")
    .join("");
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#fff", fontSize: size * 0.4, fontWeight: "600" }}>{initials}</Text>
    </View>
  );
}
