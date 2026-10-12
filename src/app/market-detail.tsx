/**
 * One market instrument, with its past.
 *
 * The history is built from the same public order books as the live price, by
 * the same arithmetic (`domain/market.ts`), so the chart and the tile cannot
 * tell different stories. It is fetched on demand and never cached: a chart
 * that quietly shows last week's shape is worse than one that admits it has
 * nothing. It re-fetches while open, because the price above it moves on its
 * own; only the newest candle moves, at the same rate for every range, so one
 * cadence serves all.
 */

import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import TrendingDown from "lucide-react-native/icons/trending-down";
import TrendingUp from "lucide-react-native/icons/trending-up";
import type { LucideIcon } from "lucide-react-native";
import { INVESTMENT_MARKET_TITLES } from "../domain/investment-catalog";
import { historyDelta, historyExtent, type MarketHistoryPoint, type MarketRange } from "../domain/market";
import { fetchMarketHistory, useMarkets } from "../services/markets";
import { clockOrDateTimeLabel, marketRateLabel, tr } from "../i18n/tr";
import { Body, Button, Card, Label, Row, Screen, Segmented, Title } from "../ui/components";
import { ChartFrame, Lines, useSeriesColors } from "../ui/charts";
import { useScreenFocus } from "../ui/motion-primitives";
import { DelayedLoadingIndicator } from "../ui/loading-indicator";
import { radius, spacing, type, useTheme } from "../ui/theme";
import { WorkspaceGrid } from "../ui/workspace-layout";

const RANGES: readonly MarketRange[] = ["day", "week", "month", "year"];

/** Only the newest candle moves, at the same rate for every range, so one cadence serves all. */
const HISTORY_REFRESH_MS = 60_000;

const CLOCK_FORMAT = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });

/** Short enough that six labels fit across a 200px plot; a day knows its date from the picker, a year needs no day of month. */
function pointLabel(at: number, range: MarketRange): string {
  const when = new Date(at);
  if (range === "day") return CLOCK_FORMAT.format(when);
  const month = tr.months[when.getMonth()]?.slice(0, 3) ?? "";
  return range === "year"
    ? `${month} ${String(when.getFullYear()).slice(2)}`
    : `${when.getDate()} ${month}`;
}

/**
 * The three things a price chart leaves unanswered, as one block of figures.
 *
 * No bar: a bar beside a line chart is a second, weaker chart, and it read as
 * a picture of the change. The arrow is drawn on the card's own ground rather
 * than in a tinted pill, where `positive` on `positiveText` lacked contrast.
 */
