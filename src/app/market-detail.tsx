/**
 * One market instrument, with its past.
 *
 * The Summary card's tiles were a wall of current numbers with nowhere to go:
 * a price on its own says nothing about whether it is high. This is where a
 * tapped tile lands — the same two-sided quote it was showing, and the shape
 * behind it over a day, a week, a month or a year.
 *
 * The history is built from the same public order books as the live price, by
 * the same arithmetic (`domain/market.ts`), so the chart and the tile can never
 * tell different stories. It is fetched on demand and never cached: it is one
 * request away, and a chart that quietly shows last week's shape is worse than
 * one that admits it has nothing.
 */

import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import TrendingDown from "lucide-react-native/icons/trending-down";
import TrendingUp from "lucide-react-native/icons/trending-up";
import { INVESTMENT_MARKET_TITLES } from "../domain/investment-catalog";
import { historyChange, type MarketHistoryPoint, type MarketRange } from "../domain/market";
import { fetchMarketHistory, useMarkets } from "../services/markets";
import { clockOrDateTimeLabel, dateLabel, tr } from "../i18n/tr";
import { Body, Button, Card, Label, Screen, Segmented, Spread, Title } from "../ui/components";
import { ChartFrame, Lines, useSeriesColors } from "../ui/charts";
import { DelayedLoadingIndicator } from "../ui/loading-indicator";
import { spacing, type, useTheme } from "../ui/theme";
import { WorkspaceGrid } from "../ui/workspace-layout";

const RANGES: readonly MarketRange[] = ["day", "week", "month", "year"];

function priceText(value: number): string {
  return new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

/** A point's own moment, said the way its range makes sense of it. */
function pointLabel(at: number, range: MarketRange): string {
  return range === "day" ? clockOrDateTimeLabel(at) : dateLabel(new Date(at).toISOString().slice(0, 10));
}

export default function MarketDetailScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = typeof params.code === "string" ? params.code : "";
  const title = INVESTMENT_MARKET_TITLES.find((item) => item.code === code);
  const price = useMarkets((state) => state.prices[code]);
  const { palette } = useTheme();
  const colors = useSeriesColors();

  const [range, setRange] = useState<MarketRange>("month");
  const [points, setPoints] = useState<MarketHistoryPoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!title) return;
    let live = true;
    setLoading(true);
    void fetchMarketHistory(code, range).then((result) => {
      if (!live) return;
      setPoints(result);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [code, range, title, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  // A code that names no instrument is a hand-edited URL, not a state the app
  // can be in. It says so rather than rendering an empty chart of nothing.
  if (!title) {
    return (
      <Screen width="workspace">
        <Card>
          <Title>{tr.markets.unknownInstrument}</Title>
        </Card>
      </Screen>
    );
  }

  const change = points ? historyChange(points) : null;
  const changeColor = change == null || change === 0
    ? palette.textSecondary
    : change > 0 ? palette.positive : palette.negative;
  const ChangeIcon = change != null && change !== 0 ? (change > 0 ? TrendingUp : TrendingDown) : null;

  return (
    <Screen width="workspace">
      <WorkspaceGrid testID="market-detail-grid" layout="stack">
        <Card>
          <Label>{title.label}</Label>
          {price ? (
            <>
              <Spread style={{ marginTop: spacing.sm }}>
                <Body muted>{tr.markets.buy}</Body>
                <Body style={type.amountSm}>{priceText(price.buyTry)}</Body>
              </Spread>
              <Spread style={{ marginTop: spacing.xs }}>
                <Body muted>{tr.markets.sell}</Body>
                <Body style={type.amount}>{`${priceText(price.sellTry)} ₺`}</Body>
              </Spread>
              <Body muted style={{ fontSize: type.small.fontSize, marginTop: spacing.sm }}>
                {tr.markets.updatedAt(clockOrDateTimeLabel(price.receivedAt))}
              </Body>
            </>
          ) : (
            <Body muted style={{ marginTop: spacing.sm }}>{tr.markets.noData}</Body>
          )}
        </Card>

        <Card>
          <Segmented
            value={range}
            onChange={setRange}
            fill
            options={RANGES.map((value) => ({ value, label: tr.markets.range[value] }))}
          />
          {loading ? (
            <View style={{ minHeight: 220, alignItems: "center", justifyContent: "center" }}>
              <DelayedLoadingIndicator label={tr.markets.historyLoading} />
            </View>
          ) : points == null ? (
            <View style={{ minHeight: 220, alignItems: "center", justifyContent: "center", gap: spacing.md }}>
              <Body muted>{tr.markets.historyUnavailable}</Body>
              <Button label={tr.markets.retryNow} variant="secondary" onPress={retry} />
            </View>
          ) : (
            <>
              <Spread style={{ marginBottom: spacing.sm }}>
                <Body muted style={{ fontSize: type.small.fontSize }}>
                  {tr.markets.rangeChange(tr.markets.range[range])}
                </Body>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                  {ChangeIcon ? <ChangeIcon accessible={false} size={14} color={changeColor} /> : null}
                  <Body style={{ color: changeColor }}>
                    {change == null ? tr.markets.unchanged : `%${priceText(change * 100)}`}
                  </Body>
                </View>
              </Spread>
              <ChartFrame>
                {(chartWidth) => (
                  <Lines
                    width={chartWidth}
                    height={220}
                    baseline="range"
                    xLabels={points.map((point) => pointLabel(point.at, range))}
                    series={[{
                      label: title.label,
                      color: colors[0]!,
                      // The chart's vocabulary is minor units, the same as every
                      // other amount in the app, so its axis and its readout
                      // format prices exactly like the ledger formats money.
                      points: points.map((point) => Math.round(point.valueTry * 100)),
                    }]}
                  />
                )}
              </ChartFrame>
            </>
          )}
          <Body muted style={{ fontSize: type.small.fontSize, marginTop: spacing.md }}>
            {tr.markets.sourceNote}
          </Body>
        </Card>
      </WorkspaceGrid>
    </Screen>
  );
}
