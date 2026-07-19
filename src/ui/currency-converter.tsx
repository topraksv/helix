/**
 * Currency converter shown under the calculator. Converts freely between the
 * app's supported currencies (TRY/USD/EUR/GBP), cross-rating through TRY.
 * Fresh USD/EUR quotes reuse the live-market connection already owned by the
 * app; the dated local FX cache covers GBP, offline use and feed outages. This
 * read-only helper never opens a separate network request or writes a row.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { ArrowDownUp } from "lucide-react-native";
import { formatMinor, roundHalfAwayFromZero } from "../domain/money";
import { todayISO } from "../domain/dates";
import { ensureFreshRates, loadRateCache, lookupRate, SUPPORTED_CURRENCIES, useFxRates, type Currency } from "../services/fx-fetch";
import { marketLastKnownRateTry, useMarkets } from "../services/markets";
import { useUserId } from "../data/hooks";
import { clockOrDateTimeLabel, dateLabel, tr } from "../i18n/tr";
import { Badge, Body, Label, MoneyField, Segmented } from "./components";
import { radius, spacing, type, useTheme } from "./theme";

export function CurrencyConverter() {
  const { palette } = useTheme();
  const userId = useUserId();
  const [raw, setRaw] = useState("");
  const [minor, setMinor] = useState<number | null>(null);
  const [from, setFrom] = useState<Currency>("USD");
  const [to, setTo] = useState<Currency>("TRY");
  // FX rates live in a module cache filled on app open. Subscribe to the cache
  // version so a background refresh landing after mount re-renders this screen
  // (a cold start otherwise left it on "rate unavailable"); also kick a load in
  // case the cache is empty.
  useFxRates();
  useMarkets((state) => state.prices);
  useEffect(() => {
    void loadRateCache(userId).catch(() => {});
  }, [userId]);

  // Rate resolution mirrors the Summary card exactly: a live quote converts
  // silently; the card's last-known quote converts with its receipt time shown;
  // the dated FX cache is only used when it is strictly newer than that quote.
  // Ledger-writing conversions elsewhere keep the strict 60 s live contract.
  type ConverterBadge =
    | { kind: "market"; receivedAt: number }
    | { kind: "fx"; rateDate: string }
    | null;
  const converterRate = (currency: Currency): { rateTry: number; badge: ConverterBadge } | null => {
    const market = marketLastKnownRateTry(currency);
    if (market?.live) return { rateTry: market.rateTry, badge: null };
    const cached = lookupRate(userId, currency);
    if (market && (cached == null || todayISO(new Date(market.receivedAt)) >= cached.rate.rateDate)) {
      return { rateTry: market.rateTry, badge: { kind: "market", receivedAt: market.receivedAt } };
    }
    if (cached == null) return null;
    return {
      rateTry: cached.rate.rateTry,
      badge: cached.isStale ? { kind: "fx", rateDate: cached.rate.rateDate } : null,
    };
  };
  const rateFrom = converterRate(from);
  const rateTo = converterRate(to);
  const ready = rateFrom != null && rateTo != null;
  const fxBadge = [rateFrom?.badge, rateTo?.badge].find((b) => b?.kind === "fx") ?? null;
  const marketBadge = [rateFrom?.badge, rateTo?.badge].find((b) => b?.kind === "market") ?? null;

  // A dated or missing rate refreshes while the screen is open — never require
  // an app restart. Throttled + session-scoped inside `ensureFreshRates`.
  const needsRefresh = !ready || fxBadge != null || marketBadge != null;
  useFocusEffect(
    useCallback(() => {
      if (needsRefresh) ensureFreshRates(userId);
    }, [needsRefresh, userId]),
  );
  const converted = minor != null && ready
    ? roundHalfAwayFromZero((minor * rateFrom!.rateTry) / rateTo!.rateTry)
    : null;
  const resultMinor = converted != null && Number.isSafeInteger(converted) ? converted : null;
  const resultOutOfRange = minor != null && ready && resultMinor == null;

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
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: palette.surfaceAlt,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ArrowDownUp accessible={false} size={18} color={palette.primary} />
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
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ alignSelf: "stretch" }}
            contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end", alignItems: "flex-end" }}
          >
            <Text style={[type.amountLg, { color: palette.text, textAlign: "right" }]}>{formatMinor(resultMinor, to)}</Text>
          </ScrollView>
        ) : (
          <Body muted>{resultOutOfRange ? tr.calc.resultUnavailable : ready ? tr.calc.enterAmount : tr.calc.rateMissing}</Body>
        )}
      </View>
      {ready && (fxBadge || marketBadge) ? (
        <View style={{ marginTop: spacing.sm, alignItems: "flex-start" }}>
          {fxBadge?.kind === "fx" ? (
            <Badge text={`⚠ ${tr.calc.staleRateDated(dateLabel(fxBadge.rateDate))}`} tone="warning" />
          ) : marketBadge?.kind === "market" ? (
            <Badge text={tr.calc.lastLiveRate(clockOrDateTimeLabel(marketBadge.receivedAt))} tone="muted" />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
