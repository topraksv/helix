/** Calculator tab: the shared calculator pad plus a live currency converter. */

import React from "react";
import { View } from "react-native";
import { Card, Screen, SectionHeader } from "../../ui/components";
import { CalculatorPad } from "../../ui/calculator";
import { CurrencyConverter } from "../../ui/currency-converter";
import { tr } from "../../i18n/tr";

export default function CalculatorScreen() {
  return (
    <Screen title={tr.calc.title}>
      <CalculatorPad />
      <View style={{ height: 8 }} />
      <SectionHeader>{tr.calc.converterTitle}</SectionHeader>
      <Card>
        <CurrencyConverter />
      </Card>
    </Screen>
  );
}
