import React from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { tr } from "../i18n/tr";
import { navigateBack } from "./navigation";
import { font, useTheme } from "./theme";

/** Native-header back control with a deterministic parent for direct links. */
export function HeaderBackButton({ fallback }: { fallback: Href }) {
  const router = useRouter();
  const { palette } = useTheme();
  const controlHeight = 44;
  const iconSize = 20;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr.common.back}
      hitSlop={8}
      onPress={() => navigateBack(router, fallback)}
      style={({ pressed }) => ({
        width: 82,
        height: controlHeight,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.55 : 1,
      })}
    >
      <View
        style={{
          height: controlHeight,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 3,
        }}
      >
        <View style={{ width: iconSize, height: iconSize, alignItems: "center", justifyContent: "center" }}>
          <ChevronLeft size={iconSize} color={palette.text} />
        </View>
        <Text
          style={{
            color: palette.text,
            fontFamily: font.medium,
            fontSize: 15,
            lineHeight: iconSize,
            includeFontPadding: false,
            textAlignVertical: "center",
          }}
        >
          {tr.common.back}
        </Text>
      </View>
    </Pressable>
  );
}
