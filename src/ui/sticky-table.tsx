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
import { Platform, Pressable, ScrollView, Text, View, type LayoutChangeEvent, type NativeSyntheticEvent, type NativeScrollEvent, type ViewProps } from "react-native";
import Pin from "lucide-react-native/icons/pin";
import type { LucideIcon } from "lucide-react-native";
import { selectionTap } from "./haptics";
import { interactionSurface } from "./interaction";
import { tr } from "../i18n/tr";
import { fittedCellWidth, isCompactTableCell, tableLabelCharBudget, usesCoarsePointerTable } from "./responsive";
import { nextGridPosition } from "./grid-navigation";
import { font, maxFontScale, spacing, stateOpacity, type, useTheme, type Palette } from "./theme";

/** Default fixed metrics; exported so callers can size a table to its content. */
export const STICKY_ROW_HEIGHT = 52;
export const STICKY_HEADER_HEIGHT = 56;
/** Current-month wash: alpha over `primary` (`primarySoft` is near-black in dark themes and vanishes). One constant so row and column agree. */
export const CURRENT_TINT = "26";

/** Fixed right-hand strip holding a header's pin. */
const STICKY_MARKER_W = 24;
/** The pin's target under a coarse pointer: wider than 24, short of 44 because the strip shares a ~134px column with the label. */
const STICKY_MARKER_TOUCH_W = 32;

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

/** Wrap user-authored names, but at most three lines; the full text stays in the accessible label. */
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

/** `dataSet` is react-native-web's data-attribute channel; RN's types omit it. */
function stickyCellId(rowKey: string, columnKey: string): ViewProps {
  return { dataSet: { stickyCell: `${rowKey}\u0000${columnKey}` } } as unknown as ViewProps;
}

function getNode(ref: React.RefObject<ScrollView | null>): HTMLElement | null {
  return (ref.current as unknown as { getScrollableNode?: () => HTMLElement } | null)?.getScrollableNode?.() ?? null;
}

/** How long after the last scroll event the web considers a drag finished. */
const WEB_SCROLL_SETTLE_MS = 140;

/** Web-only pan, keyboard scroll and snap-to-cell: react-native-web does not implement `snapToInterval`, and a half-covered cell reads as a different amount. */
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
      vNode.style.cursor = "";
    };
  }, [vRef, bodyHRef, headerHRef, rowHeight, cellWidth]);
}

/** Header chrome shared by the scrolling and pinned rails, so a state cannot exist in one and not the other. Border width is constant across states so labels share a baseline. */
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


