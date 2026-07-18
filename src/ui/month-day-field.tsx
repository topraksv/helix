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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  quickDays?: readonly number[];
  error?: string | null;
}) {
  const options = [...new Set([...quickDays.filter((day) => day < MONTH_END_DAY), MONTH_END_DAY])]
    .map((day) => ({ value: String(day), label: monthDayLabel(day) }));
  const selected = options.some((option) => option.value === value) ? value : null;

  return (
    <>
      <Label>{label}</Label>
      <ChipPicker options={options} value={selected} onChange={onChange} />
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
