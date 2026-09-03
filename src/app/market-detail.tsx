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

import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import TrendingDown from "lucide-react-native/icons/trending-down";
import TrendingUp from "lucide-react-native/icons/trending-up";
import { INVESTMENT_MARKET_TITLES } from "../domain/investment-catalog";
import { historyChange, type MarketHistoryPoint, type MarketRange } from "../domain/market";
import { fetchMarketHistory, useMarkets } from "../services/markets";
import { clockOrDateTimeLabel, marketRateLabel, tr } from "../i18n/tr";
import { Body, Button, Card, Label, Row, Screen, Segmented, Spread, Title } from "../ui/components";
import { ChartFrame, Lines, useSeriesColors } from "../ui/charts";
import { DelayedLoadingIndicator } from "../ui/loading-indicator";
import { spacing, type, useTheme } from "../ui/theme";
import { WorkspaceGrid } from "../ui/workspace-layout";

const RANGES: readonly MarketRange[] = ["day", "week", "month", "year"];

const CLOCK_FORMAT = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });

/**
 * A point's own moment, said the way its range makes sense of it — and short
 * enough that six of them fit across a phone.
 *
 * The full forms were tried first and measured: "31 Ağustos 2026 22:00" on the
 * day range and "1 Eylül 2026" on the others, six to a 200px plot, printed one
 * unreadable run of overlapping text. A day already knows its date from the
 * range picker, and a year does not need the day of the month.
 */
function pointLabel(at: number, range: MarketRange): string {
  const when = new Date(at);
  if (range === "day") return CLOCK_FORMAT.format(when);
  const month = tr.months[when.getMonth()]?.slice(0, 3) ?? "";
  return range === "year"
    ? `${month} ${String(when.getFullYear()).slice(2)}`
    : `${when.getDate()} ${month}`;
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
        {/* The live price is what this screen is for, so it is the figure and
            not a row in a list. It used to be two label/value lines at body
            size, which put the number the screen exists to show at the same
            weight as the word "Satış" beside it. */}
        <Card>
          <Label>{title.label}</Label>
          {price ? (
            <>
              <Text selectable style={[type.amountMd, { color: palette.text, marginTop: spacing.xs }]}>
                {`${marketRateLabel(price.sellTry)} ₺`}
              </Text>
              <Body muted style={{ fontSize: type.small.fontSize }}>{tr.markets.sell}</Body>
              <Spread style={{ marginTop: spacing.md, alignItems: "baseline" }}>
                <Body muted style={{ fontSize: type.small.fontSize }}>{tr.markets.buy}</Body>
                <Text style={[type.amount, { color: palette.textSecondary }]}>
                  {marketRateLabel(price.buyTry)}
                </Text>
              </Spread>
              <Body muted style={{ fontSize: type.small.fontSize, marginTop: spacing.xs }}>
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
                <Row gap={spacing.xs} style={{ alignItems: "center" }}>
                  {ChangeIcon ? <ChangeIcon accessible={false} size={14} color={changeColor} /> : null}
                  <Body style={{ color: changeColor }}>
                    {change == null ? tr.markets.unchanged : `%${marketRateLabel(change * 100)}`}
                  </Body>
                </Row>
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