/** Arrow-key navigation and a single tab stop; DOM-driven so a keypress does not re-render every cell. */
function useGridKeyboard(
  gridRef: React.RefObject<View | null>,
  rowCount: number,
  columnCount: number,
): void {
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const grid = gridRef.current as unknown as HTMLElement | null;
    if (!grid || typeof window === "undefined") return;

    const cells = () => Array.from(grid.querySelectorAll<HTMLElement>("[data-sticky-cell]"));
    const coordsOf = (node: HTMLElement): [string, string] | null => {
      const raw = node.dataset.stickyCell;
      if (!raw) return null;
      const [row, column] = raw.split("\u0000");
      return row != null && column != null ? [row, column] : null;
    };
    const focusCell = (target: HTMLElement | undefined) => {
      if (!target) return false;
      // The value inside a cell is the pressable; focus that when it exists so
      // Enter still opens the cell, and fall back to the wrapper for a system
      // column that has nothing to open.
      const inner = target.querySelector<HTMLElement>('[tabindex], [role="button"], [role="group"]');
      const node = inner ?? target;
      node.tabIndex = -1;
      node.focus({ preventScroll: false });
      return true;
    };

    /** The distinct row and column keys, in the order the grid paints them. */
    const axes = (all: HTMLElement[]) => {
      const rowKeys: string[] = [];
      const columnKeys: string[] = [];
      for (const cell of all) {
        const at = coordsOf(cell);
        if (!at) continue;
        if (!rowKeys.includes(at[0])) rowKeys.push(at[0]);
        if (!columnKeys.includes(at[1])) columnKeys.push(at[1]);
      }
      return { rowKeys, columnKeys };
    };

    /** Move from the cell that has focus to its neighbour. */
    const moveFrom = (current: HTMLElement, all: HTMLElement[], event: KeyboardEvent): boolean => {
      const here = coordsOf(current);
      if (!here) return false;
      const { rowKeys, columnKeys } = axes(all);
      const at = { row: rowKeys.indexOf(here[0]), column: columnKeys.indexOf(here[1]) };
      if (at.row < 0 || at.column < 0) return false;
      const next = nextGridPosition(
        { key: event.key, toEnds: event.ctrlKey || event.metaKey },
        at,
        { rows: rowKeys.length, columns: columnKeys.length },
      );
      if (!next) return false;
      const wanted = `${rowKeys[next.row]}\u0000${columnKeys[next.column]}`;
      return focusCell(all.find((cell) => cell.dataset.stickyCell === wanted));
    };

    const onKey = (event: KeyboardEvent) => {
      const all = cells();
      if (all.length === 0) return;
      const current = (document.activeElement as HTMLElement | null)
        ?.closest<HTMLElement>("[data-sticky-cell]") ?? null;
      // Entering the grid from the scroller: the first arrow press lands on the
      // first cell rather than scrolling past everything.
      const moved = current
        ? moveFrom(current, all, event)
        : (event.key === "ArrowDown" || event.key === "ArrowRight") && focusCell(all[0]);
      if (moved) event.preventDefault();
    };

    grid.addEventListener("keydown", onKey);
    return () => grid.removeEventListener("keydown", onKey);
    // Re-bound when the grid's shape changes so a resized table keeps working.
  }, [gridRef, rowCount, columnCount]);
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
  const gridRef = useRef<View>(null);
  const ownVRef = useRef<ScrollView>(null);
  const vRef = scrollRef ?? ownVRef;
  const bodyHRef = useRef<ScrollView>(null);
  const headerHRef = useRef<ScrollView>(null);
  const [bodyW, setBodyW] = useState(0);
  const [tableW, setTableW] = useState(0);
  // Fit cells to the measured table minus the label rail, never to the body scroller: a pinned column would make the width depend on itself. See `fittedCellWidth`.
  const cellWidth = fittedCellWidth(Math.max(0, tableW - headWidth), requestedCellWidth);

  useWebInteractions(vRef, bodyHRef, headerHRef, rowHeight, cellWidth);
  const [bodyViewH, setBodyViewH] = useState(0);
  const [labelHeights, setLabelHeights] = useState<Record<string, number>>({});
  const horizontalFocusSig = useRef("");
  const verticalFocusSig = useRef("");

  // Batch every label's onLayout into one state update per frame.
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

  /**
   * Which column's pin the pointer is on, if any.
   *
   * The pin reports its pointer instead of painting: the header it belongs to
   * is the surface that lights, so a column is one lit cell whether the
   * pointer is on its name or on its pin. See `interactionSurface`'s `hovered`
   * for why the nesting alone cannot do this.
   */
  const [hoveredPinKey, setHoveredPinKey] = useState<string | null>(null);
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

  // A scrolled financial grid must not rest on a half-covered cell: the label rail hides the left of an amount. `snapToInterval` keeps drags on the cell grid.
  const visibleCells = bodyW > 0 ? Math.max(1, Math.floor(bodyW / cellWidth)) : 0;
  // The far end is where the content ends; only the very end may rest mid-cell (a spacer left a visible hole, a wider last column misread as data).
  const maxScrollX = Math.max(0, scrollCols.length * cellWidth - visibleCells * cellWidth);

  // Center the current month on open (clamped at the edges). When the pivot
  // changes back to row-focused mode there is no horizontal focus target, so
  // reset to the first category; otherwise the recycled ScrollView keeps the
  // old July offset and opens halfway through an unrelated category list.
  useEffect(() => {
    if (bodyW <= 0) return;
    // Keyed on the focus target and columns only: keying on measured widths re-fired on pin and fought the user's drag.
    const sig = `${focusColumnKey}|${scrollColumnsSignature}`;
    if (horizontalFocusSig.current === sig) return;
    let target = 0;
    if (focusColumnKey) {
      const idx = scrollCols.findIndex((c) => c.key === focusColumnKey);
      if (idx >= 0) {
        const centered = idx * cellWidth + cellWidth / 2 - bodyW / 2;
        // Whole-cell offsets everywhere; a fractional clamp let the label rail cover the left of an amount.
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

  const rowBg = (highlight?: boolean) =>
    highlight ? palette.primary + CURRENT_TINT : "transparent";

  // Body horizontal scroll drives the header's offset (native + web).
  const onBodyScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    headerHRef.current?.scrollTo({ x: e.nativeEvent.contentOffset.x, animated: false });
  };

  // Native is always a finger; a compact table is the layout a phone browser
  // gets. Either way the pin's target grows (see STICKY_MARKER_TOUCH_W).
  const coarsePointer = usesCoarsePointerTable(cellWidth, Platform.OS === "web");

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
    const compactHeader = isCompactTableCell(cellWidth);
    const markerWidth = both && c.icon ? 40 : coarsePointer ? STICKY_MARKER_TOUCH_W : STICKY_MARKER_W;
    const hasMarker = both || !!c.icon;
    return (
      <View
        key={c.key}
        style={{
          width: cellWidth,
          height: resolvedHeaderHeight,
          backgroundColor: "transparent",
          justifyContent: "center",
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
          // The pressable owns its padding so the hover fill reaches the cell edges.
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
            ...interactionSurface(palette, state, {
              enabled: Boolean(labelAction),
              hovered: hoveredPinKey === c.key,
            }),
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
            {softWrapLabel(c.label, tableLabelCharBudget(cellWidth))}
          </Text>
        </Pressable>
        {hasMarker ? markerStrip(c, markerWidth) : null}
      </View>
    );
  };

  /** Sigma and pin marks: a sibling of the label pressable (nesting is nested-interactive), painting no fill of its own so one cell lights once. */
  const markerStrip = (c: StickyColumn, markerWidth: number) => (
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
      {!!onColumnPress && !!onTogglePin ? (
        <Pressable
          onPress={() => { selectionTap(); onTogglePin(c.key); }}
          onHoverIn={() => setHoveredPinKey(c.key)}
          onHoverOut={() => setHoveredPinKey((current) => (current === c.key ? null : current))}
          accessibilityRole="button"
          accessibilityLabel={pinnedKey === c.key ? tr.a11y.unpinColumn(c.accessibilityLabel ?? c.label) : tr.a11y.pinColumn(c.accessibilityLabel ?? c.label)}
          // 24 under a mouse, 32 under a finger. Pressed dims the mark; it never paints a hover fill inside the lit header.
          style={({ pressed }) => ({
            width: coarsePointer ? STICKY_MARKER_TOUCH_W : STICKY_MARKER_W,
            alignSelf: "stretch",
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? stateOpacity.pressed : 1,
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
  );

  /** One cell box for both rails, so a pinned cell cannot drift from its scrolling self. */
  const bodyCell = (column: StickyColumn, row: StickyRow) => {
    const index = colIndexByKey.get(column.key);
    if (index === undefined) return null;
    const isCurrent = column.key === currentColumnKey;
    return (
      <View
        key={column.key}
        // The coordinates arrow-key navigation reads back out of the DOM. The
        // cell nodes themselves are built by the screen and handed here as
        // opaque children, so the wrapper — the one box a cell always sits in,
        // pinned or scrolling — is where the grid can address them.
        {...stickyCellId(row.key, column.key)}
        style={{
          width: cellWidth,
          justifyContent: "center",
          // The wash belongs to the CELL, which paints it above its own colour
          // mark; painting it here as well tinted the current month twice in
          // this orientation and once in the other. The rules stay: they say
          // where the month ENDS, which a row gets for free from the table's
          // own edge.
          backgroundColor: "transparent",
          borderLeftWidth: isCurrent ? 1 : 0,
          borderRightWidth: isCurrent ? 1 : 0,
          borderColor: palette.primary + "70",
        }}
      >
        {row.cells[index]}
      </View>
    );
  };

  useGridKeyboard(gridRef, rows.length, columns.length);

  return (
    <View
      ref={gridRef}
      // One tab stop and arrow keys, but no role="grid": a visual row is two DOM subtrees, which fails aria-required-children. Each cell names month, column and value instead.
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
          </View>
        </ScrollView>
      </View>

      {/* Body: fixed-left labels (+ pinned col) beside a horizontally-scrolling
          data grid; the whole body scrolls vertically as one. */}
      {/* Both scrollers are keyboard-reachable from the first paint (axe
          `scrollable-region-focusable`); a tabindex set later from an effect lost
          the race to an audit under load. The body scroller sits inside this
          one, so its arrow keys still bubble to the handler. */}
      <ScrollView
        ref={vRef}
        focusable={Platform.OS === "web"}
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
                  backgroundColor: rowBg(r.rowHighlight),
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
                    {softWrapLabel(r.label, tableLabelCharBudget(headWidth, { twoStep: true }))}
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
            focusable={Platform.OS === "web"}
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
                    // `height`, not `minHeight`: the label half sizes the row.
                    height: resolvedRowHeights[ri],
                    // The row paints no wash; the cell is the only painter.
                    backgroundColor: "transparent",
                    borderBottomWidth: ri === rows.length - 1 ? 0 : 1,
                    borderColor: palette.border,
                  }}
                >
                  {scrollCols.map((c) => bodyCell(c, r))}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

/** Pinned header: keeps both actions of a scrolling header — pinning must not remove what a column can do. */
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
  const compactHeader = isCompactTableCell(width);
  const chrome = headerChrome(palette, { isCurrent, markEdge });
  // The unpin mark reports its pointer; the header is what lights. Same rule
  // as the scrolling rail, because pinning must not change how a column looks.
  const [unpinHovered, setUnpinHovered] = useState(false);
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
          ...interactionSurface(palette, state, { enabled: Boolean(labelAction), hovered: unpinHovered }),
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
          {softWrapLabel(label, tableLabelCharBudget(width))}
        </Text>
      </Pressable>
      {/* A SIBLING of the label's pressable, exactly as the scrolling header
          does it: pinning must not change what a column looks like, and a
          marker that behaved differently in one rail is precisely that. */}
      <View style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: STICKY_MARKER_W, alignItems: "center", justifyContent: "center" }}>
        {separateUnpin && onUnpin ? (
          <Pressable
            onPress={() => { selectionTap(); onUnpin(); }}
            onHoverIn={() => setUnpinHovered(true)}
            onHoverOut={() => setUnpinHovered(false)}
            accessibilityRole="button"
            accessibilityLabel={tr.a11y.unpinColumn(accessibilityLabel ?? label)}
            // Same rule as the scrolling rail: the column's own hover is the
            // only fill, and the mark answers a press by dimming.
            style={({ pressed }) => ({
              width: STICKY_MARKER_W,
              alignSelf: "stretch",
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? stateOpacity.pressed : 1,
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
