/**
 * Press-and-drag reorderable list, built on the built-in PanResponder +
 * Animated (no native gesture/reanimated deps, so it ships over-the-air).
 *
 * Only the grip handle starts a drag (its `panHandlers` are spread by the
 * caller onto a grip), so the rest of each row stays tappable. While dragging,
 * the grabbed row floats under the finger and the list reorders live as it
 * crosses neighbours; the new key order is committed on release.
 *
 * Rows are assumed to share one height (measured from the first row) — true for
 * the settings lists that use this, whose rows are structurally identical.
 */

import React, { useEffect, useRef, useState } from "react";
import { Animated, PanResponder, View, type GestureResponderHandlers, type LayoutChangeEvent } from "react-native";
import { GripVertical } from "lucide-react-native";
import { errorNotice, mediumTap, selectionTap } from "./haptics";
import { controlSize, elevation, layer, spacing, stateOpacity, useTheme } from "./theme";
import { tr } from "../i18n/tr";

export interface DragHandle {
  /** Spread onto the grip element to make it the drag initiator. */
  panHandlers: GestureResponderHandlers;
  /** True while this row is the one being dragged. */
  active: boolean;
  /** Screen-reader fallback (wired to the grip's increment/decrement actions),
   *  so reordering stays possible without a drag gesture. `moveBy` guards its
   *  own bounds, so no can-move flags are needed. */
  moveUp: () => void;
  moveDown: () => void;
}

export function DraggableList<T>({
  items,
  keyExtractor,
  onReorder,
  renderRow,
  onDragStateChange,
  disabled = false,
}: {
  items: T[];
  keyExtractor: (item: T) => string;
  /** Called with the new key order when a drag completes. */
  onReorder: (orderedKeys: string[]) => void | Promise<void>;
  renderRow: (item: T, handle: DragHandle, index: number) => React.ReactNode;
  /** Fires true when a drag starts and false when it ends, so the caller can
   *  freeze the surrounding ScrollView (otherwise it steals the vertical pan
   *  and the row never moves). */
  onDragStateChange?: (dragging: boolean) => void;
  /** Freeze dragging entirely (e.g. while a row is in inline-edit mode, when
   *  its taller height would corrupt the fixed-row-height drag math). */
  disabled?: boolean;
}) {
  const [order, setOrder] = useState<T[]>(items);
  const orderRef = useRef(order);
  orderRef.current = order;
  const draggingRef = useRef(false);
  const pendingOrderRef = useRef<string[] | null>(null);
  const latestItemsRef = useRef(items);
  latestItemsRef.current = items;
  const keyExtractorRef = useRef(keyExtractor);
  keyExtractorRef.current = keyExtractor;

  // A live query can render once with its old ordering after the drag ends but
  // before the async write is observable. Preserve the user's local order
  // through that window; otherwise the row visibly snaps back and the modal
  // feels as though dragging did nothing.
  useEffect(() => {
    if (draggingRef.current) return;
    const keyOf = keyExtractorRef.current;
    const incomingKeys = items.map(keyOf);
    const localKeys = orderRef.current.map(keyOf);
    const localKeySet = new Set(localKeys);
    const sameMembers = incomingKeys.length === localKeys.length
      && incomingKeys.every((key) => localKeySet.has(key));
    if (!sameMembers) {
      pendingOrderRef.current = null;
      setOrder(items);
      return;
    }

    const pending = pendingOrderRef.current;
    if (pending) {
      if (incomingKeys.every((key, index) => key === pending[index])) {
        pendingOrderRef.current = null;
        setOrder(items);
        return;
      }
      const incomingByKey = new Map(items.map((item) => [keyOf(item), item]));
      setOrder(pending.flatMap((key) => {
        const item = incomingByKey.get(key);
        return item ? [item] : [];
      }));
      return;
    }
    setOrder(items);
  }, [items]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const rowH = useRef(0);
  const dragY = useRef(new Animated.Value(0)).current;
  const startIndex = useRef(0);
  const curIndex = useRef(0);

  // Latest callbacks in a ref so the per-row PanResponder (created once) always
  // calls the current closures instead of stale first-render ones.
  const api = useRef({ begin: (_k: string) => {}, move: (_dy: number) => {}, end: () => {} });
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  api.current.begin = (key: string) => {
    if (disabledRef.current) return;
    const idx = orderRef.current.findIndex((it) => keyExtractor(it) === key);
    if (idx < 0 || rowH.current <= 0) return;
    draggingRef.current = true;
    startIndex.current = idx;
    curIndex.current = idx;
    dragY.setValue(0);
    setActiveKey(key);
    mediumTap(); // picked the row up
    onDragStateChange?.(true);
  };
  api.current.move = (dy: number) => {
    if (!draggingRef.current) return;
    const H = rowH.current;
    const n = orderRef.current.length;
    const target = Math.max(0, Math.min(n - 1, startIndex.current + Math.round(dy / H)));
    if (target !== curIndex.current) {
      const next = [...orderRef.current];
      const moved = next[curIndex.current];
      if (moved == null) return;
      next.splice(curIndex.current, 1);
      next.splice(target, 0, moved);
      curIndex.current = target;
      // Pan events can arrive faster than React renders. Update the imperative
      // snapshot now so the next event never reorders an already-stale array.
      orderRef.current = next;
      setOrder(next);
      selectionTap(); // crossed into a new slot
    }
    // Keep the floating row under the finger even though its flow slot changed.
    dragY.setValue((startIndex.current - curIndex.current) * H + dy);
  };
  const commitOrder = (orderedKeys: string[]) => {
    pendingOrderRef.current = orderedKeys;
    const incomingKeys = latestItemsRef.current.map(keyExtractorRef.current);
    if (incomingKeys.every((key, index) => key === orderedKeys[index])) pendingOrderRef.current = null;
    void Promise.resolve()
      .then(() => onReorder(orderedKeys))
      .catch(() => {
        pendingOrderRef.current = null;
        const source = latestItemsRef.current;
        orderRef.current = source;
        setOrder(source);
        errorNotice();
      });
  };

  api.current.end = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setActiveKey(null);
    dragY.setValue(0);
    const orderedKeys = orderRef.current.map(keyExtractorRef.current);
    commitOrder(orderedKeys);
    onDragStateChange?.(false);
  };

  const moveBy = (key: string, delta: -1 | 1) => {
    if (disabledRef.current || draggingRef.current) return;
    const current = orderRef.current;
    const index = current.findIndex((item) => keyExtractor(item) === key);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= current.length) return;
    const next = [...current];
    const item = next[index];
    const targetItem = next[target];
    if (item == null || targetItem == null) return;
    next[index] = targetItem;
    next[target] = item;
    orderRef.current = next;
    setOrder(next);
    selectionTap();
    commitOrder(next.map(keyExtractor));
  };

  return (
    <View>
      {order.map((item, i) => {
        const key = keyExtractor(item);
        return (
          <DraggableRow
            key={key}
            itemKey={key}
            first={i === 0}
            active={activeKey === key}
            dragY={dragY}
            api={api}
            onMeasureFirst={(h) => {
              if (h > 0) rowH.current = h;
            }}
            onMoveUp={() => moveBy(key, -1)}
            onMoveDown={() => moveBy(key, 1)}
          >
            {(handle) => renderRow(item, handle, i)}
          </DraggableRow>
        );
      })}
    </View>
  );
}

