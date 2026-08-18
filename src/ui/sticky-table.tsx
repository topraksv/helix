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

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View, type LayoutChangeEvent, type NativeSyntheticEvent, type NativeScrollEvent } from "react-native";
import Pin from "lucide-react-native/icons/pin";
import type { LucideIcon } from "lucide-react-native";
import { selectionTap } from "./haptics";
import { interactionSurface } from "./interaction";
import { tr } from "../i18n/tr";
import { fittedCellWidth } from "./responsive";
import { font, maxFontScale, spacing, type, useTheme, type Palette } from "./theme";

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
      const characters = Array.from(part);
      if (!part.trim() || characters.length <= maxTokenLength) return part;
      // Preserve a natural Turkish plural boundary where one exists. For all
      // other long tokens, balance the chunks instead of leaving an orphaned
      // final letter (`Faturala / r`, `Cumhuriy / et`).
      const plural = part.match(/^(.{4,}?)(lar|ler)$/iu);
      if (plural) return `${plural[1]}\u200B${plural[2]}`;
      const chunkCount = Math.ceil(characters.length / maxTokenLength);
      const chunkLength = Math.ceil(characters.length / chunkCount);
      const chunks: string[] = [];
      for (let start = 0; start < characters.length; start += chunkLength) {
        chunks.push(characters.slice(start, start + chunkLength).join(""));
      }
      return chunks.join("\u200B");
    })
    .join("");
}

/**
 * How many lines a user-authored item name may take before it is shortened.
 *
 * Unbounded wrapping was the first answer to the ellipsis ban and it hands the
 * table's geometry to whatever someone types: one 400-character "category"
 * pushes every row off the screen. Three lines is more than any real
 * income-expense item needs — "Sağlık ve Özel Sigorta Katkı Payı" fits in two —
 * and the full text stays in the accessible label either way.
 */
const LABEL_MAX_LINES = 3;

export interface StickyColumn {
  key: string;
  /** Full spoken name when the compact visible label is abbreviated. */
  accessibilityLabel?: string;
  label: string;
  /** Optional marker icon shown top-left of the header (e.g. a computed column). */
  icon?: LucideIcon;
  /** A saturated rule under the header, when the column carries a mark. */
  markEdge?: string;
}

export interface StickyRow {
  key: string;
  /** Sticky first-column label. */
  label: string;
  /** Full spoken name when the visible label omits context such as the year. */
  accessibilityLabel?: string;
  /** Optional marker icon shown top-left of the label (e.g. a computed row).
   *  Mirrors StickyColumn.icon so the two orientations look identical. */
  icon?: LucideIcon;
  onLabelPress?: () => void;
  labelHighlight?: boolean;
  rowHighlight?: boolean;
  /** A saturated rule beside the label, when the row carries a mark. */
  markEdge?: string;
  /** One node per column (same order/length as `columns`). */
  cells: React.ReactNode[];
}

function getNode(ref: React.RefObject<ScrollView | null>): HTMLElement | null {
  return (ref.current as unknown as { getScrollableNode?: () => HTMLElement } | null)?.getScrollableNode?.() ?? null;
}

/** How long after the last scroll event the web considers a drag finished. */
const WEB_SCROLL_SETTLE_MS = 140;

