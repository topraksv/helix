import { useEffect } from "react";
import { AccessibilityInfo, Platform, Text, View } from "react-native";
import AlertCircle from "lucide-react-native/icons/circle-alert";
import CheckCircle2 from "lucide-react-native/icons/circle-check";
import { iconSize, radius, spacing, type, useTheme } from "./theme";

export function AuthNotice({ tone, text }: { tone: "success" | "error"; text: string }) {
  const { palette } = useTheme();
  useEffect(() => {
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
  const Icon = tone === "success" ? CheckCircle2 : AlertCircle;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: palette[tone] + "16", borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md }}>
      <Icon accessible={false} size={iconSize.control} color={palette[tone]} />
      <Text
        accessibilityRole={tone === "error" ? "alert" : undefined}
        accessibilityLiveRegion={tone === "error" ? "assertive" : "polite"}
        style={[type.label, { color: tone === "error" ? palette.errorText : palette.successText, flex: 1 }]}
      >
        {text}
      </Text>
    </View>
  );
}
