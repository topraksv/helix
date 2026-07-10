/**
 * Chart primitives (react-native-svg, universal iOS+web).
 * Method: dataviz skill — validated categorical palette (light+dark selected
 * separately), 2px surface gaps between fills, thin marks, recessive grid,
 * direct labels; every chart is paired with a labeled value list (relief rule
 * for the low-contrast light slots + table-view accessibility).
 */

import React from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Path, Rect, Line as SvgLine, Text as SvgText } from "react-native-svg";
import { formatMinor } from "../domain/money";
import { spacing, type, useTheme } from "./theme";

// Warm editorial categorical palette — earth tones spanning distinct hues.
// Index 1 (sage) reads as income, index 5 (brick) as expense on the dashboard.
const LIGHT_SERIES = ["#C9623F", "#7D8370", "#C5A07F", "#5E7A8C", "#A9772F", "#A8432B", "#6E8B5F", "#B08A3E"];
const DARK_SERIES = ["#D97757", "#96A085", "#D6B48F", "#7C99AB", "#CBA15E", "#D45A3E", "#8FAA7C", "#CBA85C"];

export function useSeriesColors(): string[] {
  const { scheme } = useTheme();
  return scheme === "dark" ? DARK_SERIES : LIGHT_SERIES;
}

export interface DonutSlice {
  label: string;
  valueMinor: number;
  color: string;
}