/**
 * Web-only: grab-to-pan (both axes), arrow/Page keyboard scrolling, and the
 * snap-to-cell that `snapToInterval` provides on native and nowhere else. The
 * header mirrors the body's horizontal offset, so panning updates both.
 *
 * `snapToInterval` is not implemented in react-native-web at all — its
 * `ScrollView` maps only `pagingEnabled` onto `scroll-snap-type`
 * (`dist/exports/ScrollView/index.js`). So the rule this table exists to
 * enforce — a financial grid never rests on a half-covered cell, because the
 * sticky label column hides the left of an amount and `₺14.500,00` reads as
 * `4.500,00` — held on the phone app and not in the browser, where a dragged
 * scroll measured 722px on an 87px grid. One behaviour, both platforms.
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
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const snapToCell = () => {
      if (!bodyNode || cellWidth <= 0) return;
      const maxLeft = Math.max(0, bodyNode.scrollWidth - bodyNode.clientWidth);
      const target = Math.min(Math.round(bodyNode.scrollLeft / cellWidth) * cellWidth, maxLeft);
      if (Math.abs(target - bodyNode.scrollLeft) < 1) return;
      bodyNode.scrollTo({ left: target, behavior: "smooth" });
    };
    // The browser gives no momentum-end event that all of Helix's targets
    // support, so the settle is measured: a scroll that has been quiet for
    // longer than a frame budget has finished.
    const onBodyScroll = () => {
      if (dragging) return;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(snapToCell, WEB_SCROLL_SETTLE_MS);
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
      if (!dragging) return;
      dragging = false;
      vNode.style.cursor = "grab";
      snapToCell();
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
    bodyNode?.addEventListener("scroll", onBodyScroll, { passive: true });
    return () => {
      vNode.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      vNode.removeEventListener("keydown", onKey);
      bodyNode?.removeEventListener("scroll", onBodyScroll);
      if (settleTimer) clearTimeout(settleTimer);
      vNode.removeAttribute("tabindex");
      bodyNode?.removeAttribute("tabindex");
      vNode.style.cursor = "";
    };
  }, [vRef, bodyHRef, headerHRef, rowHeight, cellWidth]);
}

/**
 * The chrome a column header wears, whatever rail it is drawn in.
 *
 * Two headers render a column — the scrolling one and the pinned one — and
 * every state they can be in has to look the same in both. It did not: the
 * pinned header knew nothing about `currentColumnKey`, so pinning the current
 * month silently dropped its 3px underline and repainted its label, which
 * reads as the pin having changed WHICH month is current. One function, so a
 * state cannot exist in one rail and not the other.
 *
 * The border width is constant across states on purpose. A header that gains
 * or loses a rule when it is pinned, marked or current moves its own text by
 * those pixels, and a row of headers then sits at two different baselines.
 */
function headerChrome(
  palette: Palette,
  { isCurrent, markEdge }: { isCurrent: boolean; markEdge?: string },
): { borderBottomWidth: number; borderBottomColor: string; labelColor: string } {
  return {
    // Always reserved, never toggled: the colour carries the state.
    borderBottomWidth: 3,
    borderBottomColor: isCurrent ? palette.primary : markEdge ?? "transparent",
    labelColor: isCurrent ? palette.primaryText : palette.textSecondary,
  };
}

