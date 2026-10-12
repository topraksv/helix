/**
 * In-app calculator: a full tab screen and a popup usable from any amount
 * field ("use result" writes back into the field). Chained four-op logic
 * with TR-formatted display; no eval, no surprises.
 */

import React, { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import Delete from "lucide-react-native/icons/delete";
import { CALC_START, feedbackOf, formatNumber, keyFrom, press as pressKey, previewOf, resultOf, shownOf, type CalcKey } from "../domain/calculator";
import { formatMinorCompact, majorToMinor } from "../domain/money";
import { tr } from "../i18n/tr";
import { radius, spacing, themeShadow, type, useTheme } from "./theme";
import { Button, FadeIn } from "./primitives";
import { haptic } from "./haptics";
import { useModalAccessibility } from "./accessibility";
import { useReducedMotion } from "./motion";
import { interactionSurface } from "./interaction";
import { modalAnimationType } from "./modal-motion";
import { isShortLandscape } from "./responsive";

const KEYS: CalcKey[][] = [
  ["C", "⌫", "÷", "×"],
  ["7", "8", "9", "-"],
  ["4", "5", "6", "+"],
  ["1", "2", "3", "="],
  ["0", ","],
];

// A stack of the mounted keyboard-listening calculators, so only the topmost
// (e.g. the popup opened over the tab calculator) responds to a keypress.
const kbStack: object[] = [];

function CalculatorLine({ text, color, main = false }: { text: string; color: string; main?: boolean }) {
  const scrollRef = useRef<ScrollView>(null);
  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ alignSelf: "stretch", height: main ? 50 : 18 }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end", alignItems: "center" }}
      onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
    >
      <Text style={[main ? type.amountLg : type.small, { color, textAlign: "right" }]}>{text}</Text>
    </ScrollView>
  );
}

