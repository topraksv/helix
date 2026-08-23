/**
 * Settings tool workspace: calculator plus a live currency converter.
 *
 * The two headings inside are SECTION headings. They used to be `Title`, which
 * is the 26pt serif role the page title uses — so this screen drew two page
 * titles side by side under a stack header that was already showing the real
 * one, and its heading hierarchy sat one step above every sibling in Settings.
 */

import React from "react";
import { View } from "react-native";
import { shouldUseWideWorkspace } from "../../../ui/responsive";
import { useContentWidth } from "../../../ui/viewport";
import { Card, Screen, SectionHeader } from "../../../ui/components";
import { CalculatorPad } from "../../../ui/calculator";
import { CurrencyConverter } from "../../../ui/currency-converter";
import { tr } from "../../../i18n/tr";
import { spacing } from "../../../ui/theme";
import { WorkspaceSplit } from "../../../ui/workspace-layout";

export default function CalculatorScreen() {
  const wide = shouldUseWideWorkspace(useContentWidth());
  return (
    <Screen width="workspace">
      <WorkspaceSplit
        testID="calculator-workspace"
        primaryWeight={1}
        secondaryWeight={1}
        primary={(
          <View testID="calculator-tool">
            <SectionHeader>{tr.calc.title}</SectionHeader>
            <Card>
              <CalculatorPad />
            </Card>
          </View>
        )}
        secondary={(
          <View testID="converter-tool" style={wide ? undefined : { marginTop: spacing.xl }}>
            <SectionHeader>{tr.calc.converterTitle}</SectionHeader>
            <Card>
              <CurrencyConverter />
            </Card>
          </View>
        )}
      />
    </Screen>
  );
}
