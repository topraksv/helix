import React from "react";
import { Pressable } from "react-native";
import { useRouter, type Href } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { tr } from "../i18n/tr";
import { navigateBack } from "./navigation";
import { radius, useTheme } from "./theme";

/** Native-header back control with a deterministic parent for direct links. */
export function HeaderBackButton({ fallback }: { fallback: Href }) {
  const router = useRouter();
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr.common.back}
      hitSlop={4}
      onPress={() => navigateBack(router, fallback)}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: radius.full,
        backgroundColor: pressed ? palette.surfaceHover : "transparent",
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      <ChevronLeft accessible={false} size={25} color={palette.accentText} strokeWidth={2.2} />
    </Pressable>
  );
}
