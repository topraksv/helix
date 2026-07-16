import React from "react";
import { Pressable, Text } from "react-native";
import { useRouter, type Href } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { tr } from "../i18n/tr";
import { navigateBack } from "./navigation";
import { spacing, type, useTheme } from "./theme";

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
        minHeight: 44,
        minWidth: 64,
        paddingRight: spacing.sm,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        opacity: pressed ? 0.55 : 1,
      })}
    >
      <ChevronLeft size={23} color={palette.text} />
      <Text style={[type.label, { color: palette.text, lineHeight: 20 }]}>{tr.common.back}</Text>
    </Pressable>
  );
}
