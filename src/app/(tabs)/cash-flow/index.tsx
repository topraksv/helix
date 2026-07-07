/**
 * Mali Tablo. One dataset, two presentations:
 * - matrix (default on every width; compact cells on phones) with a pivot
 *   toggle, full Jan–Dec rows and the current month highlighted
 * - month cards as an optional compact view on narrow screens
 * Cells open an editor (transactions + note + quick entry); notes show a dot
 * and a hover tooltip.
 */

import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { ArrowDownRight, ArrowUpRight, CalendarPlus, ChartNoAxesColumn, ChevronLeft, ChevronRight, CreditCard, Inbox, Pencil, Plus } from "lucide-react-native";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db/client";
import * as s from "../../../db/schema";
import { creditCardSplit } from "../../../domain/analytics";
import { evaluateComputedColumn, parseDefinition } from "../../../domain/computed-columns";
import { makeMonthKey, monthKeyOf, todayISO, yearOf, type MonthKey } from "../../../domain/dates";
import { formatMinor } from "../../../domain/money";
import { monthLabel, tr } from "../../../i18n/tr";
import {
  toTxLike,
  useAllTransactions,
  useCategories,
  useComputedColumns,
  useLedger,
  useLive,
  usePersons,
  useSources,
  useUserId,
} from "../../../data/hooks";
import type { MonthLedger } from "../../../domain/balance";
import { kv } from "../../../lib/kv";
import { Amount, Button, Card, EmptyState, IconButton, Row, Screen, Segmented, Spread } from "../../../ui/components";
import { cardShadow, radius, spacing, type, useTheme } from "../../../ui/theme";

type Orientation = "monthsAsRows" | "monthsAsColumns";
type NarrowView = "table" | "cards";

