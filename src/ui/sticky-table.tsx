/**
 * Cross-platform sticky-column table. The first column (and an optional extra
 * pinned column) stay fixed while the rest scrolls horizontally; the whole
 * grid scrolls vertically as one. Implemented by splitting the fixed columns
 * out of the horizontal ScrollView (not CSS `position: sticky`), so it behaves
 * identically on web and iOS. A single outer vertical ScrollView keeps the
 * fixed and scrolling halves aligned; fixed row heights keep rows level.
 */

import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Pin } from "lucide-react-native";
import { spacing, type, useTheme } from "./theme";

export interface StickyColumn {
  key: string;
  label: string;
}

export interface StickyRow {
  key: string;
  /** Sticky first-column label. */
  label: string;
  onLabelPress?: () => void;
  labelHighlight?: boolean;
  rowHighlight?: boolean;
  /** One node per column (same order/length as `columns`). */
  cells: React.ReactNode[];
}

export function StickyTable({
  cornerLabel,
  columns,
  rows,
  headWidth = 116,
  cellWidth = 120,
  rowHeight = 52,
  headerHeight = 56,
  pinnedKey,
  onTogglePin,
  currentColumnKey,
}: {
  cornerLabel: string;
  columns: StickyColumn[];
  rows: StickyRow[];
  headWidth?: number;
  cellWidth?: number;
  rowHeight?: number;
  headerHeight?: number;
  /** Optional user-pinned extra column (rendered fixed, after the label). */
  pinnedKey?: string | null;
  onTogglePin?: (key: string) => void;
  /** Highlighted (e.g. current month) column key. */
  currentColumnKey?: string;
}) {
  const { palette } = useTheme();
  const pinnedIndex = pinnedKey ? columns.findIndex((c) => c.key === pinnedKey) : -1;
  const pinnedCol = pinnedIndex >= 0 ? columns[pinnedIndex] : null;
  const scrollCols = columns.filter((_, i) => i !== pinnedIndex);
  const cellCenter = { justifyContent: "center" as const, paddingHorizontal: spacing.sm };

  const rowBg = (i: number, highlight?: boolean) =>
    highlight ? palette.primarySoft + "55" : i % 2 === 1 ? palette.surfaceAlt + "66" : "transparent";

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
      <View style={{ flexDirection: "row" }}>
        {/* Fixed left block: corner + labels (+ optional pinned column) */}
        <View style={{ borderRightWidth: 1, borderColor: palette.border }}>
          <View style={{ flexDirection: "row", height: headerHeight, backgroundColor: palette.surfaceAlt, borderBottomWidth: 1, borderColor: palette.border }}>
            <View style={[{ width: headWidth }, cellCenter]}>
              <Text style={[type.label, { color: palette.textMuted }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>
                {cornerLabel}
              </Text>
            </View>
            {pinnedCol ? (
              <PinnedHeader label={pinnedCol.label} width={cellWidth} onUnpin={onTogglePin ? () => onTogglePin(pinnedCol.key) : undefined} />
            ) : null}
          </View>
          {rows.map((r, ri) => (
            <View
              key={r.key}
              style={{
                flexDirection: "row",
                height: rowHeight,
                backgroundColor: rowBg(ri, r.rowHighlight),
                borderBottomWidth: ri === rows.length - 1 ? 0 : 1,
                borderColor: palette.border,
              }}
            >
              <Pressable
                disabled={!r.onLabelPress}
                onPress={r.onLabelPress}
                accessibilityRole={r.onLabelPress ? "link" : undefined}
                style={[{ width: headWidth }, cellCenter]}
              >
                <Text
                  style={[type.label, { color: r.onLabelPress ? palette.primary : palette.text, fontFamily: r.labelHighlight ? "Inter_700Bold" : "Inter_600SemiBold" }]}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                >
                  {r.label}
                </Text>
              </Pressable>
              {pinnedCol ? <View style={{ width: cellWidth, justifyContent: "center" }}>{r.cells[pinnedIndex]}</View> : null}
            </View>
          ))}
        </View>

        {/* Scrollable block: header + data rows share one horizontal ScrollView */}
        <ScrollView horizontal showsHorizontalScrollIndicator style={{ flex: 1 }}>
          <View>
            <View style={{ flexDirection: "row", height: headerHeight, backgroundColor: palette.surfaceAlt, borderBottomWidth: 1, borderColor: palette.border }}>
              {scrollCols.map((c) => (
                <Pressable
                  key={c.key}
                  disabled={!onTogglePin}
                  onPress={onTogglePin ? () => onTogglePin(c.key) : undefined}
                  style={[{ width: cellWidth, backgroundColor: c.key === currentColumnKey ? palette.primarySoft : "transparent" }, cellCenter]}
                >
                  <Text
                    style={[type.label, { color: c.key === currentColumnKey ? palette.primary : palette.textMuted, textAlign: "right" }]}
                    numberOfLines={2}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                  >
                    {c.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {rows.map((r, ri) => (
              <View
                key={r.key}
                style={{
                  flexDirection: "row",
                  height: rowHeight,
                  backgroundColor: rowBg(ri, r.rowHighlight),
                  borderBottomWidth: ri === rows.length - 1 ? 0 : 1,
                  borderColor: palette.border,
                }}
              >
                {scrollCols.map((c) => {
                  const idx = columns.findIndex((x) => x.key === c.key);
                  return (
                    <View
                      key={c.key}
                      style={{ width: cellWidth, justifyContent: "center", backgroundColor: c.key === currentColumnKey ? palette.primarySoft + "55" : "transparent" }}
                    >
                      {r.cells[idx]}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </ScrollView>
  );
}

function PinnedHeader({ label, width, onUnpin }: { label: string; width: number; onUnpin?: () => void }) {
  const { palette } = useTheme();
  return (
    <Pressable
      disabled={!onUnpin}
      onPress={onUnpin}
      style={{ width, justifyContent: "center", paddingHorizontal: spacing.sm, flexDirection: "row", alignItems: "center", gap: 4 }}
    >
      <Pin size={11} color={palette.primary} fill={palette.primary} />
      <Text style={[type.label, { color: palette.primary, textAlign: "right", flex: 1 }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>
        {label}
      </Text>
    </Pressable>
  );
}
