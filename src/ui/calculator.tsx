/**
 * In-app calculator: a full tab screen and a popup usable from any amount
 * field ("use result" writes back into the field). Chained four-op logic
 * with TR-formatted display; no eval, no surprises.
 */

import React, { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { Delete } from "lucide-react-native";
import { formatMinor } from "../domain/money";
import { tr } from "../i18n/tr";
import { cardShadow, radius, spacing, type, useTheme } from "./theme";
import { Button, FadeIn } from "./components";

type Op = "+" | "-" | "×" | "÷";

interface CalcState {
  current: string; // digits being typed, "" = show accumulator
  accumulator: number | null;
  op: Op | null;
}

const INITIAL: CalcState = { current: "0", accumulator: null, op: null };

function apply(a: number, b: number, op: Op): number {
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "×") return a * b;
  return b === 0 ? 0 : a / b;
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

export function useCalculator() {
  const [state, setState] = useState<CalcState>(INITIAL);

  const press = (key: string) => {
    setState((s) => {
      if (key === "C") return INITIAL;
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
        return { ...s, current: cur + key };
      }
      if (key === "+" || key === "-" || key === "×" || key === "÷") {
        const operand = s.current !== "" ? toNumber(s.current) : (s.accumulator ?? 0);
        const acc = s.op != null && s.current !== "" && s.accumulator != null ? apply(s.accumulator, operand, s.op) : operand;
        return { current: "", accumulator: acc, op: key };
      }
      if (key === "=") {
        if (s.op == null || s.accumulator == null) return s;
        const operand = s.current !== "" ? toNumber(s.current) : s.accumulator;
        const result = apply(s.accumulator, operand, s.op);
        return { current: String(result).replace(".", ","), accumulator: null, op: null };
      }
      return s;
    });
  };

  const value = state.current !== "" ? toNumber(state.current) : (state.accumulator ?? 0);
  return { state, press, value, text: display(state) };
}

const KEYS: string[][] = [
  ["C", "⌫", "÷", "×"],
  ["7", "8", "9", "-"],
  ["4", "5", "6", "+"],
  ["1", "2", "3", "="],
  ["0", ","],
];

export function CalculatorPad({ onResult, resultLabel }: { onResult?: (major: number) => void; resultLabel?: string }) {
  const { palette, scheme } = useTheme();
  const { state, press, value, text } = useCalculator();
  // Live preview of the pending operation before "=" is pressed (3 × 5 → = 15).
  const preview =
    state.op != null && state.current !== "" && state.accumulator != null
      ? apply(state.accumulator, toNumber(state.current), state.op)
      : null;

  const keyStyle = (key: string) => {
    const isOp = ["÷", "×", "-", "+", "="].includes(key);
    const isFn = key === "C" || key === "⌫";
    return {
      bg: isOp ? palette.primarySoft : isFn ? palette.surfaceAlt : scheme === "dark" ? palette.surfaceAlt : palette.surface,
      fg: isOp ? palette.primary : isFn ? palette.textMuted : palette.text,
    };
  };

  return (
    <View>
      {/* display */}
      <View
        style={{
          backgroundColor: palette.surfaceAlt,
          borderRadius: radius.md,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.lg,
          marginBottom: spacing.md,
          alignItems: "flex-end",
        }}
      >
        {state.op ? (
          <Text style={[type.small, { color: palette.textMuted }]}>
            {new Intl.NumberFormat("tr-TR").format(state.accumulator ?? 0)} {state.op}
          </Text>
        ) : null}
        <Text style={[type.amountLg, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit>
          {text}
        </Text>
        {preview != null ? (
          <Text style={[type.small, { color: palette.textMuted }]} numberOfLines={1}>
            = {new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 6 }).format(preview)}
          </Text>
        ) : null}
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
                  onPress={() => press(key)}
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
            label={`${resultLabel ?? tr.calc.useResult} · ${formatMinor(Math.round(value * 100))}`}
            onPress={() => onResult(value)}
            disabled={!Number.isFinite(value)}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Popup calculator for amount fields; result flows back into the field. */
export function CalculatorModal({ onClose, onResult }: { onClose: () => void; onResult: (major: number) => void }) {
  const { palette } = useTheme();
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(8,10,18,0.55)", alignItems: "center", justifyContent: "center", padding: spacing.lg }}
        onPress={onClose}
      >
        <Pressable onPress={() => {}} style={{ width: "100%", maxWidth: 340 }}>
          <FadeIn style={[{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: spacing.lg }, cardShadow]}>
            <CalculatorPad
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
