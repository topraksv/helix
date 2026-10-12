/**
 * A pure calculator state machine (`docs/SPEC.md` 11.5): four operations chained
 * left to right, the Turkish decimal comma, no eval. A digit after = starts a
 * new number, and a field takes the previewed result.
 */

import { MAX_ABS_AMOUNT_MINOR, MAX_AMOUNT_MAJOR_DIGITS } from "./money";

type CalcOp = "+" | "-" | "×" | "÷";
export type CalcKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "," | CalcOp | "=" | "C" | "⌫";

export interface Calc {
  /** What is being typed; empty shows the accumulator. */
  current: string;
  accumulator: number | null;
  op: CalcOp | null;
  /** `current` is a result, so the next digit starts a new number. */
  done: boolean;
  /** After ÷0 or a result too large; the next key starts over. */
  error: boolean;
}

export const CALC_START: Calc = { current: "0", accumulator: null, op: null, done: false, error: false };

const DECIMALS = 6;
const LIMIT = MAX_ABS_AMOUNT_MINOR / 100;

const isOp = (key: CalcKey): key is CalcOp => key === "+" || key === "-" || key === "×" || key === "÷";
const numberOf = (typed: string) => Number(typed.replace(",", ".")) || 0;
const operandOf = (state: Calc) => (state.current !== "" ? numberOf(state.current) : (state.accumulator ?? 0));
// Floating point's tail (0,1 + 0,2) is cut where the display would cut it.
const settle = (value: number) => Number(value.toFixed(DECIMALS));

function apply(a: number, b: number, op: CalcOp): number | null {
  if (op === "÷" && b === 0) return null;
  const value = op === "+" ? a + b : op === "-" ? a - b : op === "×" ? a * b : a / b;
  return Math.abs(value) > LIMIT ? null : settle(value);
}

const failed: Calc = { ...CALC_START, error: true };

function typeDigit(state: Calc, key: CalcKey): Calc {
  const typed = state.done || state.current === "0" ? "" : state.current;
  const [whole = "", decimals] = typed.split(",");
  if (decimals == null ? whole.replace("-", "").length >= MAX_AMOUNT_MAJOR_DIGITS : decimals.length >= DECIMALS) return state;
  return { ...state, current: typed + key, done: false };
}

function erase(state: Calc): Calc {
  if (state.current === "" || state.done) return state;
  const left = state.current.slice(0, -1);
  return { ...state, current: left === "" || left === "-" ? "0" : left };
}

function typeComma(state: Calc): Calc {
  const typed = state.done || state.current === "" ? "0" : state.current;
  return typed.includes(",") ? state : { ...state, current: `${typed},`, done: false };
}

function operate(state: Calc, op: CalcOp): Calc {
  // An operator pressed again changes the pending one.
  if (state.current === "" && state.op) return { ...state, op };
  const chained = state.op != null && state.accumulator != null ? apply(state.accumulator, operandOf(state), state.op) : operandOf(state);
  return chained == null ? failed : { current: "", accumulator: chained, op, done: false, error: false };
}

function equals(state: Calc): Calc {
  if (state.op == null || state.accumulator == null) return state;
  const result = apply(state.accumulator, operandOf(state), state.op);
  return result == null ? failed : { ...CALC_START, current: String(result).replace(".", ","), done: true };
}

export function press(from: Calc, key: CalcKey): Calc {
  if (key === "C") return CALC_START;
  const state = from.error ? CALC_START : from;
  if (key === "⌫") return erase(state);
  if (key === ",") return typeComma(state);
  if (key === "=") return equals(state);
  return isOp(key) ? operate(state, key) : typeDigit(state, key);
}

/** What `=` would give, while an operation waits for it. */
export function previewOf(state: Calc): number | null {
  if (state.op == null || state.accumulator == null || state.current === "") return null;
  return apply(state.accumulator, numberOf(state.current), state.op);
}

/** What a field takes: `=`'s answer while an operation waits for it, else the number shown; NaN when there is none. */
export function resultOf(state: Calc): number {
  if (state.error) return Number.NaN;
  const pending = state.op != null && state.accumulator != null && state.current !== "";
  return pending ? (previewOf(state) ?? Number.NaN) : valueOf(state);
}

/** The display's number; NaN after an error, which nothing can use. */
function valueOf(state: Calc): number {
  return state.error ? Number.NaN : operandOf(state);
}

const groupThousands = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const GROUPED = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: DECIMALS });

/** A number grouped the Turkish way. */
export function formatNumber(value: number): string {
  return GROUPED.format(value);
}

/** The main line: the whole part grouped, the decimals as typed. */
export function shownOf(state: Calc): string {
  if (state.current === "") return formatNumber(state.accumulator ?? 0);
  const [whole = "", decimals] = state.current.split(",");
  const grouped = groupThousands(whole);
  return decimals == null ? grouped : `${grouped},${decimals}`;
}

/** Digits stay quiet, a discrete step taps, `=` and a refusal say how it went. */
export function feedbackOf(state: Calc, key: CalcKey): "none" | "selection" | "success" | "error" {
  if (key === "C") return "selection";
  if (isOp(key) || key === "=") {
    const pending = state.op != null && state.accumulator != null && (key === "=" || state.current !== "");
    if (!pending) return isOp(key) ? "selection" : "none";
    return apply(state.accumulator!, operandOf(state), state.op!) == null ? "error" : key === "=" ? "success" : "selection";
  }
  return "none";
}

const PHYSICAL: Record<string, CalcKey> = {
  ".": ",",
  ",": ",",
  "+": "+",
  "-": "-",
  "*": "×",
  x: "×",
  X: "×",
  "/": "÷",
  Enter: "=",
  "=": "=",
  Backspace: "⌫",
  Delete: "C",
  c: "C",
  C: "C",
};

/** A physical keyboard's key on the web, as the pad's; `null` for one the pad does not have. */
export function keyFrom(key: string): CalcKey | null {
  return /^\d$/.test(key) ? (key as CalcKey) : (PHYSICAL[key] ?? null);
}
