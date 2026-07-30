/**
 * Cross-platform sticky-column + sticky-header table. The first column (and an
 * optional extra pinned column) stay fixed while the rest scrolls horizontally;
 * the header row stays fixed while the body scrolls vertically. Built by
 * splitting the grid into four quadrants (corner / header / labels / body)
 * rather than CSS `position: sticky` (which iOS ignores), so it behaves the
 * same on web and native. The header and body share a synced horizontal offset;
 * shared measured row heights keep the label and data halves aligned.
 *
 * Web extras: grab-to-pan with the mouse (both axes) and arrow/Page keyboard
 * scrolling once the table has focus.
 */

import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View, type LayoutChangeEvent, type NativeSyntheticEvent, type NativeScrollEvent } from "react-native";
import { Pin, type LucideIcon } from "lucide-react-native";
import { selectionTap } from "./haptics";
import { tr } from "../i18n/tr";
import { font, spacing, type, useTheme } from "./theme";

/** Default fixed metrics; exported so callers can size a table to its content. */
export const STICKY_ROW_HEIGHT = 52;
export const STICKY_HEADER_HEIGHT = 56;
/** Fixed right-hand strip holding a header's pin. */
const STICKY_MARKER_W = 24;

/**
 * User-authored column names can be one long token. Native Text wraps words,
 * not arbitrary characters, so add invisible break opportunities without
 * changing the visible or accessible label. Ordinary names remain untouched.
 */
function softWrapLabel(label: string, maxTokenLength = 12): string {
  return label
    .split(/(\s+)/)
    .map((part) => {
      if (!part.trim() || part.length <= maxTokenLength) return part;
      // Preserve a natural Turkish plural boundary where one exists. For all
      // other long tokens, balance the chunks instead of leaving an orphaned
      // final letter (`Faturala / r`, `Cumhuriy / et`).
      const plural = part.match(/^(.{4,}?)(lar|ler)$/iu);
      if (plural) return `${plural[1]}\u200B${plural[2]}`;
      const chunkCount = Math.ceil(part.length / maxTokenLength);
      const chunkLength = Math.ceil(part.length / chunkCount);
      return part.match(new RegExp(`.{1,${chunkLength}}`, "gu"))?.join("\u200B") ?? part;
    })
    .join("");
}

export interface StickyColumn {
  key: string;
  /** Full spoken name when the compact visible label is abbreviated. */
  accessibilityLabel?: string;
  label: string;
  /** Dense matrix item labels wrap twice, then shorten; spoken text stays full. */
  truncateLabel?: boolean;
  /** Optional marker icon shown top-left of the header (e.g. a computed column). */
  icon?: LucideIcon;
}

export interface StickyRow {
  key: string;
  /** Sticky first-column label. */
  label: string;
  /** Full spoken name when the visible label omits context such as the year. */
  accessibilityLabel?: string;
  /** Dense matrix item labels wrap twice, then shorten; spoken text stays full. */
  truncateLabel?: boolean;
  /** Optional marker icon shown top-left of the label (e.g. a computed row).
   *  Mirrors StickyColumn.icon so the two orientations look identical. */
  icon?: LucideIcon;
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
  rowHeight: number,
  cellWidth: number,
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
      // One row / one column per arrow press, whatever the table's real
      // dimensions are — not a hardcoded approximation of them.
      const stepY = rowHeight;
      const stepX = cellWidth;
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
    // Both scrollers must be reachable by keyboard: a scrollable region that
    // cannot receive focus is unusable without a pointer (axe
    // `scrollable-region-focusable`). The body scroller sits inside the
    // vertical one, so its arrow keys still bubble to the handler below.
    vNode.setAttribute("tabindex", "0");
    bodyNode?.setAttribute("tabindex", "0");
    vNode.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup", onUp);
    vNode.addEventListener("keydown", onKey);
    return () => {
      vNode.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      vNode.removeEventListener("keydown", onKey);
      vNode.removeAttribute("tabindex");
      bodyNode?.removeAttribute("tabindex");
      vNode.style.cursor = "";
    };
  }, [vRef, bodyHRef, headerHRef, rowHeight, cellWidth]);
}

