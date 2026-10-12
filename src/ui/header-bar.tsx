/**
 * The stack header, rendered by React on every platform: the native iOS bar
 * paints a system capsule behind a custom `headerLeft` that cannot be opted
 * out of, and a UIKit back item would bypass `navigateBack`.
 */

import { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { controlSize, font, spacing, type, useTheme, type Palette } from "./theme";

/** Header row height, excluding the top safe-area inset. */
const HEADER_ROW_HEIGHT = 64;

function HeaderBar({
  title,
  left,
}: {
  title?: string;
  left?: ReactNode;
}) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      testID="navigation-header"
      style={{
        backgroundColor: palette.surface,
        paddingTop: insets.top,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: palette.primary + "55",
      }}
    >
      <View style={{ minHeight: HEADER_ROW_HEIGHT, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm }}>
        {left}
        {title ? (
          // The screen title is the page's heading, exactly as the native
          // stack's own header exposed it — assistive technology and the
          // suite's `getByRole("heading")` both depend on that.
          <Text
            accessibilityRole="header"
            // Two lines, then shorten. A screen title is often a user-authored
            // item name — the ledger passes the column's own label through —
            // and an unbounded one pushed the back control's row down the page.
            // Two lines clears every ordinary name; the full text stays in the
            // heading's accessible name.
            numberOfLines={2}
            ellipsizeMode="tail"
            style={[
              type.heading,
              {
                color: palette.textStrong,
                fontFamily: font.semibold,
                flex: 1,
                minWidth: 0,
                flexShrink: 1,
                // The title sits against the back control when there is one,
                // and on the screen gutter when there is not. Either way it
                // shares the row's vertical centre with the chevron.
                paddingLeft: spacing.md,
                paddingRight: spacing.lg,
              },
            ]}
          >
            {title}
          </Text>
        ) : null}
        {/* Balance the row when there is no left control, so a title can never
            sit under a notch-adjacent control on one side only. */}
        {left ? null : <View style={{ width: controlSize.minimumTarget }} />}
      </View>
    </View>
  );
}

/**
 * How a pushed page arrives.
 *
 * Every route in this app is a `card`, so the transition is the only thing that
 * says a page was pushed rather than repainted — and the default on web is no
 * transition at all. `slide_from_right` matches the direction the back gesture
 * already implies on iOS, so the motion and the gesture agree about which way
 * the stack runs. iOS keeps its own native curve; the option only names it.
 *
 * Reduce Motion is handled below the navigator: the platform honours it for
 * native-stack transitions, and `react-native-screens` degrades to no animation
 * rather than to a broken one.
 */
const STACK_ANIMATION = "slide_from_right" as const;

/**
 * A navigable page with the app's own header.
 *
 * Every navigable route shares this stack contract — one header, one back rule,
 * one safe-area rule. Short contextual choices live in `ui/dialog` and
 * `ui/calendar` as real modals and never become a second navigation header.
 */
export function pageScreenOptions(palette: Palette) {
  return {
    animation: STACK_ANIMATION,
    headerStyle: { backgroundColor: palette.background },
    headerTintColor: palette.accentText,
    headerTitleStyle: { color: palette.textStrong, fontFamily: font.semibold },
    headerBackButtonDisplayMode: "minimal" as const,
    headerShadowVisible: false,
    // Every route in this stack goes back; none of them close or dismiss.
    gestureEnabled: true,
    contentStyle: { backgroundColor: palette.background },
    header: ({ options }: StackHeaderArgs) => (
      <HeaderBar title={options.title} left={options.headerLeft?.({ canGoBack: true, tintColor: palette.accentText })} />
    ),
  };
}

interface StackHeaderArgs {
  options: {
    title?: string;
    headerLeft?: (props: { canGoBack: boolean; tintColor?: string }) => ReactNode;
  };
}
