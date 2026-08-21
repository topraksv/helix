/**
 * The app's own stack header, rendered by React on every platform.
 *
 * The native stack draws its header with UIKit: it owns the metrics, and since
 * iOS 26 it paints a shared glass background behind every bar button item. A
 * custom `headerLeft` therefore came out looking nothing like the web one — a
 * chevron inside a system capsule, positioned by UIKit — and no amount of
 * styling on our side could move it, because our view was only the capsule's
 * content. react-native-screens 4.16 exposes no way to opt out of that
 * background for a plain `headerLeft`.
 *
 * Rendering the header ourselves makes web and native the SAME React tree, so
 * "identical on both platforms" is structural instead of a coincidence to
 * re-verify after every OS release. It also puts the back press back in our
 * hands: with a UIKit bar button the system can pop the stack directly,
 * bypassing the recorded-origin logic in `navigateBack`.
 *
 * Screens keep declaring `headerLeft` exactly as before; this component just
 * renders it, so there is one back control and one back rule everywhere.
 */

import React, { type ReactNode } from "react";
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
    // One header component on every platform — see `ui/header-bar.tsx` for why
    // the native stack's own header could not be made to match the web one.
    // Screens still declare `headerLeft`; this renders whatever they declared.
    header: ({ options }: StackHeaderArgs) => (
      <HeaderBar title={options.title} left={options.headerLeft?.({ canGoBack: true, tintColor: palette.accentText })} />
    ),
  };
}

/** The same page, presented as a card over its parent. */
export function cardScreenOptions(palette: Palette) {
  return { ...pageScreenOptions(palette), presentation: "card" as const };
}

interface StackHeaderArgs {
  options: {
    title?: string;
    headerLeft?: (props: { canGoBack: boolean; tintColor?: string }) => ReactNode;
  };
}
