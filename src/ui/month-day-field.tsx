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
 * The month end is its own full-width control: as one more chip it was the option that wrapped first.
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
  // A refused day is disabled, never removed, so the paired fields keep one baseline. Measured on the field's own box.
  const [boxWidth, onBoxLayout] = useMeasuredWidth(0);
  const refused = new Set(unavailableDays ?? []);
  const numbers = fittedQuickDays(boxWidth, quickDays.filter((day) => day < MONTH_END_DAY));
  const options = numbers.map((day) => ({
    value: String(day),
    label: String(day),
    disabled: refused.has(day),
    hint: refused.has(day) ? unavailableHint : undefined,
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
          // The description is fixed so paired tiles keep equal height; refusal is said in colour and the accessible name.
          description={tr.dates.monthEndHint}
          selected={value === monthEndValue}
          disabled={monthEndTaken}
          onPress={() => onChange(monthEndValue)}
          accessibilityLabel={`${label} · ${tr.dates.monthEnd}`}
          accessibilityHint={monthEndTaken ? unavailableHint : undefined}
        />
      </View>
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
