/** Undo snackbar (approved feature): shown after deletes, restores tombstoned rows. */

import React from "react";
import { Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Check from "lucide-react-native/icons/check";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { SlideUp, SuccessPop } from "./motion-primitives";
import { controlSize, font, motion, navigationInset, radius, spacing, stateOpacity, themeShadow, type, useTheme } from "./theme";
import { useReducedMotion } from "./motion";
import { tr } from "../i18n/tr";
import { haptic, selectionTap, type HapticKind } from "./haptics";
import { runUndo } from "../domain/undo-outcome";
import { devError } from "../services/logger";
import { appAlert } from "./dialog";

type UndoTone = Extract<HapticKind, "success" | "warning">;

/**
 * A second line and a second action, for a save that DID something worth
 * checking: which figure moved, and by how much.
 *
 * Kept optional so the bar stays the same quiet confirmation everywhere else.
 * It is not a dialog and does not block: the owner reads it or ignores it, and
 * it leaves on its own. Nothing here refreshes a screen or remounts a route —
 * the live queries have already delivered the change underneath it.
 */
export interface UndoDetail {
  /** One short sentence: the derived effect, e.g. the balance impact. */
  text: string;
  /** A second action beside undo, e.g. "Düzenle". */
  action?: { label: string; run: () => void } | null;
}

interface UndoState {
  message: string | null;
  detail: UndoDetail | null;
  onUndo: (() => Promise<unknown> | unknown) | null;
  tone: UndoTone;
  /** `onUndo` is optional: the same bar also confirms an action that has
   *  nothing to take back, and then renders without the action label. */
  show: (message: string, onUndo?: (() => Promise<unknown> | unknown) | null, tone?: UndoTone) => void;
  /** The same bar, carrying a derived effect and an optional second action. */
  showDetailed: (
    message: string,
    detail: UndoDetail,
    onUndo?: (() => Promise<unknown> | unknown) | null,
    tone?: UndoTone,
  ) => void;
  clear: () => void;
}

let hideTimer: ReturnType<typeof setTimeout> | null = null;

function present(
  set: (state: Partial<UndoState>) => void,
  message: string,
  detail: UndoDetail | null,
  onUndo: (() => Promise<unknown> | unknown) | null,
  tone: UndoTone,
): void {
  if (hideTimer) clearTimeout(hideTimer);
  haptic(tone);
  set({ message, detail, onUndo, tone });
  // Pure confirmations leave quickly; anything with an action to take, a
  // warning, or a second line to read stays long enough to be acted on
  // without becoming permanent chrome.
  const duration = onUndo || detail || tone === "warning" ? 6000 : 3600;
  hideTimer = setTimeout(() => set({ message: null, detail: null, onUndo: null, tone: "success" }), duration);
}

export const useUndo = create<UndoState>((set) => ({
  message: null,
  detail: null,
  onUndo: null,
  tone: "success",
  show: (message, onUndo = null, tone = "success") => present(set, message, null, onUndo ?? null, tone),
  showDetailed: (message, detail, onUndo = null, tone = "success") =>
    present(set, message, detail, onUndo ?? null, tone),
  clear: () => {
    if (hideTimer) clearTimeout(hideTimer);
    set({ message: null, detail: null, onUndo: null, tone: "success" });
  },
}));

/**
 * How far down the bar has to be dragged before letting go dismisses it.
 *
 * Measured against the bar's own height rather than the screen's: the gesture
 * is "push this out of the way", and the thing being pushed is about 64pt tall.
 * Half of that is unmistakably a drag and still reachable with one thumb.
 */
const DISMISS_DISTANCE = 32;

/** A flick that dismisses even though it barely travelled. */
const DISMISS_VELOCITY = 0.6;

/** Movement before the drag claims the gesture, so a TAP still reaches the
 *  action buttons inside the bar rather than being swallowed by the pan. */
const DRAG_CLAIM = 6;

/** Where the bar goes on its way out: far enough to be gone behind the edge. */
const DISMISS_TRAVEL = 140;

export function UndoSnackbar() {
  const { palette } = useTheme();
  const { message, detail, onUndo, tone, clear } = useUndo();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [undoing, setUndoing] = React.useState(false);
  /**
   * Pushing the bar out of the way.
   *
   * It leaves on its own, but "on its own" is six seconds and it sits over the
   * thing the owner is trying to look at. Downward only: up is where the bar
   * came from and dragging it there means nothing.
   */
  const dragY = React.useRef(new Animated.Value(0)).current;
  // The store outlives this component's closures — a responder created once
  // must dismiss whatever bar is up when it fires, not the one it was born on.
  const clearRef = React.useRef(clear);
  clearRef.current = clear;
  const reducedMotionRef = React.useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  // A new confirmation arrives at rest, however the last one was pushed away.
  React.useEffect(() => { dragY.setValue(0); }, [dragY, message]);

  const pan = React.useMemo(
    () => PanResponder.create({
      // Never claim the gesture on touch-down: the bar carries up to two
      // buttons and a press must reach them.
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dy > DRAG_CLAIM && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_event, gesture) => dragY.setValue(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_event, gesture) => {
        const dismissed = gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY;
        if (!dismissed) {
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: Platform.OS !== "web",
            ...motion.spring.entrance,
          }).start();
          return;
        }
        if (reducedMotionRef.current) {
          clearRef.current();
          return;
        }
        Animated.timing(dragY, {
          toValue: DISMISS_TRAVEL,
          duration: motion.feedback,
          useNativeDriver: Platform.OS !== "web",
        }).start(() => clearRef.current());
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragY, {
          toValue: 0,
          useNativeDriver: Platform.OS !== "web",
          ...motion.spring.entrance,
        }).start();
      },
    }),
    [dragY],
  );
  if (!message) return null;
  // Clear the real navigation surface (shared tokens), not a hardcoded offset
  // that silently drifts when the bar changes. It floats, so the space it
  // occupies is its clearance, not just its size.
  const nav = navigationInset({ bottomInset: insets.bottom, isWeb: Platform.OS === "web" });
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: nav.left + spacing.lg, right: spacing.lg, bottom: nav.bottom + spacing.md, alignItems: "center" }}
    >{/* Keyed on the message: a second confirmation arriving while the first
         is still up replaced its words in place and looked like a typo. It
         re-enters, and its mark pops again, because it is a different event. */}
      <SlideUp key={message}>
      {/* The bar is the only confirmation some actions get, so it is announced
          rather than left as silent decoration. Polite: it reports an outcome
          the user just caused and must not interrupt what they type next. */}
      <Animated.View
        {...pan.panHandlers}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={{
          transform: [{ translateY: dragY }],
          // Fades as it goes, so the drag reads as the bar leaving rather than
          // as the bar being moved somewhere else.
          opacity: dragY.interpolate({
            inputRange: [0, DISMISS_TRAVEL],
            outputRange: [1, 0],
            extrapolate: "clamp",
          }),
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          backgroundColor: palette.text,
          borderRadius: radius.md,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          ...themeShadow.overlay(palette),
        }}
      >
        <View
          accessible={false}
          style={{
            width: 26,
            height: 26,
            flexShrink: 0,
            borderRadius: radius.md,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.background + "70",
            backgroundColor: palette.background + "18",
          }}
        >
          {/* The mark lands rather than appears. For most deletes this bar is
              the only confirmation the action happened at all. */}
          <SuccessPop>
            {tone === "warning" ? (
              <TriangleAlert size={14} color={palette.background} />
            ) : (
              <Check size={15} color={palette.background} strokeWidth={2.5} />
            )}
          </SuccessPop>
        </View>
        <View style={{ flexShrink: 1, minWidth: 0 }}>
          <Text style={[type.body, { color: palette.background }]}>{message}</Text>
          {/* The derived effect — what the save did to a figure the owner
              watches. Second line, not a second bar: one event, one message. */}
          {detail ? (
            <Text style={[type.small, { color: palette.background, opacity: 0.85, marginTop: 2 }]}>
              {detail.text}
            </Text>
          ) : null}
        </View>
        {detail?.action ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              selectionTap();
              const run = detail.action?.run;
              clear();
              run?.();
            }}
            style={({ pressed }) => ({
              minHeight: controlSize.minimumTarget,
              justifyContent: "center",
              paddingHorizontal: spacing.sm,
              borderRadius: radius.sm,
              opacity: pressed ? stateOpacity.pressed : 1,
            })}
          >
            <Text style={[type.label, { color: palette.background, fontFamily: font.bold, fontSize: type.body.fontSize }]}>
              {detail.action.label}
            </Text>
          </Pressable>
        ) : null}
        {onUndo ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: undoing, disabled: undoing }}
            disabled={undoing}
            onPress={async () => {
              if (undoing) return;
              selectionTap();
              setUndoing(true);
              const outcome = await runUndo(async () => onUndo());
              setUndoing(false);
              if (outcome.ok) {
                clear();
                return;
              }
              devError("undo", outcome.error);
              // Keep the action available for a deterministic retry and reset
              // its timeout; a failed restore must never look successful.
              useUndo.getState().show(message, onUndo, "warning");
              void appAlert(tr.errors.undoFailed, tr.errors.title);
            }}
            style={({ pressed }) => ({
              minHeight: controlSize.minimumTarget,
              justifyContent: "center",
              paddingHorizontal: spacing.sm,
              marginHorizontal: -spacing.sm,
              borderRadius: radius.sm,
              opacity: pressed ? stateOpacity.pressed : 1,
            })}
          >
            {/* Inverted surface: the action shares the message's ink (an accent
                role would land near-invisible on `palette.text`) and is set
                apart by weight instead of colour. */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <RotateCcw accessible={false} size={14} color={palette.background} />
              <Text style={[type.label, { color: palette.background, fontFamily: font.bold, fontSize: type.body.fontSize }]}>
                {tr.common.undo}
              </Text>
            </View>
          </Pressable>
        ) : null}
      </Animated.View>
    </SlideUp></View>
  );
}
