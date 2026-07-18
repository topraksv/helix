/**
 * Calendar date picker: a Field-styled trigger that opens a month-grid sheet.
 * One implementation for web and iOS — no free-text date typing, no typos.
 */

import React, { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react-native";
import { addMonthsToKey, monthKeyOf, monthOf, todayISO, yearOf, type ISODate, type MonthKey } from "../domain/dates";
import { dateLabel, monthLabel, tr } from "../i18n/tr";
import { cardShadow, radius, scrim, spacing, type, useTheme } from "./theme";
import { Button, FadeIn, IconButton, Label } from "./components";
import { pushOverlay } from "./keyboard";
import { useModalAccessibility } from "./accessibility";

function daysInMonth(month: MonthKey): number {
  return new Date(yearOf(month), monthOf(month), 0).getDate();
}

/** Monday-based weekday index of the month's first day. */
function firstWeekday(month: MonthKey): number {
  return (new Date(yearOf(month), monthOf(month) - 1, 1).getDay() + 6) % 7;
}

export function CalendarSheet({
  value,
  onSelect,
  onClose,
  max,
  returnFocusRef,
}: {
  value: ISODate | null;
  onSelect: (iso: ISODate) => void;
  onClose: () => void;
  /** Latest selectable day (inclusive). Days after it render disabled. */
  max?: ISODate;
  returnFocusRef?: React.RefObject<View | null>;
}) {
  const { palette } = useTheme();
  const titleRef = useModalAccessibility(true, returnFocusRef);
  const today = todayISO();
  useEffect(() => pushOverlay(), []); // suppress form Enter-submit while the sheet is open
  const [month, setMonth] = useState<MonthKey>(value ? monthKeyOf(value) : monthKeyOf(today));
  const total = daysInMonth(month);
  const lead = firstWeekday(month);
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable
        accessible={false}
        style={{ flex: 1, backgroundColor: scrim, alignItems: "center", justifyContent: "center", padding: spacing.lg }}
        onPress={onClose}
      >
        <Pressable accessible={false} accessibilityViewIsModal onPress={() => {}} style={{ width: "100%", maxWidth: 360 }}>
          <FadeIn style={[{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: spacing.lg }, cardShadow]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md }}>
              <IconButton icon={ChevronLeft} label={tr.common.previous} onPress={() => setMonth(addMonthsToKey(month, -1))} />
              <View ref={titleRef} accessible accessibilityRole="header" accessibilityLiveRegion="polite" tabIndex={-1}>
                <Text style={[type.heading, { color: palette.text }]}>{monthLabel(month)}</Text>
              </View>
              <IconButton icon={ChevronRight} label={tr.common.next} onPress={() => setMonth(addMonthsToKey(month, 1))} />
            </View>
            <View style={{ flexDirection: "row" }}>
              {tr.common.weekdays.map((d) => (
                <Text key={d} style={[type.small, { color: palette.textSecondary, width: `${100 / 7}%`, textAlign: "center", marginBottom: spacing.xs }]}>
                  {d}
                </Text>
              ))}
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {cells.map((day, i) => {
                if (day == null) return <View key={`x${i}`} style={{ width: `${100 / 7}%`, height: 44 }} />;
                const iso: ISODate = `${month}-${String(day).padStart(2, "0")}`;
                const selected = iso === value;
                const isToday = iso === today;
                const disabled = max != null && iso > max;
                return (
                  <Pressable
                    key={iso}
                    accessibilityRole="button"
                    accessibilityLabel={dateLabel(iso)}
                    accessibilityState={{ disabled, selected }}
                    disabled={disabled}
                    onPress={() => {
                      onSelect(iso);
                      onClose();
                    }}
                    style={{ width: `${100 / 7}%`, height: 44, alignItems: "center", justifyContent: "center" }}
                  >
                    <View
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 17,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: selected ? palette.primarySoft : "transparent",
                        borderWidth: isToday && !selected ? StyleSheet.hairlineWidth : 0,
                        borderColor: palette.primaryText,
                        opacity: disabled ? 0.3 : 1,
                      }}
                    >
                      <Text
                        style={[
                          type.label,
                          { color: selected ? palette.primaryText : palette.text, fontVariant: ["tabular-nums"] },
                        ]}
                      >
                        {day}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ marginTop: spacing.sm }}>
              <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={onClose} />
            </View>
          </FadeIn>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Field-styled date input that opens the calendar sheet. */
export function DateField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label?: string;
  value: ISODate | null;
  onChange: (iso: ISODate) => void;
  placeholder?: string;
}) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<View>(null);
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Label>{label}</Label> : null}
      <Pressable
        ref={triggerRef}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={value ? dateLabel(value) : (placeholder ?? tr.common.pickDate)}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          {
            backgroundColor: palette.surfaceAlt,
            borderRadius: radius.sm,
            borderWidth: open ? 1.5 : StyleSheet.hairlineWidth,
            borderColor: open ? palette.focus : palette.border,
            paddingHorizontal: spacing.md,
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text style={[type.body, { color: value ? palette.text : palette.textSecondary }]}>
          {value ? dateLabel(value) : (placeholder ?? tr.common.pickDate)}
        </Text>
        <CalendarDays accessible={false} size={17} color={palette.textSecondary} />
      </Pressable>
      {open ? <CalendarSheet value={value} onSelect={onChange} onClose={() => setOpen(false)} returnFocusRef={triggerRef} /> : null}
    </View>
  );
}
