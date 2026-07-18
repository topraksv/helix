/**
 * In-app calculator: a full tab screen and a popup usable from any amount
 * field ("use result" writes back into the field). Chained four-op logic
 * with TR-formatted display; no eval, no surprises.
 */

import React, { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Delete } from "lucide-react-native";
import { formatMinor, majorToMinor, MAX_AMOUNT_MAJOR_DIGITS } from "../domain/money";
import { tr } from "../i18n/tr";
import { cardShadow, radius, spacing, type, useTheme } from "./theme";
import { Button, FadeIn } from "./components";
import { calculatorKeyHaptic } from "./calculator-feedback";
import { haptic } from "./haptics";
import { pushOverlay } from "./keyboard";

type Op = "+" | "-" | "×" | "÷";

interface CalcState {
  current: string; // digits being typed, "" = show accumulator
  accumulator: number | null;
  op: Op | null;
  /** Set after an illegal operation (÷0); display shows an error until cleared. */
  error?: boolean;
}

const INITIAL: CalcState = { current: "0", accumulator: null, op: null };

function apply(a: number, b: number, op: Op): number {
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "×") return a * b;
  return a / b; // callers guard b === 0 (÷0 → error state, never 0)
}

function toNumber(s: string): number {
  return Number(s.replace(",", ".")) || 0;
}

function display(state: CalcState): string {
  const raw = state.current !== "" ? toNumber(state.current) : (state.accumulator ?? 0);
  // Show live typing verbatim (keeps trailing comma), otherwise format nicely.
  if (state.current !== "" && /,$|^-?\d+$|,\d{0,2}$/.test(state.current) === false) return state.current;
  if (state.current !== "" && state.current.endsWith(",")) return state.current;
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 6 }).format(raw);
}

function useCalculator() {
  const [state, setState] = useState<CalcState>(INITIAL);

  const press = (key: string) => {
    setState((s) => {
      if (key === "C") return INITIAL;
      // After an error, the next keypress (other than C) starts fresh.
      if (s.error) s = INITIAL;
      if (key === "⌫") {
        if (s.current === "") return s;
        const next = s.current.slice(0, -1);
        return { ...s, current: next === "" || next === "-" ? "0" : next };
      }
      if (key === ",") {
        const cur = s.current === "" ? "0" : s.current;
        return cur.includes(",") ? s : { ...s, current: cur + "," };
      }
      if (/^\d$/.test(key)) {
        const cur = s.current === "0" ? "" : s.current;
        const [integer, fraction = ""] = cur.split(",");
        if ((!cur.includes(",") && (integer ?? "").replace("-", "").length >= MAX_AMOUNT_MAJOR_DIGITS) || fraction.length >= 6) return s;
        return { ...s, current: cur + key };
      }
      if (key === "+" || key === "-" || key === "×" || key === "÷") {
        const operand = s.current !== "" ? toNumber(s.current) : (s.accumulator ?? 0);
        const chaining = s.op != null && s.current !== "" && s.accumulator != null;
        if (chaining && s.op === "÷" && operand === 0) return { ...INITIAL, error: true };
        const acc = chaining ? apply(s.accumulator!, operand, s.op!) : operand;
        if (majorToMinor(acc) == null) return { ...INITIAL, error: true };
        return { current: "", accumulator: acc, op: key };
      }
      if (key === "=") {
        if (s.op == null || s.accumulator == null) return s;
        const operand = s.current !== "" ? toNumber(s.current) : s.accumulator;
        if (s.op === "÷" && operand === 0) return { ...INITIAL, error: true };
        const result = apply(s.accumulator, operand, s.op);
        if (majorToMinor(result) == null) return { ...INITIAL, error: true };
        return { current: String(result).replace(".", ","), accumulator: null, op: null };
      }
      return s;
    });
  };

  // An error state has no usable value; NaN disables "use result".
  const value = state.error ? NaN : state.current !== "" ? toNumber(state.current) : (state.accumulator ?? 0);
  return { state, press, value, text: state.error ? tr.calc.error : display(state) };
}