export default function CashflowScreen() {
  const currentYear = yearOf(todayISO());
  const [year, setYear] = useState(currentYear);
  const bundle = useLedger(year);
  const categories = useCategories();
  const computed = useComputedColumns();
  const sources = useSources();
  const persons = usePersons();
  const allTx = useAllTransactions();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const router = useRouter();
  const { palette } = useTheme();
  const [orientation, setOrientation] = useState<Orientation>("monthsAsRows");
  const [narrowView, setNarrowView] = useState<NarrowView>("table");

  React.useEffect(() => {
    void kv.get("helix.matrix.orientation").then((v) => {
      if (v === "monthsAsRows" || v === "monthsAsColumns") setOrientation(v);
    });
    void kv.get("helix.matrix.narrowView").then((v) => {
      if (v === "table" || v === "cards") setNarrowView(v);
    });
  }, []);
  const changeOrientation = (v: Orientation) => {
    setOrientation(v);
    void kv.set("helix.matrix.orientation", v);
  };
  const changeNarrowView = (v: NarrowView) => {
    setNarrowView(v);
    void kv.set("helix.matrix.narrowView", v);
  };

  const creditCardIds = useMemo(
    () => new Set(sources.filter((src) => src.type === "credit_card").map((src) => src.id)),
    [sources],
  );
  const txLike = useMemo(() => toTxLike(allTx, persons), [allTx, persons]);
  const columnCategories = categories.filter((c) => c.isColumn);

  // Year switcher bounds: back to the workspace start, forward only while
  // there is actual data (e.g. installments spilling into next year).
  const minYear = bundle ? yearOf(bundle.startMonth) : currentYear;
  const lastDataYear = allTx.length > 0 ? yearOf(allTx[allTx.length - 1].effectiveDate) : currentYear;
  const maxYear = Math.max(currentYear, lastDataYear);

  const yearSwitcher = (
    <Row gap={spacing.sm}>
      <IconButton icon={ChevronLeft} label={String(year - 1)} onPress={() => setYear(year - 1)} disabled={year <= minYear} />
      <Text style={[type.heading, { color: palette.text, minWidth: 48, textAlign: "center" }]}>{year}</Text>
      <IconButton icon={ChevronRight} label={String(year + 1)} onPress={() => setYear(year + 1)} disabled={year >= maxYear} />
    </Row>
  );

  const showTable = wide || narrowView === "table";

  return (
    <Screen title={tr.cashflow.title} right={yearSwitcher} maxWidth={wide ? 1200 : 760} scroll={false} padded>
      <Row gap={spacing.sm} style={{ marginBottom: spacing.md, flexWrap: "wrap" }}>
        <Button icon={Plus} label={tr.cashflow.addTransaction} onPress={() => router.push("/transaction")} />
        <Button icon={CreditCard} size="sm" label={tr.cashflow.installments} variant="secondary" onPress={() => router.push("/cash-flow/installments")} />
        <Button icon={ChartNoAxesColumn} size="sm" label={tr.cashflow.analysis} variant="secondary" onPress={() => router.push("/cash-flow/analytics")} />
        <Button icon={CalendarPlus} size="sm" label={tr.cashflow.bulkEntry} variant="secondary" onPress={() => router.push("/bulk-entry")} />
      </Row>

      {!bundle ? (
        <EmptyState icon={Inbox} title={tr.cashflow.emptyMonth} hint={tr.cashflow.emptyYearHint} />
      ) : (
        <View style={{ flex: 1 }}>
          <Spread style={{ marginBottom: spacing.sm, gap: spacing.sm }}>
            <View style={{ width: wide ? 320 : 220 }}>
              {wide ? (
                <Segmented
                  options={[
                    { value: "monthsAsRows", label: tr.cashflow.monthsAsRows },
                    { value: "monthsAsColumns", label: tr.cashflow.monthsAsColumns },
                  ]}
                  value={orientation}
                  onChange={changeOrientation}
                />
              ) : (
                <Segmented
                  options={[
                    { value: "table", label: tr.cashflow.viewTable },
                    { value: "cards", label: tr.cashflow.viewCards },
                  ]}
                  value={narrowView}
                  onChange={changeNarrowView}
                />
              )}
            </View>
            <Button icon={Pencil} size="sm" label={tr.cashflow.editColumns} variant="ghost" onPress={() => router.push("/settings/categories")} />
          </Spread>

          {showTable ? (
            <MatrixTable
              year={year}
              bundle={bundle}
              columnCategories={columnCategories}
              computedColumns={computed}
              creditCardIds={creditCardIds}
              txLike={txLike}
              orientation={wide ? orientation : "monthsAsRows"}
              compact={!wide}
            />
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {bundle.yearMonths.map((m) => {
                const isCurrent = m.month === monthKeyOf(todayISO());
                return (
                  <Card
                    key={m.month}
                    onPress={() => router.push(`/cash-flow/${m.month}`)}
                    style={isCurrent ? { borderWidth: 1.5, borderColor: palette.primary } : undefined}
                  >
                    <Spread>
                      <Text style={[type.heading, { color: isCurrent ? palette.primary : palette.text }]}>{monthLabel(m.month)}</Text>
                      <Amount minor={m.closingMinor} />
                    </Spread>
                    <Row gap={spacing.lg} style={{ marginTop: spacing.md }}>
                      <Row gap={spacing.xs}>
                        <ArrowUpRight size={14} color={palette.positive} />
                        <Text style={[type.amountSm, { color: palette.positive }]}>{formatMinor(m.incomeMinor)}</Text>
                      </Row>
                      <Row gap={spacing.xs}>
                        <ArrowDownRight size={14} color={palette.negative} />
                        <Text style={[type.amountSm, { color: palette.negative }]}>{formatMinor(m.expenseMinor)}</Text>
                      </Row>
                      {m.transferMinor !== 0 ? (
                        <Text style={[type.amountSm, { color: palette.textMuted }]}>
                          {tr.cashflow.transfer}: {formatMinor(m.transferMinor)}
                        </Text>
                      ) : null}
                    </Row>
                  </Card>
                );
              })}
            </ScrollView>
          )}
        </View>
      )}
    </Screen>
  );
}

interface ColumnDef {
  key: string;
  label: string;
  /** Category columns open the cell editor; derived columns are read-only. */
  categoryId: string | null;
  value: (m: MonthLedger) => number;
}

/** A display slot for every calendar month; `data` is null before the workspace start. */
interface MonthSlot {
  month: MonthKey;
  data: MonthLedger | null;
}

