import React from "react";
import { MONTH_END_DAY } from "../domain/dates";
import { tr } from "../i18n/tr";
import { ChipPicker, Field, Label } from "./components";

export function monthDayLabel(day: number): string {
  return day === MONTH_END_DAY ? tr.dates.monthEnd : String(day);
}

/** Numeric month-day input with an explicit, calendar-safe month-end choice. */
export function MonthDayField({
  label,
  value,
  onChange,
  quickDays = [],
  error,
  unavailableDay,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  quickDays?: readonly number[];
  error?: string | null;
  /** A day the paired field already owns; choosing it would only produce an
   *  invalid cycle, so it is shown but cannot be chosen. */
  unavailableDay?: number | null;
}) {
  // The unavailable day is disabled, never removed. These fields are used as a
  // pair in one row, and dropping an option shortened one column's chip row
  // while the other kept its own: picking "Ayın sonu" on the left deleted the
  // only chip on the right and its input jumped a whole control height up the
  // page. Same options, same wrap, same baseline — and the user can see why the
  // day is refused instead of watching it disappear.
  const options = [...new Set([...quickDays.filter((day) => day < MONTH_END_DAY), MONTH_END_DAY])]
    .map((day) => ({
      value: String(day),
      label: monthDayLabel(day),
      disabled: day === unavailableDay,
      hint: day === unavailableDay ? tr.dates.dayTakenByPair : undefined,
    }));
  const selected = options.some((option) => option.value === value && !option.disabled) ? value : null;

  return (
    <>
      <Label>{label}</Label>
      <ChipPicker compact options={options} value={selected} onChange={onChange} />
      <Field
        accessibilityLabel={label}
        value={value === String(MONTH_END_DAY) ? "" : value}
        onChangeText={onChange}
        keyboardType="number-pad"
        placeholder={value === String(MONTH_END_DAY) ? tr.dates.monthEndSelected : tr.dates.monthDayPlaceholder}
        error={error}
      />
    </>
  );
}
