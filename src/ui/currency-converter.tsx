/**
 * Currency converter shown under the calculator. Converts freely between the
 * app's supported currencies (TRY/USD/EUR/GBP) using the cached FX rates
 * (TRY-per-unit), cross-rating through TRY. Read-only helper — it never writes
 * a transaction; it just answers "how much is X in Y right now".
 */

import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ArrowDownUp } from "lucide-react-native";
import { formatMinor, roundHalfAwayFromZero } from "../domain/money";
import { loadRateCache, lookupRate, SUPPORTED_CURRENCIES, type Currency } from "../services/fx-fetch";
import { useUserId } from "../data/hooks";
import { tr } from "../i18n/tr";
import { Badge, Body, Label, MoneyField, Segmented } from "./components";
import { radius, spacing, type, useTheme } from "./theme";

export function CurrencyConverter() {
  const { palette } = useTheme();
  const userId = useUserId();
  const [raw, setRaw] = useState("");
  const [minor, setMinor] = useState<number | null>(null);
  const [from, setFrom] = useState<Currency>("USD");
  const [to, setTo] = useState<Currency>("TRY");
  // FX rates live in a module cache filled on app open; refresh on mount and
  // re-render once loaded so this screen shows a value without a full reload.
  const [, setTick] = useState(0);
  useEffect(() => {
    void loadRateCache(userId).then(() => setTick((t) => t + 1));
  }, [userId]);

  const rateFrom = lookupRate(userId, from);
  const rateTo = lookupRate(userId, to);
  const ready = rateFrom != null && rateTo != null;
  const stale = (rateFrom?.isStale ?? false) || (rateTo?.isStale ?? false);
  const resultMinor =
    minor != null && ready ? roundHalfAwayFromZero((minor * rateFrom!.rate.rateTry) / rateTo!.rate.rateTry) : null;

  const options = SUPPORTED_CURRENCIES.map((c) => ({ value: c, label: c }));
  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  return (
    <View>
      <MoneyField
        label={tr.calc.convertFrom}
        value={raw}
        placeholder="0,00"
        onChangeMinor={(r, m) => {
          setRaw(r);
          setMinor(m);
        }}
      />
      <Segmented options={options} value={from} onChange={(c) => setFrom(c as Currency)} />

      <View style={{ alignItems: "center", marginVertical: spacing.xs }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr.calc.swap}
          onPress={swap}
          hitSlop={8}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: palette.surfaceAlt,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ArrowDownUp size={18} color={palette.primary} />
        </Pressable>
      </View>

      <Label>{tr.calc.convertTo}</Label>
      <Segmented options={options} value={to} onChange={(c) => setTo(c as Currency)} />

      <View
        style={{
          marginTop: spacing.md,
          backgroundColor: palette.surfaceAlt,
          borderRadius: radius.md,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          alignItems: "flex-end",
        }}
      >
        {resultMinor != null ? (
          <Text style={[type.amountLg, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit>
            {formatMinor(resultMinor, to)}
          </Text>
        ) : (
          <Body muted>{ready ? tr.calc.enterAmount : tr.calc.rateMissing}</Body>
        )}
      </View>
      {stale && ready ? (
        <View style={{ marginTop: spacing.sm, alignItems: "flex-start" }}>
          <Badge text={`⚠ ${tr.tx.staleRate}`} tone="warning" />
        </View>
      ) : null}
    </View>
  );
}
