/** Calculator tab: the shared calculator pad plus a live currency converter. */

import React from "react";
import { View } from "react-native";
import { Card, Screen, Title } from "../../ui/components";
import { CalculatorPad } from "../../ui/calculator";
import { CurrencyConverter } from "../../ui/currency-converter";
import { tr } from "../../i18n/tr";
import { spacing } from "../../ui/theme";

export default function CalculatorScreen() {
  return (
    <Screen title={tr.calc.title}>
      <CalculatorPad />
      <View style={{ height: spacing.xl }} />
      <Title>{tr.calc.converterTitle}</Title>
      <Card>
        <CurrencyConverter />
      </Card>
    </Screen>
  );
}
