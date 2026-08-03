/** Accessible SVG chart primitives shared by native and web. */

import React from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Path, Rect, Line as SvgLine, Text as SvgText } from "react-native-svg";
import type { Distribution } from "../domain/analytics";
import { formatMinorCompact } from "../domain/money";
import { tr } from "../i18n/tr";
import { resolveBarAxis } from "./chart-axis";
import { chart, font, radius, spacing, type, useTheme } from "./theme";

type SeriesColors = readonly [string, string, string, string, string, string, string, string];

/**
 * Ordered fills for CATEGORICAL series (distribution slices, stacked bars),
 * where a colour identifies a category and carries no judgement about it.
 *
 * Category colours come only from the brand families and neutral ramp.
 * Financial green/red remain reserved for direction and state, so a grocery
 * slice can never accidentally look like success or danger.
 */
export function useSeriesColors(): SeriesColors {
  const { palette } = useTheme();
  return [
    palette.primary,
    palette.secondary,
    palette.surfaceStrong,
    palette.tertiary,
    palette.primaryStrong,
    palette.secondaryStrong,
    palette.tertiaryStrong,
    palette.textSecondary,
  ];
}

function seriesColor(colors: SeriesColors, index: number): string {
  return colors[index % colors.length] ?? colors[0];
}

interface DonutSlice {
  label: string;
  valueMinor: number;
  color: string;
}

export function distributionDonutData(
  distribution: Distribution,
  colors: SeriesColors,
  categoryName: (id: string) => string,
): { slices: DonutSlice[]; supplementalSlices: DonutSlice[]; totalMinor: number } {
  const rows = [...distribution.expenseByCategory]
    .map(([id, valueMinor]) => ({ label: categoryName(id), valueMinor }))
    .concat(distribution.uncategorizedExpenseMinor === 0
      ? []
      : [{ label: tr.common.none, valueMinor: distribution.uncategorizedExpenseMinor }])
    .sort((a, b) => b.valueMinor - a.valueMinor);
  const positive = rows.filter((row) => row.valueMinor > 0);
  const remainder = positive.slice(7).reduce((sum, row) => sum + row.valueMinor, 0);
  return {
    slices: [
      ...positive.slice(0, 7).map((row, index) => ({ ...row, color: seriesColor(colors, index) })),
      ...(remainder > 0 ? [{ label: tr.common.other, valueMinor: remainder, color: colors[7] }] : []),
      ...(distribution.transferTotalMinor > 0
        ? [{ label: tr.dashboard.investmentAside, valueMinor: distribution.transferTotalMinor, color: colors[4] }]
        : []),
    ],
    supplementalSlices: [
      ...rows.filter((row) => row.valueMinor < 0).map((row) => ({
        label: tr.dashboard.refundAside(row.label),
        valueMinor: row.valueMinor,
        color: colors[1],
      })),
      ...(distribution.transferTotalMinor < 0
        ? [{ label: tr.dashboard.investmentRefundAside, valueMinor: distribution.transferTotalMinor, color: colors[1] }]
        : []),
    ],
    totalMinor: distribution.expenseTotalMinor + distribution.transferTotalMinor,
  };
}

/**
 * Donut with 2px surface gaps and a paired legend. Supplemental rows share the
 * exact legend hierarchy but are excluded from the arcs, total and percentages
 * (for example signed refund rows that cannot form negative arc geometry).
 */
