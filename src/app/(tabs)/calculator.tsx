/** Calculator tab: a full-screen version of the shared calculator pad. */

import React from "react";
import { Screen } from "../../ui/components";
import { CalculatorPad } from "../../ui/calculator";
import { tr } from "../../i18n/tr";

export default function CalculatorScreen() {
  return (
    <Screen title={tr.calc.title}>
      <CalculatorPad />
    </Screen>
  );
}
