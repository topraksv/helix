/**
 * A credit card's two dates, as one control (spec §3.1f).
 *
 * They are a PAIR: neither day means anything without the other, and every
 * rule about them is a rule about the gap between them. Three screens build a
 * card — the settings editor, onboarding, and the workbook importer's card
 * step — and two of them used to ship no rule at all, so "ayın sonu" could be
 * chosen for both and produce a statement with no period. One definition, so a
 * card entered during onboarding is the same card entered in settings.
 */

import React from "react";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import {
  CARD_CYCLE_GRACE,
  cardCycleGraceDays,
  isCardCycleDayConflict,
  isValidCardCycleGrace,
  refusedCardCycleDays,
  cardCycleProgress,
  isValidCardCycle,} from "../domain/card-statements";
import { MONTH_END_DAY, todayISO } from "../domain/dates";
import { tr } from "../i18n/tr";
import { Body, Row } from "./components";
import { MonthDayField } from "./month-day-field";
import { spacing, useTheme } from "./theme";

/**
 * The days offered as shortcuts.
 *
 * Statement days cluster on the multiples of five that banks actually issue,
 * and the month end has its own control below the row. Every other day stays
 * typeable in the field.
 */
const CARD_CYCLE_QUICK_DAYS = [1, 5, 10, 15, 20, 25] as const;

/** Every day either field can hold, so a refusal can be shown rather than hidden. */
const ALL_MONTH_DAYS = Array.from({ length: MONTH_END_DAY }, (_, index) => index + 1);

export function cardCycleError(statementDay: number | null, dueDay: number | null): string | null {
  if (isCardCycleDayConflict(statementDay, dueDay)) return tr.sources.cycleSameDay;
  if (!isValidCardCycleGrace(statementDay, dueDay)) return tr.sources.cycleGraceInvalid(CARD_CYCLE_GRACE.max);
  return null;
}

export function CardCycleFields({
  statementDayValue,
  dueDayValue,
  onStatementDayChange,
  onDueDayChange,
}: {
  statementDayValue: string;
  dueDayValue: string;
  onStatementDayChange: (value: string) => void;
  onDueDayChange: (value: string) => void;
}) {
  const statementDay = statementDayValue.trim() === "" ? null : Number(statementDayValue);
  const dueDay = dueDayValue.trim() === "" ? null : Number(dueDayValue);
  const error = cardCycleError(statementDay, dueDay);
  // Each field refuses exactly the days that could not pair with what the OTHER
  // field already holds. Shown and disabled, never removed: dropping an option
  // shortens one column's chip row while the other keeps its own, and the two
  // fields stop sharing a baseline.
  const refusedStatementDays = refusedCardCycleDays(dueDay, "statement", ALL_MONTH_DAYS);
  const refusedDueDays = refusedCardCycleDays(statementDay, "due", ALL_MONTH_DAYS);
  // The gap itself, said in days. It is the fact the two fields exist to
  // express and the one neither of them shows on its own.
  const grace = statementDay != null && dueDay != null && error == null
    ? cardCycleGraceDays(statementDay, dueDay)
    : null;

  return (
    <>
      <Row style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <MonthDayField
            label={tr.sources.statementDay}
            value={statementDayValue}
            onChange={onStatementDayChange}
            quickDays={CARD_CYCLE_QUICK_DAYS}
            unavailableDays={refusedStatementDays}
            unavailableHint={tr.sources.cycleGraceTaken}
            error={error}
          />
        </View>
        <View style={{ flex: 1 }}>
          <MonthDayField
            label={tr.sources.dueDay}
            value={dueDayValue}
            onChange={onDueDayChange}
            quickDays={CARD_CYCLE_QUICK_DAYS}
            unavailableDays={refusedDueDays}
            unavailableHint={tr.sources.cycleGraceTaken}
            error={error}
          />
        </View>
      </Row>
      <Body muted style={{ marginBottom: spacing.md }}>
        {grace != null ? `${tr.sources.cycleGraceDays(grace)} · ${tr.sources.cycleHint}` : tr.sources.cycleHint}
      </Body>
    </>
  );
}

/**
 * A card's cycle as a ring that fills, rather than two numbers to work out.
 *
 * The two days are already printed beside it and stay there — this does not
 * replace them, it answers the question they leave open: whether a purchase
 * made now lands on the statement about to close or the next one. Several
 * cards side by side become readable at a glance, which is the whole reason a
 * person keeps more than one.
 *
 * Drawn, never animated. It moves once a day, and motion at that rate is a
 * flicker on mount rather than something anyone perceives as movement.
 */
export function CardCycleRing({
  statementDay,
  dueDay,
  size = 22,
}: {
  statementDay: number | null;
  dueDay: number | null;
  size?: number;
}) {
  const { palette } = useTheme();
  const cycle = { statementDay, dueDay };
  if (!isValidCardCycle(cycle)) return null;
  const progress = cardCycleProgress(todayISO(), cycle);
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={tr.sources.cycleRingLabel(Math.round(progress * 100))}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={palette.border}
          strokeWidth={stroke}
          fill="none"
        />
        {/* Starts at the top and fills clockwise: the twelve-o'clock start is
            the only one a reader does not have to be told about. */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={palette.primaryText}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference * progress} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
    </View>
  );
}
