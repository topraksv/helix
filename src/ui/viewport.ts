/**
 * Where navigation is, and how much width that leaves the content.
 *
 * Every responsive decision in the app used to read the raw window width, which
 * was the same number as the content width for as long as navigation was a bar
 * floating over the bottom of the scene. A rail standing beside the content
 * broke that equality without breaking any of the call sites: at a 1024 px
 * window the dashboard still paired its columns as if it had 1024, while the
 * column it was laying out was 784.
 *
 * So the inset has one owner and the predicates get the width that actually
 * exists. `Screen` reads it for its own padding, and every layout rule reads
 * `useContentWidth()` instead of `useWindowDimensions().width`.
 */

import { useCallback, useState } from "react";
import { Platform, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { shouldBoundIntrinsicControls } from "./responsive";
import { navigationInset, segmentedMaxWidth } from "./theme";

export interface NavigationSpace {
  /** Space the navigation surface occupies below the content. */
  bottom: number;
  /** Space it occupies before the content. */
  left: number;
  /** Window width minus that leading space — what a layout really has. */
  contentWidth: number;
  /** Whether this screen is inside the tab navigator at all. */
  inTabs: boolean;
}

export function useNavigationSpace(): NavigationSpace {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  // Root routes (a modal, the auth stack, onboarding) have no navigation
  // surface of their own, so nothing is taken from them.
  const inTabs = segments[0] === "(tabs)";
  const inset = navigationInset({ bottomInset: insets.bottom, isWeb: Platform.OS === "web" });
  const left = inTabs ? inset.left : 0;
  return { bottom: inset.bottom, left, contentWidth: width - left, inTabs };
}

/** The width a layout rule should measure itself against. */
export function useContentWidth(): number {
  return useNavigationSpace().contentWidth;
}

/**
 * The width a cluster of `count` equal controls should stop at.
 *
 * `undefined` below the threshold, where the container is still the right bound
 * and a phone expects a control to fill its column. Above it a row of controls
 * left to fill a workspace stops being a control and becomes a banner — four
 * investment actions each got 295px of empty tile before this.
 */
export function useClusterWidth(count: number): number | undefined {
  const contentWidth = useContentWidth();
  return shouldBoundIntrinsicControls(contentWidth) ? segmentedMaxWidth(count) : undefined;
}

/**
 * The width of the box this content is actually in.
 *
 * The content width answers "how wide is the page column"; it cannot answer
 * "how wide is the card I am inside, in the narrower of two desktop columns".
 * Anything that has to be drawn at an explicit pixel width — an SVG chart — has
 * to ask its own container, because every derivation from a viewport number
 * guesses at the padding and columns between the two and eventually guesses
 * wrong: the same expression that fitted a full-width card overflowed it by
 * 220px once a rail stood beside the page.
 *
 * The fallback covers the frame before the first layout pass, so a chart never
 * flashes empty.
 */
export function useMeasuredWidth(fallback: number): [number, (event: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(fallback);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setWidth((current) => (Math.abs(current - next) > 1 ? next : current));
  }, []);
  return [width, onLayout];
}