function RangeSummary({
  low,
  high,
  current,
  changeLabel,
  delta,
  changeColor,
  ChangeIcon,
}: {
  low: number;
  high: number;
  current: number;
  changeLabel: string;
  /** Null when the period holds one quote, so there is no move to state. */
  delta: { absoluteTry: number; ratio: number } | null;
  changeColor: string;
  ChangeIcon: LucideIcon | null;
}) {
  const { palette } = useTheme();
  const percentText = delta == null ? tr.markets.unchanged : `%${marketRateLabel(delta.ratio * 100)}`;
  const absoluteText = delta == null
    ? null
    : `${delta.absoluteTry > 0 ? "+" : ""}${marketRateLabel(delta.absoluteTry)} ₺`;
  const figures: [label: string, value: number, tone: string][] = [
    [tr.markets.rangeLow, low, palette.text],
    [tr.markets.rangeNow, current, changeColor],
    [tr.markets.rangeHigh, high, palette.text],
  ];
  return (
    <View
      style={{
        marginTop: spacing.md,
        backgroundColor: palette.surfaceAlt,
        borderRadius: radius.md,
        overflow: "hidden",
      }}
    >
      <View style={{ padding: spacing.md }}>
        <Body muted style={{ fontSize: type.caption.fontSize, letterSpacing: 0.6, textTransform: "uppercase" }}>
          {changeLabel}
        </Body>
        <Row gap={spacing.xs} style={{ alignItems: "center", marginTop: 2 }}>
          {ChangeIcon ? <ChangeIcon accessible={false} size={CHANGE_ARROW} color={changeColor} strokeWidth={2.5} /> : null}
          {/* Between `amount` and the 30pt price hero: the move leads this card, not the screen. */}
          <Text selectable style={[type.moneyInput, { color: changeColor }]}>{percentText}</Text>
        </Row>
        {absoluteText ? (
          <Text selectable style={[type.amountSm, { color: palette.textSecondary, marginTop: 2 }]}>
            {absoluteText}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }}>
        {figures.map(([label, value, tone], index) => (
          <View
            key={label}
            style={{
              flex: 1,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              // Rules BETWEEN the figures only. A rule on the outside would
              // draw a box inside a card that already has one.
              borderLeftWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
              borderLeftColor: palette.border,
            }}
          >
            <Body muted style={{ fontSize: type.caption.fontSize }}>{label}</Body>
            <Text selectable style={[type.amountSm, { color: tone, marginTop: 1 }]}>
              {`${marketRateLabel(value)} ₺`}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const CHANGE_ARROW = 22;

export default function MarketDetailScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = typeof params.code === "string" ? params.code : "";
  const title = INVESTMENT_MARKET_TITLES.find((item) => item.code === code);
  const price = useMarkets((state) => state.prices[code]);
  // A chart failure is usually the feed's failure; without this it reads as a chart bug.
  const feedLive = useMarkets((state) => state.status === "live");
  const { palette } = useTheme();
  const colors = useSeriesColors();

  const [range, setRange] = useState<MarketRange>("month");
  // Keyed by what it was fetched for: a series of another range is not this range's chart.
  const key = `${code}:${range}`;
  const [fetched, setFetched] = useState<{ key: string; points: MarketHistoryPoint[] | null } | null>(null);
  const points = fetched?.key === key ? fetched.points : null;
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  // A chart nobody is looking at must not fetch.
  const focused = useScreenFocus();

  useEffect(() => {
    if (!title) return;
    let live = true;
    // The spinner belongs to an empty chart, not to a refresh.
    setFetched((current) => {
      if (current?.key !== key || current.points === null) setLoading(true);
      return current;
    });
    void fetchMarketHistory(code, range).then((result) => {
      if (!live) return;
      // A failed refresh keeps the points already shown for this range: they were true when fetched.
      setFetched((current) => (result === null && current?.key === key && current.points !== null ? current : { key, points: result }));
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [code, range, key, title, attempt]);

  useEffect(() => {
    if (!title || !focused) return;
    const timer = setInterval(() => setAttempt((value) => value + 1), HISTORY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [title, focused]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  // A code naming no instrument is a hand-edited URL.
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
        {/* The live price is what this screen is for, so it is the figure and not a row in a list. */}
        <Card>
          <Label>{title.label}</Label>
          {price ? (
            /* The sell price leads, caption above it (a label that follows a figure is read twice); the buy price sits smaller beneath so the pair reads as one quote. */
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
              {feedLive ? null : (
                <Row gap={spacing.xs} style={{ alignItems: "center", marginTop: spacing.xs }}>
                  <View
                    accessible={false}
                    style={{ width: 7, height: 7, borderRadius: radius.full, backgroundColor: palette.textSecondary }}
                  />
                  <Body muted style={{ fontSize: type.small.fontSize, flexShrink: 1 }}>
                    {tr.markets.snapshotNote}
                  </Body>
                </Row>
              )}
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
              <Body muted style={{ textAlign: "center" }}>
                {feedLive ? tr.markets.historyUnavailable : tr.markets.historyFeedDown}
              </Body>
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
                      // Minor units, so axis and readout format prices like the ledger formats money.
                      points: points.map((point) => Math.round(point.valueTry * 100)),
                    }]}
                  />
                )}
              </ChartFrame>
              {/* The figures belong under the shape they describe. */}
              {extent ? (
                <RangeSummary
                  low={extent.low}
                  high={extent.high}
                  current={points[points.length - 1]?.valueTry ?? extent.high}
                  changeLabel={tr.markets.rangeChange(tr.markets.range[range])}
                  delta={delta}
                  changeColor={changeColor}
                  ChangeIcon={ChangeIcon}
                />
              ) : null}
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