function MatrixTable({
  year,
  bundle,
  columnCategories,
  computedColumns,
  creditCardIds,
  txLike,
  orientation,
  compact,
}: {
  year: number;
  bundle: NonNullable<ReturnType<typeof useLedger>>;
  columnCategories: ReturnType<typeof useCategories>;
  computedColumns: ReturnType<typeof useComputedColumns>;
  creditCardIds: Set<string>;
  txLike: ReturnType<typeof toTxLike>;
  orientation: Orientation;
  compact: boolean;
}) {
  const { palette } = useTheme();
  const router = useRouter();
  const userId = useUserId();
  const today = todayISO();
  const currentMonth = monthKeyOf(today);

  // Cell notes for indicator dots + hover tooltips, keyed `${month}:${categoryId}`.
  const cellNotes = useLive(
    getDb().select().from(s.cellNotes).where(and(eq(s.cellNotes.userId, userId), isNull(s.cellNotes.deletedAt))),
    [userId],
  ).data;
  const noteByCell = useMemo(() => new Map(cellNotes.map((n) => [`${n.month}:${n.categoryId}`, n.body])), [cellNotes]);

  // Full calendar year — months before the workspace start render as empty.
  const months = useMemo<MonthSlot[]>(() => {
    const dataByMonth = new Map(bundle.yearMonths.map((m) => [m.month, m]));
    return Array.from({ length: 12 }, (_, i) => {
      const month = makeMonthKey(year, i + 1);
      return { month, data: dataByMonth.get(month) ?? null };
    });
  }, [bundle.yearMonths, year]);

  const ccByMonth = useMemo(() => {
    const map = new Map<string, ReturnType<typeof creditCardSplit>>();
    for (const m of bundle.yearMonths) map.set(m.month, creditCardSplit(txLike, creditCardIds, m.month, today));
    return map;
  }, [bundle.yearMonths, txLike, creditCardIds, today]);

  const columns: ColumnDef[] = useMemo(
    () => [
      { key: "cc", label: tr.cashflow.ccInstallments, categoryId: null, value: (m) => ccByMonth.get(m.month)?.installmentMinor ?? 0 },
      ...columnCategories.map<ColumnDef>((c) => ({
        key: c.id,
        label: c.name,
        categoryId: c.id,
        value: (m) => m.byCategory.get(c.id) ?? 0,
      })),
      ...computedColumns.map<ColumnDef>((c) => ({
        key: c.id,
        label: c.name,
        categoryId: null,
        value: (m) => {
          const cc = ccByMonth.get(m.month);
          try {
            return evaluateComputedColumn(parseDefinition(JSON.parse(c.definition)), {
              month: m.month,
              byCategory: m.byCategory,
              incomeMinor: m.incomeMinor,
              expenseMinor: m.expenseMinor,
              ccSingleMinor: cc?.singleMinor ?? 0,
              ccInstallmentMinor: cc?.installmentMinor ?? 0,
            });
          } catch {
            return 0;
          }
        },
      })),
      { key: "opening", label: tr.cashflow.opening, categoryId: null, value: (m) => m.openingMinor },
      { key: "closing", label: tr.cashflow.closing, categoryId: null, value: (m) => m.closingMinor },
    ],
    [columnCategories, computedColumns, ccByMonth],
  );

  const monthsAsRows = orientation === "monthsAsRows";
  const HEAD_W = compact ? 96 : monthsAsRows ? 116 : 170;
  const CELL_W = compact ? 98 : monthsAsRows ? 128 : 112;
  const fontSize = compact ? 12 : 13;

  const headerLabels = monthsAsRows
    ? columns.map((c) => c.label)
    : months.map((m) => monthLabel(m.month).split(" ")[0]);
  const currentHeaderIdx = monthsAsRows ? -1 : months.findIndex((m) => m.month === currentMonth);
  const rowCount = monthsAsRows ? months.length : columns.length;

  return (
    <Card padded={false} style={{ flex: 1 }}>
      <ScrollView>
        <ScrollView horizontal>
          <View>
            {/* header row */}
            <Row gap={0} style={{ borderBottomWidth: 1, borderColor: palette.border, backgroundColor: palette.surfaceAlt }}>
              <View style={{ width: HEAD_W, paddingVertical: spacing.md, paddingHorizontal: spacing.sm }}>
                <Text style={[type.label, { color: palette.textMuted }]}>{monthsAsRows ? tr.cashflow.monthHeader : tr.cashflow.itemHeader}</Text>
              </View>
              {headerLabels.map((label, i) => (
                <View
                  key={`${label}-${i}`}
                  style={{
                    width: CELL_W,
                    paddingVertical: spacing.md,
                    paddingHorizontal: spacing.sm,
                    backgroundColor: i === currentHeaderIdx ? palette.primarySoft : "transparent",
                  }}
                >
                  <Text
                    style={[
                      type.label,
                      { color: i === currentHeaderIdx ? palette.primary : palette.textMuted, textAlign: "right" },
                    ]}
                    numberOfLines={2}
                  >
                    {label}
                  </Text>
                </View>
              ))}
            </Row>
            {/* body */}
            {Array.from({ length: rowCount }, (_, rowIndex) => {
              const rowMonth = monthsAsRows ? months[rowIndex] : null;
              const isCurrentRow = rowMonth?.month === currentMonth;
              const rowHeadLabel = monthsAsRows ? monthLabel(months[rowIndex].month) : columns[rowIndex].label;
              const cellCount = monthsAsRows ? columns.length : months.length;
              return (
                <Row
                  key={rowIndex}
                  gap={0}
                  style={{
                    borderBottomWidth: rowIndex === rowCount - 1 ? 0 : 1,
                    borderColor: palette.border,
                    backgroundColor: isCurrentRow
                      ? palette.primarySoft + "55"
                      : rowIndex % 2 === 1
                        ? palette.surfaceAlt + "66"
                        : "transparent",
                  }}
                >
                  <View style={{ width: HEAD_W, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, justifyContent: "center" }}>
                    {monthsAsRows ? (
                      <Text
                        style={[
                          type.label,
                          {
                            color: palette.primary,
                            fontFamily: isCurrentRow ? "Inter_700Bold" : "Inter_600SemiBold",
                            fontSize: compact ? 12 : 13,
                          },
                        ]}
                        onPress={() => router.push(`/cash-flow/${rowMonth!.month}`)}
                        accessibilityRole="link"
                        numberOfLines={1}
                      >
                        {compact ? rowHeadLabel.split(" ")[0] : rowHeadLabel}
                      </Text>
                    ) : (
                      <Text style={[type.label, { color: palette.text, fontSize: compact ? 12 : 13 }]} numberOfLines={2}>
                        {rowHeadLabel}
                      </Text>
                    )}
                  </View>
                  {Array.from({ length: cellCount }, (_, cellIndex) => {
                    const column = monthsAsRows ? columns[cellIndex] : columns[rowIndex];
                    const slot = monthsAsRows ? months[rowIndex] : months[cellIndex];
                    const isCurrentCol = !monthsAsRows && slot.month === currentMonth;
                    const value = slot.data ? column.value(slot.data) : null;
                    const note = column.categoryId ? noteByCell.get(`${slot.month}:${column.categoryId}`) : undefined;
                    return (
                      <MatrixCell
                        key={cellIndex}
                        width={CELL_W}
                        fontSize={fontSize}
                        value={value}
                        note={note}
                        highlighted={isCurrentCol}
                        onPress={
                          column.categoryId
                            ? () => router.push({ pathname: "/cell-editor", params: { month: slot.month, categoryId: column.categoryId! } })
                            : undefined
                        }
                      />
                    );
                  })}
                </Row>
              );
            })}
          </View>
        </ScrollView>
      </ScrollView>
    </Card>
  );
}

