/** One owner for the navigation inset; layout rules read `useContentWidth()`, not the raw window width. */

import { useCallback, useState } from "react";
import { Platform, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { navigationInset } from "./theme";

export interface NavigationSpace {
  /** Space the navigation surface occupies below the content. */
  bottom: number;
  /** The window width. */
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
  return { bottom: inset.bottom, contentWidth: width, inTabs };
}

/** The width a layout rule should measure itself against. */
export function useContentWidth(): number {
  return useWindowDimensions().width;
}

/** Measure the box you are in when drawing at an explicit pixel width; a viewport number cannot know the columns around you. */
export function useMeasuredWidth(fallback: number): [number, (event: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(fallback);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setWidth((current) => (Math.abs(current - next) > 1 ? next : current));
  }, []);
  return [width, onLayout];
}