export function StickyTable({
  cornerLabel,
  columns,
  rows,
  headWidth = 116,
  headHorizontalPadding = spacing.sm,
  cellWidth = 120,
  rowHeight = STICKY_ROW_HEIGHT,
  headerHeight = STICKY_HEADER_HEIGHT,
  pinnedKey,
  onTogglePin,
  onColumnPress,
  currentColumnKey,
  focusColumnKey,
  focusRowKey,
  height,
  scrollRef,
}: {
  cornerLabel: string;
  columns: StickyColumn[];
  rows: StickyRow[];
  headWidth?: number;
  /** Horizontal inset for the sticky corner and first-column labels. */
  headHorizontalPadding?: number;
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
  /** Center this column horizontally on open (e.g. the current month). */
  focusColumnKey?: string;
  /** Center this row vertically on open (e.g. the current month row). */
  focusRowKey?: string;
  /** Explicit viewport height; when omitted the table flexes to fill. */
  height?: number;
  /** The table's vertical scroller, so a tab press can return it to the top. */
  scrollRef?: React.RefObject<ScrollView | null>;
}) {
  const { palette } = useTheme();
  const ownVRef = useRef<ScrollView>(null);
  const vRef = scrollRef ?? ownVRef;
  const bodyHRef = useRef<ScrollView>(null);
  const headerHRef = useRef<ScrollView>(null);
  useWebInteractions(vRef, bodyHRef, headerHRef, rowHeight, cellWidth);
  const [bodyW, setBodyW] = useState(0);
  const [bodyViewH, setBodyViewH] = useState(0);
  const [labelHeights, setLabelHeights] = useState<Record<string, number>>({});
  const horizontalFocusSig = useRef("");
  const verticalFocusSig = useRef("");

  const pinnedIndex = pinnedKey ? columns.findIndex((c) => c.key === pinnedKey) : -1;
  const pinnedCol = pinnedIndex >= 0 ? columns[pinnedIndex] : null;
  const scrollCols = columns.filter((_, i) => i !== pinnedIndex);
  const colIndexByKey = new Map(columns.map((c, i) => [c.key, i]));
  const cellCenter = { justifyContent: "center" as const, paddingHorizontal: headHorizontalPadding };
  const leftWidth = headWidth + (pinnedCol ? cellWidth : 0);
  const measureLabel = (key: string, textHeight: number, extraHeight = 0) => {
    const measured = Math.ceil(textHeight + spacing.xs * 2 + extraHeight);
    setLabelHeights((current) => current[key] === measured ? current : { ...current, [key]: measured });
  };
  const headerKeys = ["header:corner", ...columns.map((column) => `header:${column.key}`)];
  const resolvedHeaderHeight = Math.max(headerHeight, ...headerKeys.map((key) => labelHeights[key] ?? 0));
  const resolvedRowHeights = rows.map((row) => Math.max(rowHeight, labelHeights[`row:${row.key}`] ?? 0));
  const rowHeightsSignature = resolvedRowHeights.join("|");

  const scrollColumnsSignature = scrollCols.map((column) => column.key).join("|");

  // Center the current month on open (clamped at the edges). When the pivot
  // changes back to row-focused mode there is no horizontal focus target, so
  // reset to the first category; otherwise the recycled ScrollView keeps the
  // old July offset and opens halfway through an unrelated category list.
  useEffect(() => {
    if (bodyW <= 0) return;
    const sig = `${focusColumnKey}|${bodyW}|${cellWidth}|${scrollColumnsSignature}`;
    if (horizontalFocusSig.current === sig) return;
    let target = 0;
    if (focusColumnKey) {
      const idx = scrollCols.findIndex((c) => c.key === focusColumnKey);
      if (idx >= 0) {
        const contentW = scrollCols.length * cellWidth;
        const centered = idx * cellWidth + cellWidth / 2 - bodyW / 2;
        // The viewport is deliberately sized to complete cells. Snap the
        // current-month focus to that same grid so an even visible count does
        // not produce half a month at both edges.
        target = Math.max(
          0,
          Math.min(Math.round(centered / cellWidth) * cellWidth, contentW - bodyW),
        );
      }
    }
    bodyHRef.current?.scrollTo({ x: target, animated: false });
    headerHRef.current?.scrollTo({ x: target, animated: false });
    horizontalFocusSig.current = sig;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusColumnKey, bodyW, cellWidth, scrollColumnsSignature]);

  // Vertical current-month focus is independent of the horizontal pivot. When
  // the new pivot has no row focus (months became columns), return to its first
  // category instead of reusing July's old y offset. Text measurement may
  // change row heights, so this pass deliberately tracks them.
  useEffect(() => {
    if (bodyViewH <= 0) return;
    const sig = `${focusRowKey}|${bodyViewH}|${rows.length}|${rowHeightsSignature}`;
    if (verticalFocusSig.current === sig) return;
    let target = 0;
    if (focusRowKey) {
      const idx = rows.findIndex((r) => r.key === focusRowKey);
      if (idx < 0) return;
      const focusedRowHeight = resolvedRowHeights[idx];
      if (focusedRowHeight == null) return;
      const contentH = resolvedRowHeights.reduce((sum, value) => sum + value, 0);
      const rowTop = resolvedRowHeights.slice(0, idx).reduce((sum, value) => sum + value, 0);
      target = Math.max(0, Math.min(rowTop + focusedRowHeight / 2 - bodyViewH / 2, contentH - bodyViewH));
    }
    vRef.current?.scrollTo({ y: target, animated: false });
    verticalFocusSig.current = sig;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRowKey, bodyViewH, rows.length, rowHeightsSignature]);

  const rowBg = (_i: number, highlight?: boolean) =>
    highlight ? palette.primarySoft + "38" : "transparent";

  // Body horizontal scroll drives the header's offset (native + web).
  const onBodyScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    headerHRef.current?.scrollTo({ x: e.nativeEvent.contentOffset.x, animated: false });
  };

  /**
   * Header controls keep one horizontal rhythm. The pin always owns the right
   * edge beside the label; it never creates a second marker row on phones.
   * Computed columns place sigma immediately before the pin in the same strip.
   * Wide cells mirror the strip to preserve optical centring, while compact
   * cells return that unused left space to the label.
   */
  const headerCell = (c: StickyColumn) => {
    const isCurrent = c.key === currentColumnKey;
    const both = !!onColumnPress && !!onTogglePin;
    const labelAction = onColumnPress ?? onTogglePin;
    const compactHeader = cellWidth < 104;
    const markerWidth = both && c.icon ? 40 : STICKY_MARKER_W;
    const hasMarker = both || !!c.icon;
    return (
      <View
        key={c.key}
        style={{
          width: cellWidth,
          height: resolvedHeaderHeight,
          backgroundColor: "transparent",
          justifyContent: "center",
          paddingLeft: compactHeader ? spacing.xs : hasMarker ? markerWidth : spacing.xs,
          // The pin keeps a 24px measured web target, but its glyph occupies
          // only the trailing 12px. Let compact copy use the transparent part
          // of that target so ordinary words stay whole without shrinking the
          // number of visible financial columns.
          paddingRight: hasMarker ? (compactHeader ? markerWidth - 6 : markerWidth) : spacing.xs,
          paddingVertical: spacing.xs,
          borderBottomWidth: isCurrent ? 3 : 0,
          borderBottomColor: palette.primary,
        }}
      >
        <Pressable
          disabled={!labelAction}
          onPress={labelAction ? () => {
            if (!onColumnPress && onTogglePin) selectionTap();
            labelAction(c.key);
          } : undefined}
          accessibilityRole={labelAction ? "button" : undefined}
          accessibilityLabel={labelAction ? c.accessibilityLabel ?? c.label : undefined}
          // Fill the header band: wrapping only the label left a full-width but
          // 16px-tall tap target on the app's primary financial surface.
          style={{ flex: 1, justifyContent: "center" }}
        >
          <Text
            testID="table-column-label"
            accessibilityLabel={c.accessibilityLabel ?? c.label}
            numberOfLines={c.truncateLabel ? 2 : undefined}
            ellipsizeMode={c.truncateLabel ? "tail" : undefined}
            style={[
              type.label,
              {
                color: isCurrent ? palette.primaryText : palette.textSecondary,
                fontSize: compactHeader ? 12 : type.label.fontSize,
                textAlign: "center",
                flexShrink: 1,
                minWidth: 0,
                maxWidth: "100%",
              },
            ]}
            onLayout={(event) => measureLabel(`header:${c.key}`, event.nativeEvent.layout.height)}
          >
            {c.truncateLabel ? c.label : softWrapLabel(c.label, cellWidth < 80 ? 8 : cellWidth < 104 ? 10 : 12)}
          </Text>
        </Pressable>
        {hasMarker ? (
          <View
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: markerWidth,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 2,
            }}
          >
            {c.icon ? <c.icon accessible={false} size={11} color={palette.textSecondary} strokeWidth={2.2} /> : null}
            {both ? (
              <Pressable
                onPress={() => { selectionTap(); onTogglePin!(c.key); }}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={pinnedKey === c.key ? tr.a11y.unpinColumn(c.accessibilityLabel ?? c.label) : tr.a11y.pinColumn(c.accessibilityLabel ?? c.label)}
                style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}
              >
                <Pin
                  accessible={false}
                  size={12}
                  color={pinnedKey === c.key ? palette.primaryText : palette.textSecondary}
                />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={height ? { height } : { flex: 1 }}>
      {/* Sticky header: corner + column headers, mirrors the body's x offset. */}
      <View style={{ flexDirection: "row", height: resolvedHeaderHeight, borderBottomWidth: 1, borderColor: palette.border, backgroundColor: palette.surface }}>
        <View style={{ flexDirection: "row", width: leftWidth, borderRightWidth: 1, borderColor: palette.border }}>
          <View style={[{ width: headWidth }, cellCenter]}>
            <Text
              style={[type.label, { color: palette.textSecondary, textAlign: "left", width: "100%" }]}
              onLayout={(event) => measureLabel("header:corner", event.nativeEvent.layout.height)}
            >
              {cornerLabel}
            </Text>
          </View>
          {pinnedCol ? (
            <PinnedHeader
              label={pinnedCol.label}
              accessibilityLabel={pinnedCol.accessibilityLabel}
              truncateLabel={pinnedCol.truncateLabel}
              width={cellWidth}
              onUnpin={onTogglePin ? () => onTogglePin(pinnedCol.key) : undefined}
              onHeight={(textHeight) => measureLabel(`header:${pinnedCol.key}`, textHeight)}
            />
          ) : null}
        </View>
        <ScrollView
          ref={headerHRef}
          testID="table-horizontal-header"
          horizontal
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1 }}
        >
          <View style={{ flexDirection: "row" }}>{scrollCols.map(headerCell)}</View>
        </ScrollView>
      </View>

      {/* Body: fixed-left labels (+ pinned col) beside a horizontally-scrolling
          data grid; the whole body scrolls vertically as one. */}
      <ScrollView
        ref={vRef}
        accessibilityLabel={tr.a11y.tableLabel(cornerLabel)}
        accessibilityHint={tr.a11y.tableNavigation}
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.sm }}
        onLayout={(e: LayoutChangeEvent) => setBodyViewH(e.nativeEvent.layout.height)}
      >
        <View style={{ flexDirection: "row" }}>
          <View style={{ width: leftWidth, borderRightWidth: 1, borderColor: palette.border }}>
            {rows.map((r, ri) => (
              <View
                key={r.key}
                style={{
                  flexDirection: "row",
                  // Let the label report its natural first-pass height. A hard
                  // height clips before onTextLayout can grow the paired body
                  // row, while the shared measured minimum keeps both halves
                  // aligned on the following render.
                  minHeight: resolvedRowHeights[ri],
                  backgroundColor: rowBg(ri, r.rowHighlight),
                  borderBottomWidth: ri === rows.length - 1 ? 0 : 1,
                  borderColor: palette.border,
                }}
              >
                <Pressable
                  disabled={!r.onLabelPress}
                  onPress={r.onLabelPress}
                  accessibilityRole={r.onLabelPress ? "link" : undefined}
                  accessibilityLabel={r.accessibilityLabel ?? r.label}
                  style={[{ width: headWidth, alignItems: "flex-start", paddingVertical: spacing.xs }, cellCenter]}
                >
                  <Text
                    testID="table-row-label"
                    accessible={!r.onLabelPress}
                    accessibilityLabel={r.accessibilityLabel ?? r.label}
                    numberOfLines={r.truncateLabel ? 2 : undefined}
                    ellipsizeMode={r.truncateLabel ? "tail" : undefined}
                    style={[type.label, { color: r.onLabelPress ? palette.primaryText : palette.text, textAlign: "left", fontFamily: r.labelHighlight ? font.bold : font.semibold }]}
                    onLayout={(event) => measureLabel(`row:${r.key}`, event.nativeEvent.layout.height)}
                  >
                    {r.truncateLabel ? r.label : softWrapLabel(r.label, headWidth < 80 ? 8 : 12)}
                  </Text>
                  {r.icon ? (
                    <View style={{ position: "absolute", bottom: 4, right: 4 }}>
                      <r.icon accessible={false} size={11} color={palette.textSecondary} strokeWidth={2.2} />
                    </View>
                  ) : null}
                </Pressable>
                {pinnedCol ? <View style={{ width: cellWidth, justifyContent: "center" }}>{r.cells[pinnedIndex]}</View> : null}
              </View>
            ))}
          </View>

          <ScrollView
            ref={bodyHRef}
            testID="table-horizontal-body"
            horizontal
            showsHorizontalScrollIndicator
            scrollEventThrottle={16}
            onScroll={onBodyScroll}
            onLayout={(e: LayoutChangeEvent) => setBodyW(e.nativeEvent.layout.width)}
            style={{ flex: 1 }}
          >
            <View>
              {rows.map((r, ri) => (
                <View
                  key={r.key}
                  style={{
                    flexDirection: "row",
                    minHeight: resolvedRowHeights[ri],
                    backgroundColor: rowBg(ri, r.rowHighlight),
                    borderBottomWidth: ri === rows.length - 1 ? 0 : 1,
                    borderColor: palette.border,
                  }}
                >
                  {scrollCols.map((c) => {
                    const idx = colIndexByKey.get(c.key)!;
                    return (
                      <View
                        key={c.key}
                        style={{
                          width: cellWidth,
                          justifyContent: "center",
                          backgroundColor: c.key === currentColumnKey ? palette.primarySoft + "2E" : "transparent",
                          borderLeftWidth: c.key === currentColumnKey ? 1 : 0,
                          borderRightWidth: c.key === currentColumnKey ? 1 : 0,
                          borderColor: palette.primary + "70",
                        }}
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

function PinnedHeader({
  label,
  accessibilityLabel,
  truncateLabel,
  width,
  onUnpin,
  onHeight,
}: {
  label: string;
  accessibilityLabel?: string;
  truncateLabel?: boolean;
  width: number;
  onUnpin?: () => void;
  onHeight: (textHeight: number) => void;
}) {
  const { palette } = useTheme();
  const compactHeader = width < 104;
  return (
    <Pressable
      disabled={!onUnpin}
      onPress={onUnpin ? () => { selectionTap(); onUnpin(); } : undefined}
      accessibilityRole={onUnpin ? "button" : undefined}
      accessibilityLabel={onUnpin ? tr.a11y.unpinColumn(accessibilityLabel ?? label) : undefined}
      style={{
        width,
        justifyContent: "center",
        paddingLeft: compactHeader ? spacing.xs : STICKY_MARKER_W,
        paddingRight: compactHeader ? STICKY_MARKER_W - 6 : STICKY_MARKER_W,
        paddingVertical: spacing.xs,
        alignItems: "center",
      }}
    >
      <Text
        testID="table-column-label"
        accessibilityLabel={accessibilityLabel ?? label}
        numberOfLines={truncateLabel ? 2 : undefined}
        ellipsizeMode={truncateLabel ? "tail" : undefined}
        style={[
          type.label,
          {
            color: palette.primaryText,
            fontSize: compactHeader ? 12 : type.label.fontSize,
            textAlign: "center",
            minWidth: 0,
            maxWidth: "100%",
          },
        ]}
        onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
      >
        {truncateLabel ? label : softWrapLabel(label, width < 80 ? 8 : width < 104 ? 10 : 12)}
      </Text>
      <View style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: STICKY_MARKER_W, alignItems: "center", justifyContent: "center" }}>
        <Pin accessible={false} size={11} color={palette.primary} fill={palette.primary} />
      </View>
    </Pressable>
  );
}
