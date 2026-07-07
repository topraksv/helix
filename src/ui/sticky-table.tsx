/**
 * Cross-platform sticky-column + sticky-header table. The first column (and an
 * optional extra pinned column) stay fixed while the rest scrolls horizontally;
 * the header row stays fixed while the body scrolls vertically. Built by
 * splitting the grid into four quadrants (corner / header / labels / body)
 * rather than CSS `position: sticky` (which iOS ignores), so it behaves the
 * same on web and native. The header and body share a synced horizontal offset;
 * fixed row heights keep the label and data halves aligned.
 *
 * Web extras: grab-to-pan with the mouse (both axes) and arrow/Page keyboard
 * scrolling once the table has focus.
 */

import React, { useEffect, useRef } from "react";
import { Platform, Pressable, ScrollView, Text, View, type NativeSyntheticEvent, type NativeScrollEvent } from "react-native";
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

function getNode(ref: React.RefObject<ScrollView | null>): HTMLElement | null {
  return (ref.current as unknown as { getScrollableNode?: () => HTMLElement } | null)?.getScrollableNode?.() ?? null;
}

/**
 * Web-only: grab-to-pan (both axes) + arrow/Page keyboard scrolling. The header
 * mirrors the body's horizontal offset, so panning updates both.
 */
function useWebInteractions(
  vRef: React.RefObject<ScrollView | null>,
  bodyHRef: React.RefObject<ScrollView | null>,
  headerHRef: React.RefObject<ScrollView | null>,
) {
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const vNode = getNode(vRef);
    const bodyNode = getNode(bodyHRef);
    const headerNode = getNode(headerHRef);
    if (!vNode) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let moved = false;

    const syncHeader = () => {
      if (headerNode && bodyNode) headerNode.scrollLeft = bodyNode.scrollLeft;
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = bodyNode ? bodyNode.scrollLeft : 0;
      startTop = vNode.scrollTop;
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 4) {
        moved = true;
        vNode.style.cursor = "grabbing";
      }
      if (moved) {
        if (bodyNode) bodyNode.scrollLeft = startLeft - dx;
        vNode.scrollTop = startTop - dy;
        syncHeader();
        e.preventDefault();
      }
    };
    const onUp = () => {
      dragging = false;
      vNode.style.cursor = "grab";
    };
    const onKey = (e: KeyboardEvent) => {
      const stepY = 52;
      const stepX = 120;
      let handled = true;
      if (e.key === "ArrowDown") vNode.scrollTop += stepY;
      else if (e.key === "ArrowUp") vNode.scrollTop -= stepY;
      else if (e.key === "PageDown") vNode.scrollTop += vNode.clientHeight - stepY;
      else if (e.key === "PageUp") vNode.scrollTop -= vNode.clientHeight - stepY;
      else if (e.key === "ArrowRight" && bodyNode) bodyNode.scrollLeft += stepX;
      else if (e.key === "ArrowLeft" && bodyNode) bodyNode.scrollLeft -= stepX;
      else handled = false;
      if (handled) {
        syncHeader();
        e.preventDefault();
      }
    };

    vNode.style.cursor = "grab";
    vNode.setAttribute("tabindex", "0");
    (vNode.style as CSSStyleDeclaration).outline = "none";
    vNode.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup", onUp);
    vNode.addEventListener("keydown", onKey);
    return () => {
      vNode.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      vNode.removeEventListener("keydown", onKey);
    };
  }, [vRef, bodyHRef, headerHRef]);
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
  onColumnPress,
  currentColumnKey,
  height,
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
  /** Column-header tap action (e.g. open a month). Takes precedence over pin. */
  onColumnPress?: (key: string) => void;
  /** Highlighted (e.g. current month) column key. */
  currentColumnKey?: string;
  /** Explicit viewport height; when omitted the table flexes to fill. */
  height?: number;
}) {
  const { palette } = useTheme();
  const vRef = useRef<ScrollView>(null);
  const bodyHRef = useRef<ScrollView>(null);
  const headerHRef = useRef<ScrollView>(null);
  useWebInteractions(vRef, bodyHRef, headerHRef);

  const pinnedIndex = pinnedKey ? columns.findIndex((c) => c.key === pinnedKey) : -1;
  const pinnedCol = pinnedIndex >= 0 ? columns[pinnedIndex] : null;
  const scrollCols = columns.filter((_, i) => i !== pinnedIndex);
  const cellCenter = { justifyContent: "center" as const, paddingHorizontal: spacing.sm };
  const leftWidth = headWidth + (pinnedCol ? cellWidth : 0);

  const rowBg = (i: number, highlight?: boolean) =>
    highlight ? palette.primarySoft + "55" : i % 2 === 1 ? palette.surfaceAlt + "66" : "transparent";

  // Body horizontal scroll drives the header's offset (native + web).
  const onBodyScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    headerHRef.current?.scrollTo({ x: e.nativeEvent.contentOffset.x, animated: false });
  };

  const headerCell = (c: StickyColumn) => (
    <Pressable
      key={c.key}
      disabled={!onColumnPress && !onTogglePin}
      onPress={onColumnPress ? () => onColumnPress(c.key) : onTogglePin ? () => onTogglePin(c.key) : undefined}
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
  );

  return (
    <View style={height ? { height } : { flex: 1 }}>
      {/* Sticky header: corner + column headers, mirrors the body's x offset. */}
      <View style={{ flexDirection: "row", height: headerHeight, borderBottomWidth: 1, borderColor: palette.border, backgroundColor: palette.surfaceAlt }}>
        <View style={{ flexDirection: "row", width: leftWidth, borderRightWidth: 1, borderColor: palette.border }}>
          <View style={[{ width: headWidth }, cellCenter]}>
            <Text style={[type.label, { color: palette.textMuted }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>
              {cornerLabel}
            </Text>
          </View>
          {pinnedCol ? (
            <PinnedHeader label={pinnedCol.label} width={cellWidth} onUnpin={onTogglePin ? () => onTogglePin(pinnedCol.key) : undefined} />
          ) : null}
        </View>
        <ScrollView ref={headerHRef} horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={{ flexDirection: "row" }}>{scrollCols.map(headerCell)}</View>
        </ScrollView>
      </View>

      {/* Body: fixed-left labels (+ pinned col) beside a horizontally-scrolling
          data grid; the whole body scrolls vertically as one. */}
      <ScrollView ref={vRef} showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.sm }}>
        <View style={{ flexDirection: "row" }}>
          <View style={{ width: leftWidth, borderRightWidth: 1, borderColor: palette.border }}>
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

          <ScrollView
            ref={bodyHRef}
            horizontal
            showsHorizontalScrollIndicator
            scrollEventThrottle={16}
            onScroll={onBodyScroll}
            style={{ flex: 1 }}
          >
            <View>
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
    </View>
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