const KEYS: string[][] = [
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
  resultLabel,
  onEscape,
}: {
  onResult?: (major: number) => void;
  resultLabel?: string;
  /** Escape key handler (popup passes its close); otherwise Escape clears. */
  onEscape?: () => void;
}) {
  const { palette, scheme } = useTheme();
  const { state, press, value, text } = useCalculator();

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
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const token = {};
    kbStack.push(token);
    const onKey = (e: KeyboardEvent) => {
      if (kbStack[kbStack.length - 1] !== token) return; // only the topmost calc
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key;
      const p = pressRef.current;
      if (/^[0-9]$/.test(k)) p(k);
      else if (k === "." || k === ",") p(",");
      else if (k === "+") p("+");
      else if (k === "-") p("-");
      else if (k === "*" || k === "x" || k === "X") p("×");
      else if (k === "/") p("÷");
      else if (k === "Enter" || k === "=") {
        if (stateRef.current.op != null) p("=");
        else if (onResultRef.current) onResultRef.current(valueRef.current);
        else p("=");
      } else if (k === "Backspace") p("⌫");
      else if (k === "Escape") {
        if (onEscapeRef.current) onEscapeRef.current();
        else p("C");
      } else if (k === "c" || k === "C" || k === "Delete") p("C");
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
  const preview =
    state.op != null && state.current !== "" && state.accumulator != null
      ? apply(state.accumulator, toNumber(state.current), state.op)
      : null;
  const resultMinor = majorToMinor(value);

  const keyStyle = (key: string) => {
    const isOp = ["÷", "×", "-", "+", "="].includes(key);
    const isFn = key === "C" || key === "⌫";
    return {
      bg: isOp ? palette.primarySoft : isFn ? palette.surfaceAlt : scheme === "dark" ? palette.surfaceAlt : palette.surface,
      fg: isOp ? palette.primary : isFn ? palette.textMuted : palette.text,
    };
  };

  // Fixed-height display with three stable rows (operand line · main · preview)
  // so typing an operator or seeing the live preview never resizes the box.
  return (
    <View>
      {/* display */}
      <View
        style={{
          backgroundColor: palette.surfaceAlt,
          borderRadius: radius.md,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          marginBottom: spacing.md,
          height: 128,
          justifyContent: "center",
          alignItems: "flex-end",
        }}
      >
        <CalculatorLine
          text={state.op ? `${new Intl.NumberFormat("tr-TR").format(state.accumulator ?? 0)} ${state.op}` : " "}
          color={palette.textMuted}
        />
        <CalculatorLine text={text} color={palette.text} main />
        <CalculatorLine
          text={preview != null ? `= ${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 6 }).format(preview)}` : " "}
          color={preview != null ? palette.primary : "transparent"}
        />
      </View>
      {/* keys */}
      <View style={{ gap: spacing.sm }}>
        {KEYS.map((row, r) => (
          <View key={r} style={{ flexDirection: "row", gap: spacing.sm }}>
            {row.map((key) => {
              const { bg, fg } = keyStyle(key);
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  onPress={() => {
                    haptic(calculatorKeyHaptic(state, key));
                    press(key);
                  }}
                  style={({ pressed }) => [
                    {
                      flex: key === "0" ? 2.09 : 1,
                      height: 56,
                      borderRadius: radius.md,
                      backgroundColor: bg,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: pressed ? 0.7 : 1,
                    },
                    scheme === "light" && cardShadow,
                  ]}
                >
                  {key === "⌫" ? (
                    <Delete size={20} color={fg} />
                  ) : (
                    <Text style={{ fontSize: 22, fontFamily: "Inter_500Medium", color: fg }}>{key}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      {onResult ? (
        <View style={{ marginTop: spacing.lg }}>
          <Button
            label={resultMinor == null ? tr.calc.resultUnavailable : `${resultLabel ?? tr.calc.useResult} · ${formatMinor(resultMinor)}`}
            onPress={() => onResult(value)}
            disabled={resultMinor == null}
            haptic="success"
          />
        </View>
      ) : null}
    </View>
  );
}

/** Popup calculator for amount fields; result flows back into the field. */
export function CalculatorModal({ onClose, onResult }: { onClose: () => void; onResult: (major: number) => void }) {
  const { palette } = useTheme();
  useEffect(() => pushOverlay(), []); // suppress form Enter-submit while open
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(8,10,18,0.55)", alignItems: "center", justifyContent: "center", padding: spacing.lg }}
        onPress={onClose}
      >
        <Pressable onPress={() => {}} style={{ width: "100%", maxWidth: 340 }}>
          <FadeIn style={[{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: spacing.lg }, cardShadow]}>
            <CalculatorPad
              onEscape={onClose}
              onResult={(v) => {
                onResult(v);
                onClose();
              }}
            />
          </FadeIn>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
