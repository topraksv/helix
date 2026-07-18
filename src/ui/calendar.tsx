/**
 * Calendar date picker: a Field-styled trigger that opens a month-grid sheet.
 * One implementation for web and iOS — no free-text date typing, no typos.
 */

import React, { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react-native";
import { addMonthsToKey, monthKeyOf, monthOf, todayISO, yearOf, type ISODate, type MonthKey } from "../domain/dates";
import { dateLabel, monthLabel, tr } from "../i18n/tr";
import { cardShadow, radius, spacing, type, useTheme } from "./theme";
import { Button, FadeIn, IconButton, Label } from "./components";
import { pushOverlay } from "./keyboard";

const WEEKDAYS = ["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"];

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
}: {
  value: ISODate | null;
  onSelect: (iso: ISODate) => void;
  onClose: () => void;
  /** Latest selectable day (inclusive). Days after it render disabled. */
  max?: ISODate;
}) {
  const { palette } = useTheme();
  const today = todayISO();
  useEffect(() => pushOverlay(), []); // suppress form Enter-submit while the sheet is open
  const [month, setMonth] = useState<MonthKey>(value ? monthKeyOf(value) : monthKeyOf(today));
  const total = daysInMonth(month);
  const lead = firstWeekday(month);
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(8,10,18,0.55)", alignItems: "center", justifyContent: "center", padding: spacing.lg }}
        onPress={onClose}
      >
        <Pressable onPress={() => {}} style={{ width: "100%", maxWidth: 360 }}>
          <FadeIn style={[{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: spacing.lg }, cardShadow]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md }}>
              <IconButton icon={ChevronLeft} label={tr.common.previous} onPress={() => setMonth(addMonthsToKey(month, -1))} />
              <Text style={[type.heading, { color: palette.text }]}>{monthLabel(month)}</Text>
              <IconButton icon={ChevronRight} label={tr.common.next} onPress={() => setMonth(addMonthsToKey(month, 1))} />
            </View>
            <View style={{ flexDirection: "row" }}>
              {WEEKDAYS.map((d) => (
                <Text key={d} style={[type.small, { color: palette.textMuted, width: `${100 / 7}%`, textAlign: "center", marginBottom: spacing.xs }]}>
                  {d}
                </Text>
              ))}
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {cells.map((day, i) => {
                if (day == null) return <View key={`x${i}`} style={{ width: `${100 / 7}%`, height: 40 }} />;
                const iso: ISODate = `${month}-${String(day).padStart(2, "0")}`;
                const selected = iso === value;
                const isToday = iso === today;
                const disabled = max != null && iso > max;
                return (
                  <Pressable
                    key={iso}
                    accessibilityRole="button"
                    disabled={disabled}
                    onPress={() => {
                      onSelect(iso);
                      onClose();
                    }}
                    style={{ width: `${100 / 7}%`, height: 40, alignItems: "center", justifyContent: "center" }}
                  >
                    <View
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 17,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: selected ? palette.primary : "transparent",
                        borderWidth: isToday && !selected ? 1.5 : 0,
                        borderColor: palette.primary,
                        opacity: disabled ? 0.3 : 1,
                      }}
                    >
                      <Text
                        style={[
                          type.label,
                          { color: selected ? palette.onPrimary : palette.text, fontVariant: ["tabular-nums"] },
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
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Label>{label}</Label> : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          {
            backgroundColor: palette.surfaceAlt,
            borderRadius: radius.sm,
            borderWidth: 1.5,
            borderColor: open ? palette.focus : "transparent",
            paddingHorizontal: spacing.md,
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text style={[type.body, { color: value ? palette.text : palette.textMuted }]}>
          {value ? dateLabel(value) : (placeholder ?? tr.common.pickDate)}
        </Text>
        <CalendarDays size={17} color={palette.textMuted} />
      </Pressable>
      {open ? <CalendarSheet value={value} onSelect={onChange} onClose={() => setOpen(false)} /> : null}
    </View>
  );
}
