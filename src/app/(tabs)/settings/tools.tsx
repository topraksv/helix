/** Settings tool workspace: calculator plus a live currency converter. */

import React from "react";
import { View } from "react-native";
import { useContentWidth } from "../../../ui/viewport";
import { Card, Screen, Title } from "../../../ui/components";
import { CalculatorPad } from "../../../ui/calculator";
import { CurrencyConverter } from "../../../ui/currency-converter";
import { tr } from "../../../i18n/tr";
import { spacing } from "../../../ui/theme";
import { WorkspaceSplit } from "../../../ui/workspace-layout";

export default function CalculatorScreen() {
  const wide = useContentWidth() >= 900;
  return (
    <Screen width="workspace">
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
