/** Calculator tab: the shared calculator pad plus a live currency converter. */

import React from "react";
import { View, useWindowDimensions } from "react-native";
import { Card, Screen, Title } from "../../ui/components";
import { CalculatorPad } from "../../ui/calculator";
import { CurrencyConverter } from "../../ui/currency-converter";
import { tr } from "../../i18n/tr";
import { spacing } from "../../ui/theme";
import { WorkspaceSplit } from "../../ui/workspace-layout";

export default function CalculatorScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  return (
    <Screen title={tr.tabs.calculator} maxWidth={1100}>
      <WorkspaceSplit
        testID="calculator-workspace"
        primaryWeight={1}
        secondaryWeight={1}
        primary={(
          <View testID="calculator-tool">
            <Title>{tr.calc.title}</Title>
            <Card>
              <CalculatorPad />
            </Card>
          </View>
        )}
        secondary={(
          <View testID="converter-tool" style={wide ? undefined : { marginTop: spacing.xl }}>
            <Title>{tr.calc.converterTitle}</Title>
            <Card>
              <CurrencyConverter />
            </Card>
          </View>
        )}
      />
    </Screen>
  );
}
