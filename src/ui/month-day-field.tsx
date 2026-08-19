import React from "react";
import { View } from "react-native";
import { MONTH_END_DAY } from "../domain/dates";
import { tr } from "../i18n/tr";
import { ChipPicker, ChoiceTile, Field, Label } from "./components";
import { fittedQuickDays } from "./responsive";
import { controlSize, spacing } from "./theme";
import { useMeasuredWidth } from "./viewport";

export function monthDayLabel(day: number): string {
  return day === MONTH_END_DAY ? tr.dates.monthEnd : String(day);
}

/**
 * Numeric month-day input with an explicit, calendar-safe month-end choice.
 *
 * The month end is NOT one more chip in the number row. Measured on a 390pt
 * phone the six numbers and "Ayın sonu" came to 325px inside a 326px box — a
 * single pixel of margin, which the web happened to keep and iOS did not, so
 * the one option whose meaning needs explaining was the one that dropped onto a
 * line of its own. It has its own full-width control now, and it can say what
 * it does: "the last day of whichever month it is" answers a real question that
 * "31" only raised.
 */
export function MonthDayField({
  label,
  value,
  onChange,
  quickDays = [],
  error,
  unavailableDays,
  unavailableHint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  quickDays?: readonly number[];
  error?: string | null;
  /** Days the paired field rules out; choosing one would only produce an
   *  invalid cycle, so each is shown but cannot be chosen. */
  unavailableDays?: readonly number[];
  /** Why those days are refused, in the caller's own words. */
  unavailableHint?: string;
}) {
  // A refused day is disabled, never removed. These fields are used as a
  // pair in one row, and dropping an option shortened one column's chip row
  // while the other kept its own: picking the month end on the left deleted the
  // only chip on the right and its input jumped a whole control height up the
  // page. Same options, same wrap, same baseline — and the user can see why the
  // day is refused instead of watching it disappear.
  //
  // Measured on this field's own box, not the window: a pair of these inside a
  // card gets about half a column each and only the layout knows how much.
  const [boxWidth, onBoxLayout] = useMeasuredWidth(0);
  const refused = new Set(unavailableDays ?? []);
  const refusalHint = unavailableHint ?? tr.dates.dayTakenByPair;
  const numbers = fittedQuickDays(boxWidth, quickDays.filter((day) => day < MONTH_END_DAY));
  const options = [...new Set(numbers)].map((day) => ({
    value: String(day),
    label: monthDayLabel(day),
    disabled: refused.has(day),
    hint: refused.has(day) ? refusalHint : undefined,
  }));
  const monthEndValue = String(MONTH_END_DAY);
  const monthEndTaken = refused.has(MONTH_END_DAY);
  const selected = options.some((option) => option.value === value && !option.disabled) ? value : null;

  return (
    <View onLayout={onBoxLayout}>
      <Label>{label}</Label>
      {options.length > 0 ? (
        <ChipPicker compact options={options} value={selected} onChange={onChange} />
      ) : null}
      <View style={{ marginBottom: spacing.md }}>
        <ChoiceTile
          layout="row"
          minHeight={controlSize.minimumTarget}
          basis="100%"
          label={tr.dates.monthEnd}
          // The description never changes with the state. These fields are a
          // pair on one row, and swapping in a "the other field owns this day"
          // sentence made one tile taller than the other — so choosing a day
          // moved the input beside it off the shared baseline, which is exactly
          // what this control was built to stop. Refusal is said in colour and
          // in the accessible name, not by resizing the tile.
          description={tr.dates.monthEndHint}
          selected={value === monthEndValue}
          disabled={monthEndTaken}
          onPress={() => onChange(monthEndValue)}
          accessibilityLabel={`${label} · ${tr.dates.monthEnd}`}
          accessibilityHint={monthEndTaken ? refusalHint : undefined}
        />
      </View>
      {/* The input always holds the day. It used to blank itself when the
          month end was chosen and put "Ayın sonu seçildi" in the placeholder,
          which made a hint stand in for an answer — the field looked unfilled
          and the value lived only in the chip above it. */}
      <Field
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        keyboardType="number-pad"
        placeholder={tr.dates.monthDayPlaceholder}
        error={error}
      />
    </View>
  );
}