export function CalculatorPad({
  onResult,
  landscape = false,
}: {
  onResult?: (major: number) => void;
  /** Short modal landscape uses two panels so every action is visible at once. */
  landscape?: boolean;
}) {
  const { palette, scheme } = useTheme();
  const [state, setState] = useState(CALC_START);
  const press = (key: CalcKey) => setState((s) => pressKey(s, key));
  // The previewed result while an operation waits, so what a field takes is what is shown.
  const value = resultOf(state);
  const text = state.error ? tr.calc.error : shownOf(state);

  // Physical-keyboard support on web (desktop): map number/operator keys to the
  // same `press()` the on-screen keys use. Reads live values through refs so the
  // window listener is attached once and never goes stale.
  const pressRef = useRef(press);
  pressRef.current = press;
  const stateRef = useRef(state);
  stateRef.current = state;
  const valueRef = useRef(value);
  valueRef.current = value;
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const token = {};
    kbStack.push(token);
    const onKey = (e: KeyboardEvent) => {
      if (kbStack[kbStack.length - 1] !== token) return; // only the topmost calc
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const key = keyFrom(e.key);
      if (e.key === "Escape") {
        // In the popup the Modal's own keyup closes it; closing here as well
        // would close the sheet underneath too.
        if (onResultRef.current) return;
        pressRef.current("C");
      } else if (key === "=" && stateRef.current.op == null && onResultRef.current) onResultRef.current(valueRef.current);
      else if (key) pressRef.current(key);
      else return; // leave keys we don't handle to the browser
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = kbStack.indexOf(token);
      if (i >= 0) kbStack.splice(i, 1);
    };
  }, []);
  // Live preview of the pending operation before "=" is pressed (3 × 5 → = 15).
  const preview = previewOf(state);
  const resultMinor = majorToMinor(value);

  const keyStyle = (key: string) => {
    const isOp = ["÷", "×", "-", "+", "="].includes(key);
    const isFn = key === "C" || key === "⌫";
    return {
      bg: isOp ? palette.primarySoft : isFn ? palette.surfaceAlt : scheme === "dark" ? palette.surfaceAlt : palette.surface,
      fg: isOp ? palette.primaryText : isFn ? palette.textSecondary : palette.text,
    };
  };

  // Fixed-height display with three stable rows (operand line · main · preview)
  // so typing an operator or seeing the live preview never resizes the box.
  const displayNode = (
    <View
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={tr.a11y.calculatorDisplay(
          text,
          preview == null ? undefined : formatNumber(preview),
        )}
        style={{
          backgroundColor: palette.surfaceAlt,
          borderRadius: radius.md,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          marginBottom: spacing.md,
          minHeight: 128,
          justifyContent: "center",
          alignItems: "flex-end",
        }}
    >
      <CalculatorLine
        text={state.op ? `${formatNumber(state.accumulator ?? 0)} ${state.op}` : " "}
        color={palette.textSecondary}
      />
      <CalculatorLine text={text} color={palette.text} main />
      <CalculatorLine
        text={preview != null ? `= ${formatNumber(preview)}` : " "}
        color={preview != null ? palette.primaryText : "transparent"}
      />
    </View>
  );
  const keysNode = (
    <View style={{ gap: spacing.sm }}>
        {KEYS.map((row, r) => (
          <View key={r} style={{ flexDirection: "row", gap: spacing.sm }}>
            {row.map((key) => {
              const { bg, fg } = keyStyle(key);
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={tr.a11y.calculatorKey(key)}
                  onPress={() => {
                    haptic(feedbackOf(state, key));
                    press(key);
                  }}
                  style={(state) => [
                    {
                      flex: key === "0" ? 2.09 : 1,
                      minHeight: landscape ? 48 : 56,
                      borderRadius: radius.md,
                      alignItems: "center",
                      justifyContent: "center",
                    },
                    themeShadow.card(palette),
                    // `bg` is the resting fill; the shared surface composites into it.
                    interactionSurface(palette, state, { base: bg }),
                  ]}
                >
                  {key === "⌫" ? (
                    <Delete accessible={false} size={20} color={fg} />
                  ) : (
                    <Text style={[type.keypad, { color: fg }]}>{key}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
    </View>
  );
  const resultNode = onResult ? (
    <View style={{ marginTop: landscape ? spacing.md : spacing.lg }}>
      <Button
        label={resultMinor == null ? tr.calc.resultUnavailable : `${tr.calc.useResult} · ${formatMinorCompact(resultMinor)}`}
        onPress={() => onResult(value)}
        disabled={resultMinor == null}
        haptic="success"
      />
    </View>
  ) : null;

  return landscape ? (
    <View style={{ flexDirection: "row", alignItems: "stretch", gap: spacing.lg }}>
      <View style={{ flex: 1 }}>{displayNode}{resultNode}</View>
      <View style={{ flex: 1 }}>{keysNode}</View>
    </View>
  ) : (
    <View>
      {displayNode}
      {keysNode}
      {resultNode}
    </View>
  );
}

/** Popup calculator for amount fields; result flows back into the field. */
export function CalculatorModal({
  onClose,
  onResult,
  returnFocusRef,
}: {
  onClose: () => void;
  onResult: (major: number) => void;
  returnFocusRef?: React.RefObject<View | null>;
}) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  const titleRef = useModalAccessibility(true, returnFocusRef);
  const { width, height } = useWindowDimensions();
  const shortLandscape = isShortLandscape(width, height);
  return (
    <Modal transparent animationType={modalAnimationType(reducedMotion)} visible onRequestClose={onClose} aria-label={tr.a11y.calculatorTitle}>
      <Pressable
        accessible={false}
        tabIndex={-1}
        style={{ flex: 1, backgroundColor: palette.scrim, alignItems: "center", justifyContent: "center", padding: spacing.lg }}
        onPress={onClose}
      >
        {/* The scroller grows and centres its content; its own web flexGrow pinned the pad to the top. */}
        <ScrollView
          style={{ alignSelf: "stretch", maxHeight: Math.max(240, height - spacing.lg * 2) }}
          contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Pressable accessible={false} tabIndex={-1} accessibilityViewIsModal aria-label={tr.a11y.calculatorTitle} onPress={() => {}} style={{ width: "100%", maxWidth: shortLandscape ? 680 : 340 }}>
            <FadeIn style={[{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: spacing.lg }, themeShadow.card(palette)]}>
              <View ref={titleRef} accessible accessibilityRole="header" tabIndex={-1}>
                <Text style={[type.heading, { color: palette.text, marginBottom: spacing.md }]}>{tr.a11y.calculatorTitle}</Text>
              </View>
              <CalculatorPad
                landscape={shortLandscape}
                onResult={(v) => {
                  onResult(v);
                  onClose();
                }}
              />
            </FadeIn>
          </Pressable>
        </ScrollView>
      </Pressable>
    </Modal>
  );
}
