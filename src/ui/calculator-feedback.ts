import type { HapticKind } from "./haptics";

interface CalculatorFeedbackState {
  current: string;
  accumulator: number | null;
  op: "+" | "-" | "×" | "÷" | null;
}

const numericValue = (raw: string) => Number(raw.replace(",", ".")) || 0;

/** Keep the calculator quiet while entering digits; reserve feedback for
 * discrete operations and meaningful outcomes. */
export function calculatorKeyHaptic(state: CalculatorFeedbackState, key: string): HapticKind {
  if (key === "C") return "light";
  if (key === "⌫") return state.current !== "" && state.current !== "0" ? "light" : "none";
  const isOperator = key === "+" || key === "-" || key === "×" || key === "÷";
  if (key !== "=" && !isOperator) return "none";
  if (key === "=" && (state.op == null || state.accumulator == null)) return "none";

  const operand = state.current !== "" ? numericValue(state.current) : (state.accumulator ?? 0);
  const chaining = state.op != null && state.current !== "" && state.accumulator != null;
  if (state.op === "÷" && operand === 0 && (key === "=" || chaining)) return "error";
  return key === "=" ? "success" : "selection";
}
