/** Catches a render throw so the tree is not left blank; retry remounts. Render inside ThemeContext so the fallback is themed. */

import React from "react";
import { View } from "react-native";
import { Button, Screen, Title, Body } from "./components";
import { spacing } from "./theme";
import { tr } from "../i18n/tr";
import { devError } from "../services/logger";

function ErrorFallback({ onReset }: { onReset: () => void }) {
  return (
    <Screen scroll={false}>
      <View style={{ flex: 1, justifyContent: "center", gap: spacing.md }}>
        <Title>{tr.errors.appCrashed}</Title>
        <Body muted>{tr.errors.appCrashedHint}</Body>
        <View style={{ marginTop: spacing.md }}>
          <Button label={tr.common.retry} onPress={onReset} />
        </View>
      </View>
    </Screen>
  );
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    // The single render-crash boundary. Production persists only the logger's
    // redacted category; raw error/stack remains development-only.
    devError("error-boundary", error, info?.componentStack);
  }

  private reset = () => this.setState({ hasError: false });

  render() {
    return this.state.hasError ? <ErrorFallback onReset={this.reset} /> : this.props.children;
  }
}