function DraggableRow({
  itemKey,
  first,
  active,
  dragY,
  api,
  onMeasureFirst,
  onMoveUp,
  onMoveDown,
  children,
}: {
  itemKey: string;
  first: boolean;
  active: boolean;
  dragY: Animated.Value;
  api: React.MutableRefObject<{ begin: (k: string) => void; move: (dy: number) => void; end: () => void }>;
  onMeasureFirst: (h: number) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  children: (handle: DragHandle) => React.ReactNode;
}) {
  const pan = useRef(
    PanResponder.create({
      // Capture the gesture on the grip before any ancestor ScrollView can, so
      // the vertical drag reorders the row instead of scrolling the page.
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => api.current.begin(itemKey),
      onPanResponderMove: (_e, g) => api.current.move(g.dy),
      onPanResponderRelease: () => api.current.end(),
      onPanResponderTerminate: () => api.current.end(),
    }),
  ).current;

  return (
    <Animated.View
      onLayout={first ? (e: LayoutChangeEvent) => onMeasureFirst(e.nativeEvent.layout.height) : undefined}
      style={active ? {
        transform: [{ translateY: dragY }],
        zIndex: layer.dragActive,
        elevation: elevation.dragActive,
        opacity: stateOpacity.dragActive,
      } : undefined}
    >
      {children({
        panHandlers: pan.panHandlers,
        active,
        moveUp: onMoveUp,
        moveDown: onMoveDown,
      })}
    </Animated.View>
  );
}

/**
 * The shared reorder grip. `adjustable` is the honest role — the grip is
 * genuinely operable without a drag gesture through its increment/decrement
 * accessibility actions — but that role REQUIRES a current value, and omitting
 * it left every settings list failing axe's `aria-required-attr`. Publishing
 * the row's position also makes the announcement useful ("3 of 12") instead of
 * a bare "slider". Both settings lists rendered this block byte-identically
 * before it moved here.
 */
export function ReorderGrip({
  handle,
  position,
  count,
}: {
  handle: DragHandle;
  /** 1-based position of this row within the reorderable group. */
  position: number;
  count: number;
}) {
  const { palette } = useTheme();
  return (
    <View
      {...handle.panHandlers}
      accessibilityRole="adjustable"
      accessibilityLabel={tr.settings.reorderHandle}
      // RN Web ignores the `accessibilityValue` object; the `aria-*` aliases
      // (React Native 0.71+) are what actually reach the DOM and the platform.
      aria-valuemin={1}
      aria-valuemax={Math.max(count, 1)}
      aria-valuenow={position}
      accessibilityActions={[
        { name: "increment", label: tr.settings.moveUp },
        { name: "decrement", label: tr.settings.moveDown },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment") handle.moveUp();
        else if (event.nativeEvent.actionName === "decrement") handle.moveDown();
      }}
      collapsable={false}
      style={{
        width: controlSize.minimumTarget,
        height: controlSize.minimumTarget,
        marginLeft: -spacing.sm,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <GripVertical size={18} color={palette.textSecondary} />
    </View>
  );
}
