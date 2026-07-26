import React, { useEffect, useRef } from "react";
import { Pressable } from "react-native";
import { useNavigation, useRouter, type Href } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { tr } from "../i18n/tr";
import { navigateBack } from "./navigation";
import { controlSize, iconSize, radius, useTheme } from "./theme";

/**
 * Native-header back control with a deterministic parent for direct links.
 *
 * It owns BOTH ways back from a screen. Tapping it runs `navigateBack`; on iOS
 * the edge swipe pops the stack directly and never reaches that call, so a
 * screen opened from another tab landed on the anchor the push mounted under it
 * — swiping back from Analysis returned to the Financial Table while the button
 * correctly returned to Summary. The listener finishes the same journey for the
 * gesture, so the two cannot disagree.
 */
export function HeaderBackButton({ fallback, exact }: { fallback: Href; exact?: boolean }) {
  const router = useRouter();
  const navigation = useNavigation();
  const { palette } = useTheme();
  // True while our own `navigateBack` is unwinding this stack, so the `back()`
  // it dispatches passes through instead of being read as a fresh gesture.
  const unwinding = useRef(false);

  useEffect(() => {
    if (!exact) return;
    const onBeforeRemove = (event: { preventDefault: () => void; data: { action: { type: string } } }) => {
      if (unwinding.current || event.data.action.type !== "POP") return;
      event.preventDefault();
      unwinding.current = true;
      navigateBack(router, fallback, true);
    };
    return navigation.addListener("beforeRemove" as never, onBeforeRemove as never);
  }, [navigation, router, fallback, exact]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr.common.back}
      hitSlop={4}
      onPress={() => {
        unwinding.current = true;
        navigateBack(router, fallback, exact);
      }}
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