/** One matrix cell: tabular number, note dot, hover tooltip (web). */
function MatrixCell({
  width,
  fontSize,
  value,
  note,
  highlighted,
  onPress,
}: {
  width: number;
  fontSize: number;
  value: number | null;
  note?: string;
  highlighted?: boolean;
  onPress?: () => void;
}) {
  const { palette, scheme } = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityHint={note}
      style={({ pressed }) => [
        { width, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, justifyContent: "center" },
        highlighted && { backgroundColor: palette.primarySoft + "55" },
        (pressed || (hovered && onPress)) && { backgroundColor: palette.primarySoft },
      ]}
    >
      <Text
        style={[
          type.amountSm,
          {
            fontSize,
            color: value == null || value === 0 ? palette.textMuted : value < 0 ? palette.negative : palette.text,
            textAlign: "right",
          },
        ]}
      >
        {value == null || value === 0 ? "—" : formatMinor(value)}
      </Text>
      {note ? (
        <View style={{ position: "absolute", top: 6, right: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: palette.warning }} />
      ) : null}
      {note && hovered ? (
        <View
          style={[
            {
              position: "absolute",
              bottom: "100%",
              right: 0,
              maxWidth: 260,
              minWidth: 140,
              backgroundColor: scheme === "dark" ? palette.surfaceAlt : palette.text,
              borderRadius: radius.sm,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              zIndex: 10,
            },
            cardShadow,
          ]}
          pointerEvents="none"
        >
          <Text style={[type.small, { color: scheme === "dark" ? palette.text : palette.background }]}>{note}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
