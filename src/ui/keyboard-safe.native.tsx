/** Native half of the keyboard contract; web deliberately resolves keyboard-safe.tsx. */

import React from "react";
import { Platform, ScrollView, type ScrollViewProps } from "react-native";
import { KeyboardAwareScrollView, KeyboardProvider } from "react-native-keyboard-controller";
import type { KeyboardSafeScrollViewProps } from "./keyboard-safe";

/**
 * The controller follows the keyboard frame and focused input rather than
 * asking each form to maintain its own KeyboardAvoidingView inset.
 */
export const KeyboardSafeScrollView = React.forwardRef<ScrollView, KeyboardSafeScrollViewProps>(
  ({ bottomOffset, extraKeyboardSpace, ...props }, ref) => (
    <KeyboardAwareScrollView
      ref={ref}
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
