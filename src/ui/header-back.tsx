import React from "react";
import { Pressable } from "react-native";
import { useRouter, type Href } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { tr } from "../i18n/tr";
import { navigateBack } from "./navigation";
import { controlSize, iconSize, radius, useTheme } from "./theme";

/**
 * Native-header back control with a deterministic parent for direct links.
 *
 * It does not need to know where a screen was opened from. A cross-tab push
 * goes to that screen's root-level route, so whatever sits under it IS the
 * screen the user came from — plain history is already the right answer, and
 * the iOS edge swipe, which pops the stack without consulting any of this,
 * reaches the same place. The fallback is only for a direct link, where there
 * is no history to pop.
 */
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
        width: controlSize.minimumTarget,
        height: controlSize.minimumTarget,
        borderRadius: radius.full,
        backgroundColor: pressed ? palette.surfaceHover : "transparent",
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      <ChevronLeft accessible={false} size={iconSize.headerBack} color={palette.accentText} strokeWidth={2.2} />
    </Pressable>
  );
}