/** Donut with 2px surface gaps between segments + paired legend list. */
export function Donut({ slices, size = 168 }: { slices: DonutSlice[]; size?: number }) {
  const { palette } = useTheme();
  const total = slices.reduce((sum, s) => sum + s.valueMinor, 0);
  const r = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = 22;

  const arcs = slices
    .filter((s) => s.valueMinor > 0)
    .reduce<(DonutSlice & { path: string; sweep: number })[]>((acc, s) => {
      const start = -90 + acc.reduce((deg, a) => deg + a.sweep, 0);
      const sweep = total > 0 ? (s.valueMinor / total) * 360 : 0;
      return [...acc, { ...s, path: describeArc(cx, cy, r, start, start + sweep), sweep }];
    }, []);

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg, flexWrap: "wrap" }}>
      <Svg width={size} height={size}>
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
          ? arcs.map((a, i) => {
              const boundary = arcs.slice(0, i + 1).reduce((deg, x) => deg + x.sweep, -90);
              const p1 = polar(cx, cy, r - strokeWidth / 2 - 1, boundary);
              const p2 = polar(cx, cy, r + strokeWidth / 2 + 1, boundary);
              return <SvgLine key={`gap-${i}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={palette.surface} strokeWidth={2} />;
            })
          : null}
        <SvgText x={cx} y={cy + 5} textAnchor="middle" fontSize={13} fontWeight="600" fill={palette.text}>
          {total > 0 ? formatMinor(total) : "—"}
        </SvgText>
      </Svg>
      {/* Paired legend list: identity never color-alone (relief rule) */}
      <View style={{ flex: 1, minWidth: 160, gap: 6 }}>
        {slices.map((s, i) => (
          <View key={`${s.label}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: s.color }} />
            <Text style={[type.small, { color: palette.text, flex: 1 }]}>
              {s.label}
            </Text>
            <Text style={[type.small, { color: palette.textMuted, fontVariant: ["tabular-nums"] }]}>
              {total > 0 ? `%${Math.round((s.valueMinor / total) * 100)}` : ""} · {formatMinor(s.valueMinor)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export interface LineSeries {
  label: string;
  color: string;
  /** One value per x slot (minor units); null = missing. */
  points: (number | null)[];
}

/** Multi-series line chart: 2px strokes, recessive grid, direct end labels. */
export function Lines({
  series,
  xLabels,
  height = 180,
  width = 320,
}: {
  series: LineSeries[];
  xLabels: string[];
  height?: number;
  width?: number;
}) {
  const { palette } = useTheme();
  const padding = { left: 8, right: 56, top: 12, bottom: 22 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const values = series.flatMap((s) => s.points.filter((p): p is number => p != null));
  if (values.length === 0) return null;
  const min = Math.min(0, ...values);
  const max = Math.max(...values, 1);
  const x = (i: number) => padding.left + (xLabels.length <= 1 ? plotW / 2 : (i / (xLabels.length - 1)) * plotW);
  const y = (v: number) => padding.top + plotH - ((v - min) / (max - min)) * plotH;

  return (
    <View>
      <Svg width={width} height={height}>
        {/* recessive grid: zero line + top */}
        <SvgLine x1={padding.left} y1={y(0)} x2={padding.left + plotW} y2={y(0)} stroke={palette.border} strokeWidth={1} />
        {series.map((s) => {
          const d = s.points
            .map((p, i) => (p == null ? null : `${i === 0 || s.points[i - 1] == null ? "M" : "L"}${x(i)},${y(p)}`))
            .filter(Boolean)
            .join(" ");
          const lastIdx = s.points.reduce<number>((acc, p, i) => (p != null ? i : acc), -1);
          return (
            <React.Fragment key={s.label}>
              <Path d={d} stroke={s.color} strokeWidth={2} fill="none" />
              {lastIdx >= 0 ? (
                <>
                  <Circle cx={x(lastIdx)} cy={y(s.points[lastIdx]!)} r={4} fill={s.color} stroke={palette.surface} strokeWidth={2} />
                  <SvgText
                    x={x(lastIdx) + 6}
                    y={y(s.points[lastIdx]!) + 4}
                    fontSize={10}
                    fill={palette.textMuted}
                  >
                    {s.label}
                  </SvgText>
                </>
              ) : null}
            </React.Fragment>
          );
        })}
        {xLabels.map((l, i) =>
          xLabels.length <= 6 || i % Math.ceil(xLabels.length / 6) === 0 ? (
            <SvgText key={i} x={x(i)} y={height - 6} fontSize={9} fill={palette.textMuted} textAnchor="middle">
              {l}
            </SvgText>
          ) : null,
        )}
      </Svg>
    </View>
  );
}

export interface BarGroup {
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

  return (
    <View>
      <Svg width={width} height={height}>
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
            <SvgText key={`l-${gi}`} x={pad.left + gi * groupW + groupW / 2} y={height - 6} fontSize={9} fill={palette.textMuted} textAnchor="middle">
              {g.label}
            </SvgText>
          ) : null,
        )}
      </Svg>
      {series.length > 1 ? (
        <View style={{ flexDirection: "row", gap: spacing.md, justifyContent: "center", marginTop: 2 }}>
          {series.map((s) => (
            <View key={s.label} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: s.color }} />
              <Text style={[type.small, { color: palette.textMuted }]}>{s.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Two-part proportional bar (fixed vs variable) with 2px gap + labels. */
export function SplitBar({ parts }: { parts: { label: string; valueMinor: number; color: string }[] }) {
  const { palette } = useTheme();
  const total = parts.reduce((sum, p) => sum + p.valueMinor, 0);
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", height: 14, borderRadius: 4, overflow: "hidden", backgroundColor: palette.surfaceAlt }}>
        {parts.map((p, i) => (
          <View
            key={p.label}
            style={{
              flex: total > 0 ? Math.max(p.valueMinor, 0) : 1,
              backgroundColor: p.color,
              marginLeft: i > 0 ? 2 : 0,
            }}
          />
        ))}
      </View>
      {parts.map((p) => (
        <View key={p.label} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.color }} />
          <Text style={[type.small, { color: palette.text, flex: 1 }]}>{p.label}</Text>
          <Text style={[type.small, { color: palette.textMuted, fontVariant: ["tabular-nums"] }]}>
            {formatMinor(p.valueMinor)}
          </Text>
        </View>
      ))}
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
