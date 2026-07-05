/**
 * Chart primitives (react-native-svg, universal iOS+web).
 * Method: dataviz skill — validated categorical palette (light+dark selected
 * separately), 2px surface gaps between fills, thin marks, recessive grid,
 * direct labels; every chart is paired with a labeled value list (relief rule
 * for the low-contrast light slots + table-view accessibility).
 */

import React from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Path, Line as SvgLine, Text as SvgText } from "react-native-svg";
import { formatMinor } from "../domain/money";
import { spacing, type, useTheme } from "./theme";

const LIGHT_SERIES = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"];
const DARK_SERIES = ["#3987e5", "#199e70", "#c98500", "#008300", "#9085e9", "#e66767", "#d55181", "#d95926"];

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

  let angle = -90;
  const arcs = slices
    .filter((s) => s.valueMinor > 0)
    .map((s) => {
      const sweep = total > 0 ? (s.valueMinor / total) * 360 : 0;
      const path = describeArc(cx, cy, r, angle, angle + sweep);
      angle += sweep;
      return { ...s, path, sweep };
    });

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
            <Text style={[type.small, { color: palette.text, flex: 1 }]} numberOfLines={1}>
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
