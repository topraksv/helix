/** Accessible SVG chart primitives shared by native and web. */

import React, { type ReactNode } from "react";
import { Animated, Text, View } from "react-native";
import Svg, { Circle, ClipPath, Defs, Path, Rect, Line as SvgLine, Text as SvgText } from "react-native-svg";
import type { Distribution } from "../domain/analytics";
import { compactMoneyScale, formatMinorCompact, formatMinorCompactAtScale, type CompactMoneyScale, usesCompactMoneyScale } from "../domain/money";
import { tr } from "../i18n/tr";
import { resolveBarAxis } from "./chart-axis";
import { Amount } from "./primitives";
import { useDrawIn } from "./motion-primitives";
import { chart, font, motion, radius, spacing, type, useTheme } from "./theme";
import { useMeasuredWidth } from "./viewport";

/**
 * A chart draws itself in once.
 *
 * The marks are revealed; the axes, the ruled plot and every label are not,
 * because those are the frame the data is read against and a frame that grows
 * is just movement. `strokeDashoffset` and a clip rectangle are geometry, not
 * transform, so these cannot use the native driver — one animated element per
 * chart keeps that affordable.
 */
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Length of a polyline through the given points, for a dash-based reveal. */
function polylineLength(points: { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  // A smoothed curve is a little longer than the straight run between its
  // points; overshooting the dash length only means the reveal finishes early,
  // while undershooting would leave a permanent gap.
  return total * 1.25 + 1;
}

/**
 * The box a pixel-sized chart is drawn into.
 *
 * `Bars` and `Lines` need a number, and every caller used to compute one from
 * the window: `Math.min(width - spacing.lg * 4, 1040)`. That expression encodes
 * a guess about how much chrome sits between the window and the chart, and the
 * guess broke the moment a 220px rail and a second column appeared — at a
 * 1024px window it asked for 928px inside a card that had 740, which is a
 * horizontal scrollbar on a screen that should not have one.
 *
 * So the frame measures itself and hands the chart the width it really has.
 */
export function ChartFrame({
  children,
  min = 240,
  max = 1040,
}: {
  children: (width: number) => ReactNode;
  min?: number;
  max?: number;
}) {
  // Falls back to the floor, never the ceiling: growing into the measurement
  // costs one frame, starting above it overflows the container for that frame.
  const [measured, onLayout] = useMeasuredWidth(min);
  return (
    <View onLayout={onLayout} style={{ width: "100%" }}>
      {children(Math.max(min, Math.min(measured, max)))}
    </View>
  );
}

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

/** The legend's preferred column: one category name beside its share. */
const LEGEND_BASIS = 220;
/** Below this the ring stops being readable, so the pair wraps instead. */
const MIN_PAIRED_RING = 140;

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
  // The caller's `size` is a ceiling, not a demand. A ring and its legend read
  // as one chart only while they sit side by side, and the box they sit in is
  // no longer the screen: paired into a dashboard column the row had 471px for
  // a 236 ring, a 16 gap and a 220 legend, so the legend dropped underneath a
  // centred ring and the card grew a wasted band on both sides of it. Below the
  // point where shrinking the ring would make it unreadable, wrapping is the
  // right answer and the caller's size stands — which is every phone.
  const [boxWidth, onBoxLayout] = useMeasuredWidth(size + LEGEND_BASIS + spacing.lg);
  const ringBudget = boxWidth - LEGEND_BASIS - spacing.lg - 2;
  const sideBySide = ringBudget >= MIN_PAIRED_RING;
  const fittedSize = sideBySide ? Math.min(size, ringBudget) : size;
  const arcTotal = slices.reduce((sum, s) => sum + Math.max(s.valueMinor, 0), 0);
  const displayTotal = totalMinor ?? arcTotal;
  const largest = slices.reduce<DonutSlice | null>(
    (current, slice) => slice.valueMinor > 0 && (!current || slice.valueMinor > current.valueMinor) ? slice : current,
    null,
  );
  const largestPercent = largest && arcTotal > 0 ? Math.round((largest.valueMinor / arcTotal) * 100) : 0;
  const r = fittedSize / 2 - 14;
  const cx = fittedSize / 2;
  const cy = fittedSize / 2;
  const strokeWidth = chart.donutWidth;
  const circumference = 2 * Math.PI * r;
  // Redrawn whenever the arcs themselves change — a different period, a
  // different filter, an edited amount. Without a token the reveal was a
  // first-render-only affair and every later answer replaced the previous
  // picture in a single frame.
  const draw = useDrawIn(true, motion.draw, slices.map((s) => `${s.label}:${s.valueMinor}`).join("|"));

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
    // Side by side the two halves span the row, so a wide card reads as one
    // chart rather than a centred island with a margin on each side. Wrapped —
    // every phone — the ring centres over its legend as before.
    <View
      onLayout={onBoxLayout}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: sideBySide ? "flex-start" : "center",
        gap: spacing.lg,
        flexWrap: "wrap",
      }}
    >
      <View accessible accessibilityRole="image" accessibilityLabel={chartSummary}>
        <Svg accessible={false} width={fittedSize} height={fittedSize}>
          <Circle
            cx={cx}
            cy={cy}
            r={r}
            stroke={palette.surfaceAlt}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {arcs.map((a, i) => {
            if (a.sweep >= 359.9) {
              // A ring that is one category is still a ring being drawn. This
              // used to be a plain circle, so the single-category case — which
              // is every new account, and any month with one dominant
              // category — was the one donut in the app that simply appeared.
              return (
                <AnimatedCircle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={r}
                  stroke={a.color}
                  strokeWidth={strokeWidth}
                  fill="none"
                  strokeDasharray={[circumference, circumference]}
                  strokeDashoffset={draw.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] })}
                />
              );
            }
            const arcLength = (a.sweep / 360) * circumference;
            return (
              <AnimatedPath
                key={i}
                d={a.path}
                stroke={a.color}
                strokeWidth={strokeWidth}
                fill="none"
                strokeLinecap="butt"
                strokeDasharray={[arcLength, circumference]}
                strokeDashoffset={draw.interpolate({ inputRange: [0, 1], outputRange: [arcLength, 0] })}
              />
            );
          })}
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
      <View
        style={{
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: LEGEND_BASIS,
          minWidth: 160,
          // Beside the ring the legend takes the rest of the row: its rows are
          // a name on the left and a share on the right, which is the same
          // anatomy every list in the app uses at full width. Capped only when
          // it has wrapped underneath, where a full-width block of legend under
          // a centred ring would read as a second list.
          maxWidth: sideBySide ? undefined : 420,
          gap: 6,
        }}
      >
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
  const draw = useDrawIn(true, motion.draw, series.map((s) => `${s.label}:${s.points.join(",")}`).join("|"));
  const clipId = `line-reveal-${React.useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const values = series.flatMap((s) => s.points.filter((p): p is number => p != null));
  if (values.length === 0) return null;
  const min = Math.min(0, ...values);
  const max = Math.max(...values, 1);
  // One chart is one ruler. Including the rounded ticks prevents a value just
  // below the compact threshold from producing a rounded million tick in the
  // long exact format.
  const TICKS = 5;
  const ticks = Array.from({ length: TICKS }, (_, i) => max - ((max - min) / (TICKS - 1)) * i);
  const axisScale = chartAxisScale([...values, ...ticks]);
  const padding = { left: chartAxisLabelGutter(ticks, 9, 54, axisScale), right: 12, top: 12, bottom: 24 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const x = (i: number) => padding.left + (xLabels.length <= 1 ? plotW / 2 : (i / (xLabels.length - 1)) * plotW);
  const y = (v: number) => padding.top + plotH - ((v - min) / (max - min)) * plotH;
  const chartSummary = tr.a11y.lineChart(series.map((item) => {
    const itemValues = item.points
      .map((point, index) => point == null ? null : `${xLabels[index] ?? index + 1}: ${formatMinorCompact(point)}`)
      .filter((point): point is string => point != null)
      .join(", ");
    return `${item.label}: ${itemValues}`;
  }).join(". "));

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={chartSummary}>
      <Svg accessible={false} width={width} height={height}>
        <Defs>
          <ClipPath id={clipId}>
            <AnimatedRect
              x={padding.left}
              y={0}
              height={height}
              width={draw.interpolate({ inputRange: [0, 1], outputRange: [0, plotW] })}
            />
          </ClipPath>
        </Defs>
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
              {formatChartAxis(Math.round(value), axisScale)}
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
                const length = polylineLength(pts);
                return (
                  <React.Fragment key={run[0]}>
                    <Path d={area} fill={s.color} opacity={0.12} clipPath={`url(#${clipId})`} />
                    <AnimatedPath
                      d={line}
                      stroke={s.color}
                      strokeWidth={chart.lineWidth}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={[length, length]}
                      strokeDashoffset={draw.interpolate({ inputRange: [0, 1], outputRange: [length, 0] })}
                    />
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

/** Axis labels communicate scale, not ledger precision. Keep the shared money
 * formatter in the value strip and use the app's own Mn/Mr/Tr vocabulary on a
 * large chart. */
export type ChartAxisScale = "full" | CompactMoneyScale;

export function chartAxisScale(values: readonly (number | null)[]): ChartAxisScale {
  const largestMinor = values.reduce<number>(
    (largest, value) => value == null || !Number.isFinite(value) ? largest : Math.max(largest, Math.abs(value)),
    0,
  );
  const roundedLargestMinor = Math.round(largestMinor);
  return usesCompactMoneyScale(roundedLargestMinor) ? compactMoneyScale(roundedLargestMinor) : "full";
}

export function formatChartAxis(valueMinor: number, scale: ChartAxisScale = "full"): string {
  const roundedMinor = Math.round(valueMinor);
  return scale === "full"
    ? formatMinorCompact(roundedMinor)
    : formatMinorCompactAtScale(roundedMinor, scale);
}

/**
 * Reserve the real ink width of the longest ruler label before drawing the
 * plot. A fixed 58/64px gutter was enough for ordinary figures, but a signed
 * billion label is wider than that and SVG clips text that starts outside its
 * viewBox. Inter's measured numeric advance is roughly 0.6–0.7em; the
 * conservative 0.72em ceiling keeps the first and last glyph inside on both
 * the web font and the native face without giving the axis a permanent empty
 * desktop rail.
 */
function chartAxisLabelGutter(values: number[], fontSize: number, minimum: number, scale: ChartAxisScale): number {
  const longest = values.reduce((width, value) => Math.max(width, formatChartAxis(value, scale).length), 0);
  return Math.ceil(Math.max(minimum, longest * fontSize * 0.72 + 12));
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
 * Full-precision amounts do not sit inside the SVG. Those labels used to hang above
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
  const draw = useDrawIn(true, motion.draw, groups.map((g) => `${g.label}:${g.values.join(",")}`).join("|"));
  const clipId = `bar-reveal-${React.useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const axis = resolveBarAxis(groups.flatMap((g) => g.values));
  if (!axis || groups.length === 0) return null;
  const { min, max, ticks } = axis;
  const span = Math.max(axis.step, max - min);
  const axisFontSize = width >= 480 ? 11 : 10;
  const axisScale = chartAxisScale([
    ...groups.flatMap((group) => group.values),
    ...ticks,
    ...axis.valueTicks,
  ]);
  const pad = {
    left: chartAxisLabelGutter([...ticks, ...axis.valueTicks], axisFontSize, width >= 480 ? 64 : 58, axisScale),
    right: 10,
    top: 14,
    bottom: 28,
  };
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
  // Collision is a question about pixels, not about amounts. The axis drops a
  // reference line whose value is close to a real one, but "close" in value
  // depends on the step while "overlapping" depends on the plot's height: a
  // 190px plot with six rungs puts them 30px apart, and two 11px labels a few
  // pixels apart are unreadable whatever their values say. Zero is structural
  // and always survives — it is the line the signs are read against.
  const labelGap = axisFontSize + 3;
  // One pass over everything that wants a label, in priority order, keeping a
  // tick only when it clears every label already placed. Filtering the ruler
  // against the real figures alone was not enough: nothing stopped two rungs —
  // or zero and a small negative extreme — from landing within a few pixels of
  // each other on a short chart, which is exactly the "-7 Mr sitting on top of
  // 0" the owner reported. The rules are still drawn for every tick; only the
  // text yields, and the real figures never do.
  const placed: number[] = [];
  const clears = (value: number) => placed.every((other) => Math.abs(y(value) - y(other)) >= labelGap);
  for (const value of axis.valueTicks) if (clears(value)) placed.push(value);
  if (ticks.includes(0) && clears(0)) placed.push(0);
  for (const tick of ticks) if (tick !== 0 && clears(tick)) placed.push(tick);
  const labelled = new Set(placed);
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
    <View testID="bar-chart-frame">
      <View accessible accessibilityRole="image" accessibilityLabel={chartSummary}>
        <Svg accessible={false} width={width} height={height}>
          <Defs>
            <ClipPath id={clipId}>
              {/* Anchored on zero, so a negative bar grows downward and a
                  positive one upward — the reveal follows the sign rather than
                  wiping the plot from one edge. */}
              <AnimatedRect
                x={0}
                width={width}
                y={draw.interpolate({ inputRange: [0, 1], outputRange: [zeroY, pad.top] })}
                height={draw.interpolate({ inputRange: [0, 1], outputRange: [0, height] })}
              />
            </ClipPath>
          </Defs>
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
              {labelled.has(value) ? (
                <SvgText
                  testID="bar-axis-label"
                  x={pad.left - 8}
                  y={y(value) + axisFontSize * 0.36}
                  fontFamily={font.semibold}
                  fontSize={axisFontSize}
                  fill={palette.textSecondary}
                  textAnchor="end"
                >
                  {formatChartAxis(value, axisScale)}
                </SvgText>
              ) : null}
            </React.Fragment>
          ))}
          {/* The real extremes, drawn over the ruler: a solid rule and the ink
              the rest of the app gives a figure, so "what is the tallest column
              actually worth" is answered on the axis instead of being rounded
              away by the nearest reference line. */}
          {axis.valueTicks.map((value) => (
            <React.Fragment key={`value-${value}`}>
              <SvgLine
                x1={pad.left}
                y1={y(value)}
                x2={pad.left + plotW}
                y2={y(value)}
                stroke={palette.textSecondary}
                strokeWidth={1}
                opacity={0.45}
              />
              <SvgText
                testID="bar-axis-value"
                x={pad.left - 8}
                y={y(value) + axisFontSize * 0.36}
                fontFamily={font.bold}
                fontSize={axisFontSize}
                fill={palette.text}
                textAnchor="end"
              >
                {formatChartAxis(value, axisScale)}
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
                  <Path d={barShape(bx, top, barW, Math.max(1, h), v > 0)} fill={color} clipPath={`url(#${clipId})`} />
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
                        {/* The one money primitive owns the shared compact unit
                            and the size ladder; the chart does not choose a
                            second format for its value ledger. */}
                        <View style={{ minHeight: Math.round(type.amount.fontSize * 1.4), justifyContent: "flex-end" }}>
                        <Amount
                          testID="bar-value-label"
                          minor={value}
                          colorized={false}
                          color={palette.text}
                          style={{ textAlign: groups.length === 1 ? "left" : "center" }}
                        />
                        </View>
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
