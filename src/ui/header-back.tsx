import React from "react";
import { Pressable, Text } from "react-native";
import { useRouter, type Href } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { tr } from "../i18n/tr";
import { navigateBack } from "./navigation";
import { font, radius, spacing, useTheme } from "./theme";

/** Native-header back control with a deterministic parent for direct links. */
export function HeaderBackButton({ fallback }: { fallback: Href }) {
  const router = useRouter();
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr.common.back}
      hitSlop={8}
      onPress={() => navigateBack(router, fallback)}
      style={({ pressed }) => ({
        minWidth: 74,
        minHeight: 44,
        paddingHorizontal: spacing.sm + 2,
        borderRadius: radius.full,
        backgroundColor: palette.primarySoft,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <ChevronLeft accessible={false} size={19} color={palette.primaryText} strokeWidth={2.3} />
      <Text style={{ color: palette.primaryText, fontFamily: font.semibold, fontSize: 16, lineHeight: 20, includeFontPadding: false }}>
        {tr.common.back}
      </Text>
    </Pressable>
  );
}
