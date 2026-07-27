/** Accessible SVG chart primitives shared by native and web. */

import React from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Path, Rect, Line as SvgLine, Text as SvgText } from "react-native-svg";
import type { Distribution } from "../domain/analytics";
import { formatMinorCompact } from "../domain/money";
import { tr } from "../i18n/tr";
import { radius, spacing, type, useTheme } from "./theme";

export type SeriesColors = readonly [string, string, string, string, string, string, string, string];

/**
 * Ordered fills for CATEGORICAL series (distribution slices, stacked bars),
 * where a colour identifies a category and carries no judgement about it.
 *
 * The order is the contract, not decoration. The palette bans purple and every
 * blue but the focus ring, which leaves clay, green, amber, red and two
 * neutrals — so the semantic accents have to appear here, and the risk is that
 * neighbouring slices read as a status scale instead of as categories. Green,
 * amber and red are therefore never adjacent to each other, and no two
 * neighbours come from the same hue family, counting the wrap from the last
 * entry back to the first. Red and amber side by side were the worst case: a
 * warning-then-danger ramp for two categories that mean nothing of the kind,
 * and the pair hardest to separate with a red-green colour vision deficiency.
 *
 * `tests/theme-contrast.test.ts` enforces both rules.
 */
export function useSeriesColors(): SeriesColors {
  const { palette } = useTheme();
  return [
    palette.primary,
    palette.positive,
    palette.surfaceStrong,
    palette.primaryStrong,
    palette.warning,
    palette.textSecondary,
    palette.accentText,
    palette.negative,
  ];
}

function seriesColor(colors: SeriesColors, index: number): string {
  return colors[index % colors.length] ?? colors[0];
}

export interface DonutSlice {
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
  const r = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = 22;

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
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg, flexWrap: "wrap" }}>
      <View accessible accessibilityRole="image" accessibilityLabel={chartSummary}>
        <Svg accessible={false} width={size} height={size}>
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
          <SvgText x={cx} y={cy + 5} textAnchor="middle" fontSize={13} fontWeight="600" fill={palette.text}>
            {formatMinorCompact(displayTotal)}
          </SvgText>
        </Svg>
      </View>
      {/* Paired legend list: identity never color-alone (relief rule) */}
      <View style={{ flex: 1, minWidth: 160, gap: 6 }}>
        {[...slices, ...supplementalSlices].map((s, i) => {
          const supplemental = i >= slices.length;
          return (
            <View key={`${s.label}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: s.color }} />
              <Text style={[type.small, { color: palette.text, flex: 1 }]}>{s.label}</Text>
              <Text
                style={[type.small, { color: palette.textSecondary, fontVariant: ["tabular-nums"] }]}
              >
                {supplemental
                  ? formatMinorCompact(s.valueMinor)
                  : `${arcTotal > 0 ? `%${Math.round((s.valueMinor / arcTotal) * 100)}` : ""} · ${formatMinorCompact(s.valueMinor)}`}
              </Text>
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
              opacity={Math.abs(value) < 1 ? 0.55 : 0.18}
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
            opacity={0.12}
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
                    <Path d={line} stroke={s.color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </React.Fragment>
                );
              })}
              {lastIdx >= 0 ? (
                <Circle cx={x(lastIdx)} cy={y(s.points[lastIdx]!)} r={4} fill={s.color} stroke={palette.surface} strokeWidth={2} />
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

/**
 * Grouped vertical bars — one cluster per x slot, one bar per series. Signed
 * values dip below a shared zero line. Paired with a legend (relief rule).
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
  const pad = { left: 8, right: 8, top: 14, bottom: 22 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const all = groups.flatMap((g) => g.values.filter((v): v is number => v != null));
  if (all.length === 0 || groups.length === 0) return null;
  const max = Math.max(...all, 1);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const groupW = plotW / groups.length;
  const barGap = 2;
  const nSeries = Math.max(series.length, 1);
  const barW = Math.max(3, (groupW * 0.68 - barGap * (nSeries - 1)) / nSeries);
  const y = (v: number) => pad.top + plotH - ((v - min) / span) * plotH;
  const zeroY = y(0);
  const everyN = groups.length <= 6 ? 1 : Math.ceil(groups.length / 6);
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
          <SvgLine x1={pad.left} y1={zeroY} x2={pad.left + plotW} y2={zeroY} stroke={palette.border} strokeWidth={1} />
          {groups.map((g, gi) => {
            const gx = pad.left + gi * groupW + groupW * 0.16;
            return g.values.map((v, si) => {
              if (v == null || v === 0) return null;
              const top = v > 0 ? y(v) : zeroY;
              const h = Math.abs(y(v) - zeroY);
              const bx = gx + si * (barW + barGap);
              return <Rect key={`${gi}-${si}`} x={bx} y={top} width={barW} height={Math.max(1, h)} rx={2} fill={series[si]?.color ?? palette.primary} />;
            });
          })}
          {groups.map((g, gi) =>
            gi % everyN === 0 ? (
              <SvgText key={`l-${gi}`} x={pad.left + gi * groupW + groupW / 2} y={height - 6} fontSize={9} fill={palette.textSecondary} textAnchor="middle">
                {g.label}
              </SvgText>
            ) : null,
          )}
        </Svg>
      </View>
      {series.length > 1 ? (
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
