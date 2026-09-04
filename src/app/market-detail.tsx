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
 *
 * It also RE-fetches while the screen is open. The price above it comes from
 * the ticker store and moves on its own, so a chart that was fetched once sat
 * beside a figure it no longer agreed with — the longer the screen was left
 * open, the further apart the two answers drifted, and nothing on the page
 * said which one was old. Only the newest candle actually moves, and it moves
 * at the same rate whatever interval is being drawn, so one cadence serves
 * every range.
 */

import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import TrendingDown from "lucide-react-native/icons/trending-down";
import TrendingUp from "lucide-react-native/icons/trending-up";
import { INVESTMENT_MARKET_TITLES } from "../domain/investment-catalog";
import { historyDelta, historyExtent, type MarketHistoryPoint, type MarketRange } from "../domain/market";
import { fetchMarketHistory, useMarkets } from "../services/markets";
import { clockOrDateTimeLabel, marketRateLabel, tr } from "../i18n/tr";
import { Body, Button, Card, Label, Row, Screen, Segmented, Spread, Title } from "../ui/components";
import { ChartFrame, Lines, useSeriesColors } from "../ui/charts";
import { useScreenFocus } from "../ui/motion-primitives";
import { DelayedLoadingIndicator } from "../ui/loading-indicator";
import { spacing, type, useTheme } from "../ui/theme";
import { WorkspaceGrid } from "../ui/workspace-layout";

const RANGES: readonly MarketRange[] = ["day", "week", "month", "year"];

/**
 * How often an open chart re-reads its own range.
 *
 * A minute, for every range. Only the newest candle is still moving and it
 * moves at the same rate whether it is an hour wide or a week wide, so the
 * interval being drawn does not change how often the picture is wrong. Six
 * times less traffic than the ticker beside it, against the same public host.
 */
const HISTORY_REFRESH_MS = 60_000;

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
  // A chart nobody is looking at must not fetch, on the same rule the tiles'
  // flash follows: leaving this screen in a tab behind another one should cost
  // nothing.
  const focused = useScreenFocus();

  useEffect(() => {
    if (!title) return;
    let live = true;
    // The spinner belongs to an EMPTY chart, not to a refresh. Clearing the
    // plot every minute to show a loading indicator would make a screen that
    // keeps itself current look like one that keeps losing its data.
    setPoints((current) => {
      if (current === null) setLoading(true);
      return current;
    });
    void fetchMarketHistory(code, range).then((result) => {
      if (!live) return;
      // A failed refresh keeps the shape it already has rather than replacing
      // it with "no history": the points on screen were true when they were
      // fetched, and one refused request does not make them false.
      setPoints((current) => (result === null && current !== null ? current : result));
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [code, range, title, attempt]);

  useEffect(() => {
    if (!title || !focused) return;
    const timer = setInterval(() => setAttempt((value) => value + 1), HISTORY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [title, focused]);

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

  const delta = points ? historyDelta(points) : null;
  const extent = points ? historyExtent(points) : null;
  const change = delta?.ratio ?? null;
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
            /* Two prices, one column, in the order they matter.
               The sell price is what this screen is for and it leads, with its
               caption ABOVE it rather than beneath — a figure whose label
               follows it has to be read twice. The buy price is the same quote
               at a smaller scale directly under it, so the pair reads as one
               thing. It used to be the big number with its label underneath
               and the buy price pushed out to the right of a spread, which put
               the two halves of one quote on two different axes. */
            <>
              <Body muted style={{ fontSize: type.small.fontSize, marginTop: spacing.sm }}>{tr.markets.sell}</Body>
              <Text selectable style={[type.amountMd, { color: palette.text }]}>
                {`${marketRateLabel(price.sellTry)} ₺`}
              </Text>
              <Body muted style={{ fontSize: type.small.fontSize, marginTop: spacing.sm }}>{tr.markets.buy}</Body>
              <Text selectable style={[type.amount, { color: palette.textSecondary }]}>
                {`${marketRateLabel(price.buyTry)} ₺`}
              </Text>
              <Body muted style={{ fontSize: type.small.fontSize, marginTop: spacing.md }}>
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
              {/* The figures belong UNDER the shape they describe. They sat
                  above it, so one answer took three glances: the range picker,
                  then a percentage, then the plot. The floor and ceiling come
                  first because they are what say whether today's price is
                  high; the move over the range comes last, in lira as well as
                  per cent, because a percentage alone does not say how much
                  money — 0,4% of a Cumhuriyet altını is not a rounding error. */}
              {extent ? (
                <Spread style={{ marginTop: spacing.md, alignItems: "flex-start" }}>
                  <View>
                    <Body muted style={{ fontSize: type.small.fontSize }}>{tr.markets.rangeLow}</Body>
                    <Text style={[type.amountSm, { color: palette.text }]}>{`${marketRateLabel(extent.low)} ₺`}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Body muted style={{ fontSize: type.small.fontSize }}>{tr.markets.rangeHigh}</Body>
                    <Text style={[type.amountSm, { color: palette.text }]}>{`${marketRateLabel(extent.high)} ₺`}</Text>
                  </View>
                </Spread>
              ) : null}
              <Spread style={{ marginTop: spacing.sm, alignItems: "center" }}>
                <Body muted style={{ fontSize: type.small.fontSize }}>
                  {tr.markets.rangeChange(tr.markets.range[range])}
                </Body>
                <Row gap={spacing.xs} style={{ alignItems: "center" }}>
                  {ChangeIcon ? <ChangeIcon accessible={false} size={14} color={changeColor} /> : null}
                  <Body style={{ color: changeColor }}>
                    {delta == null
                      ? tr.markets.unchanged
                      : `${delta.absoluteTry > 0 ? "+" : ""}${marketRateLabel(delta.absoluteTry)} ₺ · %${marketRateLabel(delta.ratio * 100)}`}
                  </Body>
                </Row>
              </Spread>
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