export function Donut({
  slices,
  supplementalSlices = [],
  totalMinor,
  size = 168,
}: {
  slices: DonutSlice[];
  supplementalSlices?: DonutSlice[];
  /** Optional net total shown in the center. Arc geometry still uses positive
   *  slices, allowing negative refund rows to remain supplemental. */
  totalMinor?: number;
  size?: number;
}) {
  const { palette } = useTheme();
  const arcTotal = slices.reduce((sum, s) => sum + Math.max(s.valueMinor, 0), 0);
  const displayTotal = totalMinor ?? arcTotal;
  const largest = slices.reduce<DonutSlice | null>(
    (current, slice) => slice.valueMinor > 0 && (!current || slice.valueMinor > current.valueMinor) ? slice : current,
    null,
  );
  const largestPercent = largest && arcTotal > 0 ? Math.round((largest.valueMinor / arcTotal) * 100) : 0;
  const r = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = chart.donutWidth;

  const arcs: (DonutSlice & { path: string; sweep: number; end: number })[] = [];
  let start = -90;
  for (const slice of slices) {
    if (slice.valueMinor <= 0) continue;
    const sweep = arcTotal > 0 ? (slice.valueMinor / arcTotal) * 360 : 0;
    const end = start + sweep;
    arcs.push({ ...slice, path: describeArc(cx, cy, r, start, end), sweep, end });
    start = end;
  }
  const chartSummary = tr.a11y.donutChart(
    formatMinorCompact(displayTotal),
    [...slices, ...supplementalSlices]
      .map((slice) => `${slice.label}: ${formatMinorCompact(slice.valueMinor)}`)
      .join(", "),
  );

  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.lg, flexWrap: "wrap" }}>
      <View accessible accessibilityRole="image" accessibilityLabel={chartSummary}>
        <Svg accessible={false} width={size} height={size}>
          <Circle
            cx={cx}
            cy={cy}
            r={r}
            stroke={palette.surfaceAlt}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {arcs.map((a, i) =>
            a.sweep >= 359.9 ? (
              <Circle key={i} cx={cx} cy={cy} r={r} stroke={a.color} strokeWidth={strokeWidth} fill="none" />
            ) : (
              <Path
                key={i}
                d={a.path}
                stroke={a.color}
                strokeWidth={strokeWidth}
                fill="none"
                strokeLinecap="butt"
              />
            ),
          )}
          {/* 2px surface gaps between segments */}
          {arcs.length > 1
            ? arcs.map((arc, i) => {
                const p1 = polar(cx, cy, r - strokeWidth / 2 - 1, arc.end);
                const p2 = polar(cx, cy, r + strokeWidth / 2 + 1, arc.end);
                return <SvgLine key={`gap-${i}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={palette.surface} strokeWidth={2} />;
              })
            : null}
          <SvgText x={cx} y={cy - 7} textAnchor="middle" fontFamily={font.semibold} fontSize={9} fontWeight="600" fill={palette.textSecondary}>
            {tr.analysis.chartTotal.toLocaleUpperCase("tr-TR")}
          </SvgText>
          <SvgText x={cx} y={cy + 10} textAnchor="middle" fontSize={13} fontWeight="600" fill={palette.text}>
            {formatMinorCompact(displayTotal)}
          </SvgText>
        </Svg>
      </View>
      {/* Paired legend list: identity never color-alone (relief rule) */}
      <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 220, minWidth: 160, maxWidth: 420, gap: 6 }}>
        {largest ? (
          <View
            style={{
              alignSelf: "stretch",
              paddingHorizontal: spacing.sm,
              paddingVertical: 7,
              borderRadius: radius.sm,
              backgroundColor: palette.surfaceAlt,
              borderWidth: 1,
              borderColor: palette.border + "70",
              marginBottom: 2,
            }}
          >
            <Text style={[type.small, { color: palette.text, fontFamily: font.semibold }]}>
              {tr.analysis.chartLargestShare(largest.label, largestPercent)}
            </Text>
          </View>
        ) : null}
        {[...slices, ...supplementalSlices].map((s, i) => {
          const supplemental = i >= slices.length;
          const share = !supplemental && arcTotal > 0 ? Math.round((s.valueMinor / arcTotal) * 100) : 0;
          return (
            // The share rule needs its own air: at a 3px gap under a 3px bar it
            // read as an underline on the label rather than as a track beside
            // the donut it belongs to.
            <View key={`${s.label}-${i}`} style={{ gap: 6, marginBottom: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: s.color }} />
                <Text style={[type.small, { color: palette.text, flex: 1 }]}>{s.label}</Text>
                <Text
                  style={[type.small, { color: palette.textSecondary, fontVariant: ["tabular-nums"] }]}
                >
                  {supplemental
                    ? formatMinorCompact(s.valueMinor)
                    : `${arcTotal > 0 ? `%${share}` : ""} · ${formatMinorCompact(s.valueMinor)}`}
                </Text>
              </View>
              {!supplemental ? (
                <View style={{ marginLeft: 17, height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: palette.surfaceAlt }}>
                  <View style={{ width: `${share}%`, height: "100%", borderRadius: 2, backgroundColor: s.color }} />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

interface LineSeries {
  label: string;
  color: string;
  /** One value per x slot (minor units); null = missing. */
  points: (number | null)[];
}

/**
 * Turn a run of points into a smooth path.
 *
 * A polyline of monthly figures is a zig-zag, and the eye spends its effort on
 * the corners instead of the trend. This is Catmull-Rom converted to cubic
 * Bézier: each segment's control points come from its neighbours, so the curve
 * passes through every real value — it smooths the join, never the number.
 *
 * The control points are then clamped into their own segment's range. Without
 * that the curve overshoots after a flat run: a category with nothing until
 * June and a spike in July was drawn dipping BELOW ZERO in May, inventing a
 * month of income out of the interpolation. A chart of money may round a
 * corner; it may not draw a value that never existed.
 */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0]!.x},${points[0]!.y}`;
  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const lo = Math.min(p1.y, p2.y);
    const hi = Math.max(p1.y, p2.y);
    const clamp = (value: number) => Math.min(hi, Math.max(lo, value));
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = clamp(p1.y + (p2.y - p0.y) / 6);
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = clamp(p2.y - (p3.y - p1.y) / 6);
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

/** Contiguous runs of real values; a null breaks the line rather than bridging it. */
function segmentsOf(points: (number | null)[]): number[][] {
  const runs: number[][] = [];
  let run: number[] = [];
  points.forEach((value, index) => {
    if (value == null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push(index);
    }
  });
  if (run.length) runs.push(run);
  return runs;
}

/**
 * Multi-series line chart on a ruled field.
 *
 * The line used to float on the card's own surface with a single rule under it,
 * which made a value impossible to place: there was nothing to read a height
 * against. The plot is now its own tinted panel ruled both ways — squared
 * paper — with the value axis labelled down the left and the zero line the one
 * rule drawn at full strength.
 */
export function Lines({
  series,
  xLabels,
  height = 200,
  width = 320,
}: {
  series: LineSeries[];
  xLabels: string[];
  height?: number;
  width?: number;
}) {
  const { palette } = useTheme();
  // No right gutter: the only caller draws one series whose name is already the
  // card's heading, so an end label repeated it and cost a sixth of the plot.
  const padding = { left: 54, right: 12, top: 12, bottom: 24 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const values = series.flatMap((s) => s.points.filter((p): p is number => p != null));
  if (values.length === 0) return null;
  const min = Math.min(0, ...values);
  const max = Math.max(...values, 1);
  const x = (i: number) => padding.left + (xLabels.length <= 1 ? plotW / 2 : (i / (xLabels.length - 1)) * plotW);
  const y = (v: number) => padding.top + plotH - ((v - min) / (max - min)) * plotH;
  const chartSummary = tr.a11y.lineChart(series.map((item) => {
    const itemValues = item.points
      .map((point, index) => point == null ? null : `${xLabels[index] ?? index + 1}: ${formatMinorCompact(point)}`)
      .filter((point): point is string => point != null)
      .join(", ");
    return `${item.label}: ${itemValues}`;
  }).join(". "));

  // Five rules divide the range into quarters — enough to judge a height
  // against, few enough that the labels never touch at this size.
  const TICKS = 5;
  const ticks = Array.from({ length: TICKS }, (_, i) => max - ((max - min) / (TICKS - 1)) * i);

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={chartSummary}>
      <Svg accessible={false} width={width} height={height}>
        <Rect
          x={padding.left}
          y={padding.top}
          width={plotW}
          height={plotH}
          rx={radius.sm}
          fill={palette.surfaceAlt}
        />
        {ticks.map((value) => (
          <React.Fragment key={`h${value}`}>
            <SvgLine
              x1={padding.left}
              y1={y(value)}
              x2={padding.left + plotW}
              y2={y(value)}
              stroke={palette.border}
              strokeWidth={1}
              opacity={Math.abs(value) < 1 ? chart.baselineOpacity : chart.gridOpacity}
            />
            <SvgText
              x={padding.left - 8}
              y={y(value) + 3}
              fontSize={9}
              fill={palette.textSecondary}
              textAnchor="end"
            >
              {formatMinorCompact(Math.round(value))}
            </SvgText>
          </React.Fragment>
        ))}
        {xLabels.map((_, i) => (
          <SvgLine
            key={`v${i}`}
            x1={x(i)}
            y1={padding.top}
            x2={x(i)}
            y2={padding.top + plotH}
            stroke={palette.border}
            strokeWidth={1}
            opacity={chart.gridOpacity - 0.06}
          />
        ))}
        {series.map((s) => {
          const runs = segmentsOf(s.points);
          const lastIdx = s.points.reduce<number>((acc, p, i) => (p != null ? i : acc), -1);
          return (
            <React.Fragment key={s.label}>
              {runs.map((run) => {
                const pts = run.map((i) => ({ x: x(i), y: y(s.points[i]!) }));
                const line = smoothPath(pts);
                // The fill closes the same curve down to the zero rule, so the
                // area and the line can never disagree about where a month sat.
                const area = `${line} L${pts.at(-1)!.x},${y(0)} L${pts[0]!.x},${y(0)} Z`;
                return (
                  <React.Fragment key={run[0]}>
                    <Path d={area} fill={s.color} opacity={0.12} />
                    <Path d={line} stroke={s.color} strokeWidth={chart.lineWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </React.Fragment>
                );
              })}
              {lastIdx >= 0 ? (
                <Circle cx={x(lastIdx)} cy={y(s.points[lastIdx]!)} r={chart.markerRadius} fill={s.color} stroke={palette.surface} strokeWidth={2} />
              ) : null}
            </React.Fragment>
          );
        })}
        {xLabels.map((l, i) =>
          xLabels.length <= 6 || i % Math.ceil(xLabels.length / 6) === 0 ? (
            <SvgText key={`x${i}`} x={x(i)} y={height - 6} fontSize={9} fill={palette.textSecondary} textAnchor="middle">
              {l}
            </SvgText>
          ) : null,
        )}
      </Svg>
    </View>
  );
}

interface BarGroup {
  label: string;
  /** One value per series (minor units); null/0 renders no bar. */
  values: (number | null)[];
}

/** Axis labels communicate scale, not ledger precision. Keep the exact amount
 * in the value strip and use Turkish compact notation where a full TRY figure
 * would be clipped into a row of zeroes. */
function formatChartAxis(valueMinor: number): string {
  const major = valueMinor / 100;
  const compact = Math.abs(major) >= 1_000;
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    notation: compact ? "compact" : "standard",
    minimumFractionDigits: 0,
    maximumFractionDigits: compact ? 1 : Math.abs(major) < 10 ? 2 : 0,
  }).format(major);
}

/** Bar geometry with square baseline corners and rounded data-end corners. */
function barShape(x: number, top: number, width: number, height: number, positive: boolean): string {
  const bottom = top + height;
  const curve = Math.min(4, width / 2, height / 2);
  if (positive) {
    return [
      `M${x},${bottom}`,
      `L${x},${top + curve}`,
      `Q${x},${top} ${x + curve},${top}`,
      `H${x + width - curve}`,
      `Q${x + width},${top} ${x + width},${top + curve}`,
      `V${bottom}`,
      "Z",
    ].join(" ");
  }
  return [
    `M${x},${top}`,
    `H${x + width}`,
    `V${bottom - curve}`,
    `Q${x + width},${bottom} ${x + width - curve},${bottom}`,
    `H${x + curve}`,
    `Q${x},${bottom} ${x},${bottom - curve}`,
    `V${top}`,
    "Z",
  ].join(" ");
}

/**
 * Grouped vertical bars — one cluster per x slot, one bar per series. Signed
 * values dip below a shared zero line.
 *
 * Exact amounts do not sit inside the SVG. Those labels used to hang above
 * each bar on leader lines: passable for one month, but cramped at three and
 * unreadable under Dynamic Type. The plot now uses a rounded monetary ruler
 * for comparison, while short ranges get a real-text ledger directly below
 * it. The colour rule and series name bind each figure to its bar without
 * relying on colour alone.
 */
export function Bars({
  groups,
  series,
  height = 190,
  width = 320,
}: {
  groups: BarGroup[];
  series: { label: string; color: string }[];
  height?: number;
  width?: number;
}) {
  const { palette } = useTheme();
  const axis = resolveBarAxis(groups.flatMap((g) => g.values));
  if (!axis || groups.length === 0) return null;
  const { min, max, ticks } = axis;
  const span = Math.max(axis.step, max - min);
  const axisFontSize = width >= 480 ? 11 : 10;
  const pad = { left: width >= 480 ? 64 : 58, right: 10, top: 14, bottom: 28 };
  const plotW = Math.max(1, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const groupW = plotW / groups.length;
  const barGap = 2;
  const nSeries = Math.max(series.length, 1);
  // A one-month chart can be 1000px wide on desktop. Let the ruled plot use
  // that space, but do not turn three data marks into billboard-sized blocks.
  const clusterW = Math.min(groupW * 0.68, nSeries * 108 + barGap * (nSeries - 1));
  const barW = Math.max(3, (clusterW - barGap * (nSeries - 1)) / nSeries);
  const y = (v: number) => pad.top + plotH - ((v - min) / span) * plotH;
  const zeroY = y(0);
  const everyN = groups.length <= 6 ? 1 : Math.ceil(groups.length / 6);
  const visibleValueCount = groups.reduce(
    (count, group) => count + group.values.filter((value) => value != null && value !== 0).length,
    0,
  );
  const showValueLedger = groups.length <= 3 && visibleValueCount <= 9;
  const chartSummary = tr.a11y.barChart(groups.map((group) => {
    const groupValues = group.values.map((value, index) =>
      `${series[index]?.label ?? index + 1}: ${formatMinorCompact(value ?? 0)}`,
    ).join(", ");
    return `${group.label}: ${groupValues}`;
  }).join(". "));

  return (
    <View>
      <View accessible accessibilityRole="image" accessibilityLabel={chartSummary}>
        <Svg accessible={false} width={width} height={height}>
          <Rect
            x={pad.left}
            y={pad.top}
            width={plotW}
            height={plotH}
            rx={chart.barRadius}
            fill={palette.surfaceAlt}
          />
          {ticks.map((value) => (
            <React.Fragment key={`tick-${value}`}>
              <SvgLine
                x1={pad.left}
                y1={y(value)}
                x2={pad.left + plotW}
                y2={y(value)}
                stroke={palette.border}
                strokeWidth={Math.abs(value) < 1 ? 1.5 : 1}
                opacity={Math.abs(value) < 1 ? chart.baselineOpacity : chart.gridOpacity + 0.04}
                strokeDasharray={Math.abs(value) < 1 ? undefined : "3 5"}
              />
              <SvgText
                testID="bar-axis-label"
                x={pad.left - 8}
                y={y(value) + axisFontSize * 0.36}
                fontFamily={font.semibold}
                fontSize={axisFontSize}
                fill={palette.textSecondary}
                textAnchor="end"
              >
                {formatChartAxis(value)}
              </SvgText>
            </React.Fragment>
          ))}
          {groups.map((g, gi) => {
            const gx = pad.left + gi * groupW + (groupW - clusterW) / 2;
            return g.values.map((v, si) => {
              if (v == null || v === 0) return null;
              const top = v > 0 ? y(v) : zeroY;
              const h = Math.abs(y(v) - zeroY);
              const bx = gx + si * (barW + barGap);
              const color = series[si]?.color ?? palette.primary;
              return (
                <React.Fragment key={`${gi}-${si}`}>
                  <Path d={barShape(bx, top, barW, Math.max(1, h), v > 0)} fill={color} />
                </React.Fragment>
              );
            });
          })}
          {groups.map((g, gi) =>
            gi % everyN === 0 ? (
              <SvgText key={`l-${gi}`} x={pad.left + gi * groupW + groupW / 2} y={height - 7} fontSize={11} fontWeight="600" fill={palette.textSecondary} textAnchor="middle">
                {g.label}
              </SvgText>
            ) : null,
          )}
        </Svg>
      </View>
      {showValueLedger ? (
        <View
          style={{
            width,
            flexDirection: "row",
            borderTopWidth: 1,
            borderColor: palette.border,
            marginTop: spacing.sm,
          }}
        >
          {groups.map((group, groupIndex) => (
            <View
              key={`values-${group.label}`}
              style={{
                flex: 1,
                minWidth: 0,
                gap: spacing.sm,
                paddingTop: spacing.sm,
                paddingHorizontal: spacing.sm,
                borderLeftWidth: groupIndex === 0 ? 0 : 1,
                borderColor: palette.border,
              }}
            >
              <Text
                style={[
                  type.small,
                  {
                    color: palette.textSecondary,
                    fontFamily: font.semibold,
                    textAlign: groups.length === 1 ? "left" : "center",
                  },
                ]}
              >
                {group.label}
              </Text>
              <View
                style={{
                  flexDirection: groups.length === 1 ? "row" : "column",
                  flexWrap: "wrap",
                  gap: spacing.sm,
                }}
              >
                {group.values.map((value, seriesIndex) => {
                  if (value == null) return null;
                  const item = series[seriesIndex];
                  return (
                    <View
                      key={`${group.label}-${item?.label ?? seriesIndex}`}
                      style={{
                        flexGrow: groups.length === 1 ? 1 : 0,
                        flexBasis: groups.length === 1 ? 120 : "auto",
                        minWidth: 0,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 7,
                      }}
                    >
                      <View
                        accessible={false}
                        style={{
                          width: 3,
                          alignSelf: "stretch",
                          minHeight: 30,
                          borderRadius: 2,
                          backgroundColor: item?.color ?? palette.primary,
                        }}
                      />
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <Text style={[type.small, { color: palette.textSecondary }]}>
                          {item?.label ?? seriesIndex + 1}
                        </Text>
                        <Text
                          selectable
                          testID="bar-value-label"
                          style={[
                            type.amount,
                            {
                              color: palette.text,
                              fontSize: width >= 480 ? 15 : 14,
                            },
                          ]}
                        >
                          {formatMinorCompact(value)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      ) : series.length > 1 ? (
        <View style={{ flexDirection: "row", gap: spacing.md, justifyContent: "center", marginTop: 2 }}>
          {series.map((s) => (
            <View key={s.label} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: s.color }} />
              <Text style={[type.small, { color: palette.textSecondary }]}>{s.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}
