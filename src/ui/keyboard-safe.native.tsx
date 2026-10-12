/** Native half of the keyboard contract; web deliberately resolves keyboard-safe.tsx. */

import React from "react";
import { Platform, type ScrollViewProps } from "react-native";
import {
  KeyboardAwareScrollView,
  KeyboardProvider,
  type KeyboardAwareScrollViewRef,
} from "react-native-keyboard-controller";
import type { KeyboardSafeScrollViewProps } from "./keyboard-safe";

// The ref is ScrollView's (Screen also gives it to useScrollToTop); the controller's is ScrollView plus one method, and only ref invariance refuses it.
export function KeyboardSafeScrollView({ ref, ...props }: KeyboardSafeScrollViewProps) {
  return <KeyboardAwareScrollView ref={ref as React.Ref<KeyboardAwareScrollViewRef>} disableScrollOnKeyboardHide {...props} />;
}

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
