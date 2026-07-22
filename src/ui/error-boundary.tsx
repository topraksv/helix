/**
 * App-wide error boundary. A render-time throw (e.g. a corrupt value that
 * reaches `formatMinor`/`assertMinor`) would otherwise unmount the whole tree
 * to a blank screen with no recourse. This catches it, logs it, and shows a
 * themed recovery screen with a retry that re-mounts the subtree.
 *
 * Must be rendered *inside* ThemeContext.Provider so the fallback is themed.
 */

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
