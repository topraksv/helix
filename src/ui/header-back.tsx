import React from "react";
import { Pressable } from "react-native";
import { useRouter, type Href } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { tr } from "../i18n/tr";
import { navigateBack } from "./navigation";
import { controlSize, radius, useTheme } from "./theme";

/** Native-header back control with a deterministic parent for direct links. */
export function HeaderBackButton({ fallback, exact }: { fallback: Href; exact?: boolean }) {
  const router = useRouter();
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr.common.back}
      hitSlop={4}
      onPress={() => navigateBack(router, fallback, exact)}
      style={({ pressed }) => ({
        width: controlSize.minimumTarget,
        height: controlSize.minimumTarget,
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
