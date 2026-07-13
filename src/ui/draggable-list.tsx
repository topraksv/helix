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

export interface DragHandle {
  /** Spread onto the grip element to make it the drag initiator. */
  panHandlers: GestureResponderHandlers;
  /** True while this row is the one being dragged. */
  active: boolean;
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
  onReorder: (orderedKeys: string[]) => void;
  renderRow: (item: T, handle: DragHandle) => React.ReactNode;
  /** Fires true when a drag starts and false when it ends, so the caller can
   *  freeze the surrounding ScrollView (otherwise it steals the vertical pan
   *  and the row never moves). */
  onDragStateChange?: (dragging: boolean) => void;
  /** Freeze dragging entirely (e.g. while a row is in inline-edit mode, when
   *  its taller height would corrupt the fixed-row-height drag math). */
  disabled?: boolean;
}) {
  const [order, setOrder] = useState<T[]>(items);
  const draggingRef = useRef(false);
  // Resync with the source list on add/delete/sync merges — but never mid-drag,
  // or the row would jump out from under the finger.
  useEffect(() => {
    if (!draggingRef.current) setOrder(items);
  }, [items]);

  const orderRef = useRef(order);
  orderRef.current = order;
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
    onDragStateChange?.(true);
  };
  api.current.move = (dy: number) => {
    if (!draggingRef.current) return;
    const H = rowH.current;
    const n = orderRef.current.length;
    const target = Math.max(0, Math.min(n - 1, startIndex.current + Math.round(dy / H)));
    if (target !== curIndex.current) {
      const next = [...orderRef.current];
      const [moved] = next.splice(curIndex.current, 1);
      next.splice(target, 0, moved);
      curIndex.current = target;
      setOrder(next);
    }
    // Keep the floating row under the finger even though its flow slot changed.
    dragY.setValue((startIndex.current - curIndex.current) * H + dy);
  };
  api.current.end = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setActiveKey(null);
    dragY.setValue(0);
    onDragStateChange?.(false);
    onReorder(orderRef.current.map(keyExtractor));
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
          >
            {(handle) => renderRow(item, handle)}
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
  children,
}: {
  itemKey: string;
  first: boolean;
  active: boolean;
  dragY: Animated.Value;
  api: React.MutableRefObject<{ begin: (k: string) => void; move: (dy: number) => void; end: () => void }>;
  onMeasureFirst: (h: number) => void;
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
      style={active ? { transform: [{ translateY: dragY }], zIndex: 10, elevation: 6, opacity: 0.96 } : undefined}
    >
      {children({ panHandlers: pan.panHandlers, active })}
    </Animated.View>
  );
}
