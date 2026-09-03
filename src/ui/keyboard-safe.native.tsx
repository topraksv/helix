/** Native half of the keyboard contract; web deliberately resolves keyboard-safe.tsx. */

import React from "react";
import { Platform, ScrollView, type ScrollViewProps } from "react-native";
import {
  KeyboardAwareScrollView,
  KeyboardProvider,
  type KeyboardAwareScrollViewRef,
} from "react-native-keyboard-controller";
import type { KeyboardSafeScrollViewProps } from "./keyboard-safe";

/**
 * The controller follows the keyboard frame and focused input rather than
 * asking each form to maintain its own KeyboardAvoidingView inset.
 *
 * WHY THE REF IS RE-TYPED HERE. Since keyboard-controller 1.20 the component
 * hands back `KeyboardAwareScrollViewRef`, which is `ScrollView` plus one
 * extra method. Every instance therefore satisfies the `ScrollView` ref this
 * module publishes, and it has to stay `ScrollView`: the ref `Screen` passes
 * in is the same one it gives `useScrollToTop`, and the web sibling backs the
 * identical contract with a plain `ScrollView`. TypeScript still refuses the
 * assignment because a mutable `RefObject` is invariant, not because the value
 * is wrong — so the cast narrows a type rule, never a runtime guarantee.
 */
export const KeyboardSafeScrollView = React.forwardRef<ScrollView, KeyboardSafeScrollViewProps>(
  ({ bottomOffset, extraKeyboardSpace, ...props }, ref) => (
    <KeyboardAwareScrollView
      ref={ref as React.Ref<KeyboardAwareScrollViewRef>}
      bottomOffset={bottomOffset}
      extraKeyboardSpace={extraKeyboardSpace}
      // The focused field should stay where the user was reading after the
      // keyboard closes; snapping the whole form back down is disorienting.
      disableScrollOnKeyboardHide
      {...props}
    />
  ),
);

KeyboardSafeScrollView.displayName = "KeyboardSafeScrollView";

/** See the web sibling: VirtualizedList calls this callback outside React. */
export function renderKeyboardSafeListScroll(props: ScrollViewProps) {
  return (
    <KeyboardAwareScrollView
      {...props}
      bottomOffset={96}
      extraKeyboardSpace={96}
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustContentInsets={false}
    />
  );
}

/** Preloading can flash a keyboard on cold launch, so focus remains on demand. */
export function KeyboardSafeRoot({ children }: { children: React.ReactNode }) {
  return <KeyboardProvider preload={false}>{children}</KeyboardProvider>;
}
