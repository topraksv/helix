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
    <Screen title={tr.calc.title} maxWidth={1100}>
      <WorkspaceSplit
        testID="calculator-workspace"
        primary={<CalculatorPad />}
        secondary={(
          <View style={wide ? undefined : { marginTop: spacing.xl }}>
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
