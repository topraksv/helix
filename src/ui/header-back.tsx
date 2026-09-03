import { Pressable } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import { tr } from "../i18n/tr";
import { navigateBack } from "./navigation";
import { interactionSurface } from "./interaction";
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
      onPress={() => navigateBack(router, fallback)}
      style={(state) => ({
        width: controlSize.minimumTarget,
        height: controlSize.minimumTarget,
        borderRadius: radius.full,
        ...interactionSurface(palette, state),
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      <ChevronLeft accessible={false} size={iconSize.headerBack} color={palette.accentText} strokeWidth={2.2} />
    </Pressable>
  );
}

/**
 * `/transaction` is two screens behind one route: the ordinary entry form,
 * reached from the ledger, and the wallet transfer, reached from Investments.
 * A single static fallback could only be right for one of them, so leaving the
 * transfer without saving walked out into the Financial Table — a different tab
 * from the one the user was in. The intent is already in the URL; the parent
 * follows it.
 */
export function TransactionBackButton() {
  const { intent } = useLocalSearchParams<{ intent?: string }>();
  return <HeaderBackButton fallback={intent === "investment-refund" ? "/(tabs)/investments" : "/(tabs)/cash-flow"} />;
}
