/**
 * Calendar date picker: a Field-styled trigger that opens a month-grid sheet.
 * One implementation for web and iOS — no free-text date typing, no typos.
 */

import React, { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react-native";
import { addMonthsToKey, monthKeyOf, todayISO, type ISODate, type MonthKey } from "../domain/dates";
import { dateLabel, monthLabel, tr } from "../i18n/tr";
import { cardShadow, radius, spacing, type, useTheme } from "./theme";
import { FadeIn, IconButton, Label } from "./components";

const WEEKDAYS = ["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"];

function daysInMonth(month: MonthKey): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** Monday-based weekday index of the month's first day. */
function firstWeekday(month: MonthKey): number {
  const [y, m] = month.split("-").map(Number);
  return (new Date(y, m - 1, 1).getDay() + 6) % 7;
}

export function CalendarSheet({
  value,
  onSelect,
  onClose,
}: {
  value: ISODate | null;
  onSelect: (iso: ISODate) => void;
  onClose: () => void;
}) {
  const { palette } = useTheme();
  const today = todayISO();
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
                return (
                  <Pressable
                    key={iso}
                    accessibilityRole="button"
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
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8} style={{ position: "absolute", top: -6, right: -6 }}>
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: palette.surfaceAlt, alignItems: "center", justifyContent: "center" }}>
                <X size={15} color={palette.textMuted} />
              </View>
            </Pressable>
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