export function StickyTable({
  cornerLabel,
  columns,
  rows,
  headWidth = 116,
  headHorizontalPadding = spacing.sm,
  cellWidth: requestedCellWidth = 120,
  rowHeight = STICKY_ROW_HEIGHT,
  headerHeight = STICKY_HEADER_HEIGHT,
  pinnedKey,
  onTogglePin,
  onColumnPress,
  onColumnLongPress,
  onRowLongPress,
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
  /** Hold a header or a row label to act on the whole column/row. */
  onColumnLongPress?: (key: string) => void;
  onRowLongPress?: (key: string) => void;
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
  const [bodyW, setBodyW] = useState(0);
  const [tableW, setTableW] = useState(0);
  // The screen that owns this table sizes a cell so a whole number of them fits
  // the width it *estimates*. That estimate is off by the container's own
  // hairlines — measured at 320px it was 176 against a real 174 — and two pixels
  // are enough to leave the last column clipped at the right edge for ever.
  //
  // What is measured is the whole table minus the label rail, never the body
  // scroller: a pinned column is drawn beside the labels, so fitting to the body
  // made the cell width depend on a measurement the cell width had just changed.
  // `fittedCellWidth` carries the arithmetic and the evidence. `bodyW` is still
  // measured below, but only for scroll geometry, which nothing lays out from.
  const cellWidth = fittedCellWidth(Math.max(0, tableW - headWidth), requestedCellWidth);

  useWebInteractions(vRef, bodyHRef, headerHRef, rowHeight, cellWidth);
  const [bodyViewH, setBodyViewH] = useState(0);
  const [labelHeights, setLabelHeights] = useState<Record<string, number>>({});
  const horizontalFocusSig = useRef("");
  const verticalFocusSig = useRef("");

  // Every column header and row label reports its own height via `onLayout`.
  // On first mount that is ~38 calls (25 columns + 12 rows + the corner), and
  // each used to be its own `setLabelHeights` — ~38 re-renders of the whole
  // non-virtualized grid before anything settled, repeating on every pivot or
  // year change. Accumulate in a ref (no render) and flush once per frame, so
  // the whole storm collapses to one state update per animation frame.
  const labelHeightsRef = useRef<Record<string, number>>({});
  const labelFlushHandle = useRef<number | null>(null);
  const mountedRef = useRef(true);
  // Re-armed on setup, not only cleared on teardown: an effect that runs twice
  // (StrictMode, fast refresh) would otherwise leave the flag false forever and
  // silently stop every later flush, freezing the table at its default heights.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (labelFlushHandle.current != null) cancelAnimationFrame(labelFlushHandle.current);
    };
  }, []);
  const measureLabel = useCallback((key: string, textHeight: number, extraHeight = 0) => {
    const measured = Math.ceil(textHeight + spacing.xs * 2 + extraHeight);
    if (labelHeightsRef.current[key] === measured) return;
    labelHeightsRef.current[key] = measured;
    if (labelFlushHandle.current != null) return;
    labelFlushHandle.current = requestAnimationFrame(() => {
      labelFlushHandle.current = null;
      if (!mountedRef.current) return;
      setLabelHeights({ ...labelHeightsRef.current });
    });
  }, []);

  const pinnedIndex = pinnedKey ? columns.findIndex((c) => c.key === pinnedKey) : -1;
  const pinnedCol = pinnedIndex >= 0 ? columns[pinnedIndex] : null;
  const scrollCols = columns.filter((_, i) => i !== pinnedIndex);
  const colIndexByKey = new Map(columns.map((c, i) => [c.key, i]));
  const cellCenter = { justifyContent: "center" as const, paddingHorizontal: headHorizontalPadding };
  const leftWidth = headWidth + (pinnedCol ? cellWidth : 0);
  const headerKeys = ["header:corner", ...columns.map((column) => `header:${column.key}`)];
  const resolvedHeaderHeight = Math.max(headerHeight, ...headerKeys.map((key) => labelHeights[key] ?? 0));
  const resolvedRowHeights = rows.map((row) => Math.max(rowHeight, labelHeights[`row:${row.key}`] ?? 0));
  const rowHeightsSignature = resolvedRowHeights.join("|");

  const scrollColumnsSignature = scrollCols.map((column) => column.key).join("|");

  // A horizontally scrolled financial grid must never rest on a half-covered
  // cell: the sticky label column hides the left part of an amount, and what
  // is left reads as a smaller but perfectly valid figure. The viewport shows
  // a whole number of cells, the trailing spacer makes the last cell reachable
  // at a whole-cell offset, and `snapToInterval` keeps a dragged scroll on the
  // same grid.
  const visibleCells = bodyW > 0 ? Math.max(1, Math.floor(bodyW / cellWidth)) : 0;
  // Absorbs the leftover so the far end is reachable on the cell grid. Clamping
  // the viewport itself to whole cells was tried and rejected: at 320px only one
  // 88px month fits, so it threw away up to 87px of a phone to avoid a partial
  // cell at the right edge — where an amount is right-aligned and a clipped one
  // ends mid-digit rather than reading as a smaller valid figure. The left edge
  // is the dangerous one, and snapping keeps it exact.
  const trailingSpacer = bodyW > 0 ? bodyW - visibleCells * cellWidth : 0;
  const maxScrollX = Math.max(0, scrollCols.length * cellWidth - visibleCells * cellWidth);

  // Center the current month on open (clamped at the edges). When the pivot
  // changes back to row-focused mode there is no horizontal focus target, so
  // reset to the first category; otherwise the recycled ScrollView keeps the
  // old July offset and opens halfway through an unrelated category list.
  useEffect(() => {
    if (bodyW <= 0) return;
    // The signature is what the user asked for — a focus target and a set of
    // columns — not how wide the body measured. It used to include `bodyW` and
    // `cellWidth`, and pinning a column changes both: the sticky side grows by
    // one cell, the body shrinks, the fitted cell width recomputes, and each of
    // those re-fired this effect and yanked the scroll back to the focused
    // month. That is the shake, and it is why the table could not be dragged
    // sideways while a column was pinned — every drag was overwritten on the
    // next render.
    const sig = `${focusColumnKey}|${scrollColumnsSignature}`;
    if (horizontalFocusSig.current === sig) return;
    let target = 0;
    if (focusColumnKey) {
      const idx = scrollCols.findIndex((c) => c.key === focusColumnKey);
      if (idx >= 0) {
        const centered = idx * cellWidth + cellWidth / 2 - bodyW / 2;
        // Every resting offset is a whole number of cells, including the one at
        // the far end. The clamp used to be `contentW - bodyW`, which is a
        // fractional offset whenever the viewport is not an exact multiple of
        // the cell — and focusing a month near the end hits that clamp. The
        // sticky label column then covered the left part of a real amount, so
        // `₺14.500,00` rendered as `4.500,00`: not a clipped number, a
        // different and entirely plausible one. The trailing spacer below is
        // what makes this maximum reachable.
        target = Math.max(0, Math.min(Math.round(centered / cellWidth) * cellWidth, maxScrollX));
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
    const chrome = headerChrome(palette, { isCurrent, markEdge: c.markEdge });
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
          // The current month keeps its own 3px rule; a marked column shows a
          // 2px one in its token colour, so the two are never confused and a
          // column can carry both facts at once.
          borderBottomWidth: chrome.borderBottomWidth,
          borderBottomColor: chrome.borderBottomColor,
        }}
      >
        <Pressable
          disabled={!labelAction && !onColumnLongPress}
          onPress={labelAction ? () => {
            if (!onColumnPress && onTogglePin) selectionTap();
            labelAction(c.key);
          } : undefined}
          onLongPress={onColumnLongPress ? () => { selectionTap(); onColumnLongPress(c.key); } : undefined}
          accessibilityRole={labelAction ? "button" : undefined}
          accessibilityLabel={labelAction ? c.accessibilityLabel ?? c.label : undefined}
          // Fill the header band: wrapping only the label left a full-width but
          // 16px-tall tap target on the app's primary financial surface.
          //
          // The padding is HERE and not on the cell around it. Held by the
          // wrapper it kept the pressable 86x48 inside a 134x56 header, so the
          // hover fill floated in the middle of the cell with an unlit margin
          // on all four sides — the rule is that the pressable owns its padding
          // and the box around it owns only position.
          style={(state) => ({
            flex: 1,
            alignSelf: "stretch",
            justifyContent: "center",
            paddingLeft: compactHeader ? spacing.xs : hasMarker ? markerWidth : spacing.xs,
            // The pin keeps a 24px measured web target, but its glyph occupies
            // only the trailing 12px. Let compact copy use the transparent part
            // of that target so ordinary words stay whole without shrinking the
            // number of visible financial columns.
            paddingRight: hasMarker ? (compactHeader ? markerWidth - 6 : markerWidth) : spacing.xs,
            paddingVertical: spacing.xs,
            ...interactionSurface(palette, state, { enabled: Boolean(labelAction) }),
          })}
        >
          <Text
            testID="table-column-label"
            accessibilityLabel={c.accessibilityLabel ?? c.label}
            maxFontSizeMultiplier={maxFontScale.measuredBox}
            numberOfLines={LABEL_MAX_LINES}
            ellipsizeMode="tail"
            style={[
              type.label,
              {
                color: chrome.labelColor,
                fontSize: compactHeader ? type.small.fontSize : type.label.fontSize,
                textAlign: "center",
                flexShrink: 1,
                minWidth: 0,
                maxWidth: "100%",
              },
            ]}
            onLayout={(event) => measureLabel(`header:${c.key}`, event.nativeEvent.layout.height)}
          >
            {softWrapLabel(c.label, cellWidth < 80 ? 8 : cellWidth < 104 ? 10 : 12)}
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
                accessibilityRole="button"
                accessibilityLabel={pinnedKey === c.key ? tr.a11y.unpinColumn(c.accessibilityLabel ?? c.label) : tr.a11y.pinColumn(c.accessibilityLabel ?? c.label)}
                // The mark stays 12px; the box it can be hit in is the whole
                // header band, which is 56pt tall. `hitSlop` used to carry that
                // and does nothing on the web, where the pin really was a 24x24
                // target sitting between two amounts. The width stays inside
                // the marker strip — wider, it crossed its own column's edge.
                style={(state) => ({
                  width: STICKY_MARKER_W,
                  alignSelf: "stretch",
                  alignItems: "center",
                  justifyContent: "center",
                  ...interactionSurface(palette, state),
                })}
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

  /**
   * The box one cell sits in — the SAME box whether that cell is scrolling or
   * pinned into the left rail.
   *
   * Pinning moves a column; it must not change the column. Two near-identical
   * wrappers is how that promise decays: the pinned copy had already lost the
   * current-month highlight, and every later cell-level affordance would have
   * had to be added twice or silently work in only one of the two places.
   * One function, so a pinned cell cannot drift from its scrolling self.
   */
  const bodyCell = (column: StickyColumn, row: StickyRow) => {
    const index = colIndexByKey.get(column.key);
    if (index === undefined) return null;
    const isCurrent = column.key === currentColumnKey;
    return (
      <View
        key={column.key}
        style={{
          width: cellWidth,
          justifyContent: "center",
          backgroundColor: isCurrent ? palette.primarySoft + "2E" : "transparent",
          borderLeftWidth: isCurrent ? 1 : 0,
          borderRightWidth: isCurrent ? 1 : 0,
          borderColor: palette.primary + "70",
        }}
      >
        {row.cells[index]}
      </View>
    );
  };

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setTableW(e.nativeEvent.layout.width)}
      style={height ? { height } : { flex: 1 }}
    >
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
              width={cellWidth}
              markEdge={pinnedCol.markEdge}
              isCurrent={pinnedCol.key === currentColumnKey}
              height={resolvedHeaderHeight}
              onPress={onColumnPress ? () => onColumnPress(pinnedCol.key) : undefined}
              onLongPress={onColumnLongPress ? () => onColumnLongPress(pinnedCol.key) : undefined}
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
          <View style={{ flexDirection: "row" }}>
            {scrollCols.map(headerCell)}
            {trailingSpacer > 0 ? <View style={{ width: trailingSpacer }} /> : null}
          </View>
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
                  disabled={!r.onLabelPress && !onRowLongPress}
                  onPress={r.onLabelPress}
                  onLongPress={onRowLongPress ? () => { selectionTap(); onRowLongPress(r.key); } : undefined}
                  accessibilityRole={r.onLabelPress ? "link" : undefined}
                  accessibilityLabel={r.accessibilityLabel ?? r.label}
                  style={(state) => [
                    // `alignSelf` stretches the label box to the row's measured
                    // height. Without it the fill was only as tall as the label
                    // plus its own padding, so hovering a two-line row lit a
                    // band floating inside it.
                    { width: headWidth, alignSelf: "stretch", alignItems: "flex-start", paddingVertical: spacing.xs },
                    r.markEdge ? { borderLeftWidth: 3, borderLeftColor: r.markEdge } : null,
                    cellCenter,
                    interactionSurface(palette, state, { enabled: Boolean(r.onLabelPress) }),
                  ]}
                >
                  <Text
                    testID="table-row-label"
                    accessible={!r.onLabelPress}
                    accessibilityLabel={r.accessibilityLabel ?? r.label}
                    maxFontSizeMultiplier={maxFontScale.measuredBox}
                    numberOfLines={LABEL_MAX_LINES}
                    ellipsizeMode="tail"
                    style={[type.label, { color: r.onLabelPress ? palette.primaryText : palette.text, textAlign: "left", fontFamily: r.labelHighlight ? font.bold : font.semibold }]}
                    onLayout={(event) => measureLabel(`row:${r.key}`, event.nativeEvent.layout.height)}
                  >
                    {softWrapLabel(r.label, headWidth < 80 ? 8 : 12)}
                  </Text>
                  {r.icon ? (
                    <View style={{ position: "absolute", bottom: 4, right: 4 }}>
                      <r.icon accessible={false} size={11} color={palette.textSecondary} strokeWidth={2.2} />
                    </View>
                  ) : null}
                </Pressable>
                {pinnedCol ? bodyCell(pinnedCol, r) : null}
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
            snapToInterval={cellWidth}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            style={{ flex: 1 }}
          >
            <View>
              {rows.map((r, ri) => (
                <View
                  key={r.key}
                  style={{
                    flexDirection: "row",
                    // `height`, not `minHeight`: the label half owns the row's
                    // size (it is the half that can wrap and the half that
                    // measures itself), and the body half takes exactly that.
                    // With both free to grow, a body cell a fraction taller than
                    // the label's estimate made the two halves disagree by a
                    // pixel — every row, so the first column and the months
                    // beside it were very slightly out of step all the way down.
                    height: resolvedRowHeights[ri],
                    backgroundColor: rowBg(ri, r.rowHighlight),
                    borderBottomWidth: ri === rows.length - 1 ? 0 : 1,
                    borderColor: palette.border,
                  }}
                >
                  {scrollCols.map((c) => bodyCell(c, r))}
                  {trailingSpacer > 0 ? <View style={{ width: trailingSpacer }} /> : null}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * The pinned column's header, in the fixed left rail.
 *
 * It carries the SAME two actions as a scrolling header (`headerCell`): the
 * label runs the column's own action, and the pin mark beside it toggles the
 * pin. Collapsing both into a single "unpin" Pressable is what made pinning
 * subtract an ability — a pinned month could no longer be opened from its
 * header, a pinned item could no longer open its breakdown, and the only way
 * back to either was to unpin first. Pinning fixes a column in place; it does
 * not change what the column can do.
 */
function PinnedHeader({
  label,
  accessibilityLabel,
  width,
  height,
  markEdge,
  isCurrent,
  onPress,
  onLongPress,
  onUnpin,
  onHeight,
}: {
  label: string;
  accessibilityLabel?: string;
  width: number;
  /** The measured header height, so a pinned header is exactly as tall as a
   *  scrolling one. Without it the two differed by the header row's own
   *  hairline and the whole header moved 1px when a column was pinned. */
  height: number;
  markEdge?: string;
  isCurrent: boolean;
  /** The column's own action (open the month, open the breakdown). */
  onPress?: () => void;
  onLongPress?: () => void;
  onUnpin?: () => void;
  onHeight: (textHeight: number) => void;
}) {
  const { palette } = useTheme();
  const compactHeader = width < 104;
  const chrome = headerChrome(palette, { isCurrent, markEdge });
  // With no column action to preserve, the whole header stays the unpin
  // target — the behaviour a pin-only table always had.
  const labelAction = onPress ?? onUnpin;
  const separateUnpin = Boolean(onPress && onUnpin);
  return (
    <View
      style={{
        width,
        height,
        justifyContent: "center",
        borderBottomWidth: chrome.borderBottomWidth,
        borderBottomColor: chrome.borderBottomColor,
      }}
    >
      <Pressable
        disabled={!labelAction && !onLongPress}
        onPress={labelAction ? () => { if (!onPress) selectionTap(); labelAction(); } : undefined}
        onLongPress={onLongPress ? () => { selectionTap(); onLongPress(); } : undefined}
        accessibilityRole={labelAction ? "button" : undefined}
        accessibilityLabel={
          labelAction
            ? onPress
              ? accessibilityLabel ?? label
              : tr.a11y.unpinColumn(accessibilityLabel ?? label)
            : undefined
        }
        style={(state) => ({
          flex: 1,
          alignSelf: "stretch",
          justifyContent: "center",
          paddingLeft: compactHeader ? spacing.xs : STICKY_MARKER_W,
          paddingRight: compactHeader ? STICKY_MARKER_W - 6 : STICKY_MARKER_W,
          paddingVertical: spacing.xs,
          alignItems: "center",
          ...interactionSurface(palette, state, { enabled: Boolean(labelAction) }),
        })}
      >
        <Text
          testID="table-column-label"
          accessibilityLabel={accessibilityLabel ?? label}
          maxFontSizeMultiplier={maxFontScale.measuredBox}
          numberOfLines={LABEL_MAX_LINES}
          ellipsizeMode="tail"
          style={[
            type.label,
            {
              color: chrome.labelColor,
              fontSize: compactHeader ? type.small.fontSize : type.label.fontSize,
              textAlign: "center",
              minWidth: 0,
              maxWidth: "100%",
            },
          ]}
          onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
        >
          {softWrapLabel(label, width < 80 ? 8 : width < 104 ? 10 : 12)}
        </Text>
      </Pressable>
      <View style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: STICKY_MARKER_W, alignItems: "center", justifyContent: "center" }}>
        {separateUnpin && onUnpin ? (
          <Pressable
            onPress={() => { selectionTap(); onUnpin(); }}
            accessibilityRole="button"
            accessibilityLabel={tr.a11y.unpinColumn(accessibilityLabel ?? label)}
            style={(state) => ({
              width: STICKY_MARKER_W,
              alignSelf: "stretch",
              alignItems: "center",
              justifyContent: "center",
              ...interactionSurface(palette, state),
            })}
          >
            <Pin accessible={false} size={11} color={palette.primary} fill={palette.primary} />
          </Pressable>
        ) : (
          <Pin accessible={false} size={11} color={palette.primary} fill={palette.primary} />
        )}
      </View>
    </View>
  );
}
