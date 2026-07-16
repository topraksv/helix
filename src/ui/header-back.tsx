import React from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { tr } from "../i18n/tr";
import { navigateBack } from "./navigation";
import { spacing, type, useTheme } from "./theme";

/** Native-header back control with a deterministic parent for direct links. */
export function HeaderBackButton({ fallback }: { fallback: Href }) {
  const router = useRouter();
  const { palette } = useTheme();
  const ICON = 22;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr.common.back}
      hitSlop={8}
      onPress={() => navigateBack(router, fallback)}
      style={({ pressed }) => ({
        height: 44,
        paddingLeft: spacing.xs,
        paddingRight: spacing.sm,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        opacity: pressed ? 0.55 : 1,
      })}
    >
      {/* Wrap the glyph in a box the same height as the text line so the chevron
          and label share one optical centre line on both web and native (the
          bare SVG sat a hair high against the label baseline otherwise). */}
      <View style={{ width: ICON, height: ICON, alignItems: "center", justifyContent: "center", marginLeft: -2 }}>
        <ChevronLeft size={ICON} color={palette.text} />
      </View>
      <Text style={[type.label, { color: palette.text, lineHeight: ICON, includeFontPadding: false }]}>
        {tr.common.back}
      </Text>
    </Pressable>
  );
}
