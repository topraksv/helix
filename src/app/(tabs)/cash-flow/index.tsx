/**
 * Cash-flow home. One dataset, two presentations (user requirement):
 * - narrow (phone): month cards with key totals
 * - wide (desktop web): spreadsheet matrix with a pivot toggle — months as
 *   rows × categories as columns, or transposed. Cells open an editor
 *   (transactions + note + quick entry); notes show a dot + hover tooltip.
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
import { todayISO, yearOf } from "../../../domain/dates";
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
import { kv } from "../../../lib/kv";
import { Amount, Button, Card, EmptyState, IconButton, Row, Screen, Segmented, Spread } from "../../../ui/components";
import { cardShadow, radius, spacing, type, useTheme } from "../../../ui/theme";

type Orientation = "monthsAsRows" | "monthsAsColumns";

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

  React.useEffect(() => {
    void kv.get("helix.matrix.orientation").then((v) => {
      if (v === "monthsAsRows" || v === "monthsAsColumns") setOrientation(v);
    });
  }, []);
  const changeOrientation = (v: Orientation) => {
    setOrientation(v);
    void kv.set("helix.matrix.orientation", v);
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

  return (
    <Screen title={tr.cashflow.title} right={yearSwitcher} maxWidth={wide ? 1200 : 760} scroll={false} padded>
      <Row gap={spacing.sm} style={{ marginBottom: spacing.lg, flexWrap: "wrap" }}>
        <Button icon={Plus} label={tr.cashflow.addTransaction} onPress={() => router.push("/transaction")} />
        <Button icon={CreditCard} size="sm" label={tr.cashflow.installments} variant="secondary" onPress={() => router.push("/cash-flow/installments")} />
        <Button icon={ChartNoAxesColumn} size="sm" label={tr.cashflow.analysis} variant="secondary" onPress={() => router.push("/cash-flow/analytics")} />
        <Button icon={CalendarPlus} size="sm" label={tr.cashflow.bulkEntry} variant="secondary" onPress={() => router.push("/bulk-entry")} />
      </Row>

      {!bundle || bundle.yearMonths.length === 0 ? (
        <EmptyState icon={Inbox} title={tr.cashflow.emptyMonth} hint={tr.cashflow.emptyYearHint} />
      ) : wide ? (
        <View style={{ flex: 1 }}>
          <Spread style={{ marginBottom: spacing.sm }}>
            <View style={{ width: 320 }}>
              <Segmented
                options={[
                  { value: "monthsAsRows", label: tr.cashflow.monthsAsRows },
                  { value: "monthsAsColumns", label: tr.cashflow.monthsAsColumns },
                ]}
                value={orientation}
                onChange={changeOrientation}
              />
            </View>
            <Button icon={Pencil} size="sm" label={tr.cashflow.editColumns} variant="ghost" onPress={() => router.push("/settings/categories")} />
          </Spread>
          <MatrixTable
            bundle={bundle}
            columnCategories={columnCategories}
            computedColumns={computed}
            creditCardIds={creditCardIds}
            txLike={txLike}
            orientation={orientation}
          />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {bundle.yearMonths.map((m) => (
            <Card key={m.month} onPress={() => router.push(`/cash-flow/${m.month}`)}>
              <Spread>
                <Text style={[type.heading, { color: palette.text }]}>{monthLabel(m.month)}</Text>
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
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

interface ColumnDef {
  key: string;
  label: string;
  /** Category columns open the cell editor; derived columns are read-only. */
  categoryId: string | null;
  value: (m: NonNullable<ReturnType<typeof useLedger>>["yearMonths"][number]) => number;
}

function MatrixTable({
  bundle,
  columnCategories,
  computedColumns,
  creditCardIds,
  txLike,
  orientation,
}: {
  bundle: NonNullable<ReturnType<typeof useLedger>>;
  columnCategories: ReturnType<typeof useCategories>;
  computedColumns: ReturnType<typeof useComputedColumns>;
  creditCardIds: Set<string>;
  txLike: ReturnType<typeof toTxLike>;
  orientation: Orientation;
}) {
  const { palette } = useTheme();
  const router = useRouter();
  const userId = useUserId();
  const today = todayISO();

  // Cell notes for indicator dots + hover tooltips, keyed `${month}:${categoryId}`.
  const cellNotes = useLive(
    getDb().select().from(s.cellNotes).where(and(eq(s.cellNotes.userId, userId), isNull(s.cellNotes.deletedAt))),
    [userId],
  ).data;
  const noteByCell = useMemo(() => new Map(cellNotes.map((n) => [`${n.month}:${n.categoryId}`, n.body])), [cellNotes]);

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

  const months = bundle.yearMonths;
  const monthsAsRows = orientation === "monthsAsRows";
  const HEAD_W = monthsAsRows ? 116 : 170;
  const CELL_W = monthsAsRows ? 128 : 112;

  const headerLabels = monthsAsRows ? columns.map((c) => c.label) : months.map((m) => monthLabel(m.month).split(" ")[0]);
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
                <View key={`${label}-${i}`} style={{ width: CELL_W, paddingVertical: spacing.md, paddingHorizontal: spacing.sm }}>
                  <Text style={[type.label, { color: palette.textMuted, textAlign: "right" }]} numberOfLines={2}>
                    {label}
                  </Text>
                </View>
              ))}
            </Row>
            {/* body */}
            {Array.from({ length: rowCount }, (_, rowIndex) => {
              const rowHeadLabel = monthsAsRows ? monthLabel(months[rowIndex].month) : columns[rowIndex].label;
              const cellCount = monthsAsRows ? columns.length : months.length;
              return (
                <Row
                  key={rowIndex}
                  gap={0}
                  style={{
                    borderBottomWidth: rowIndex === rowCount - 1 ? 0 : 1,
                    borderColor: palette.border,
                    backgroundColor: rowIndex % 2 === 1 ? palette.surfaceAlt + "66" : "transparent",
                  }}
                >
                  <View style={{ width: HEAD_W, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, justifyContent: "center" }}>
                    {monthsAsRows ? (
                      <Text
                        style={[type.label, { color: palette.primary, fontFamily: "Inter_600SemiBold" }]}
                        onPress={() => router.push(`/cash-flow/${months[rowIndex].month}`)}
                        accessibilityRole="link"
                      >
                        {rowHeadLabel}
                      </Text>
                    ) : (
                      <Text style={[type.label, { color: palette.text }]} numberOfLines={2}>
                        {rowHeadLabel}
                      </Text>
                    )}
                  </View>
                  {Array.from({ length: cellCount }, (_, cellIndex) => {
                    const column = monthsAsRows ? columns[cellIndex] : columns[rowIndex];
                    const month = monthsAsRows ? months[rowIndex] : months[cellIndex];
                    const value = column.value(month);
                    const note = column.categoryId ? noteByCell.get(`${month.month}:${column.categoryId}`) : undefined;
                    return (
                      <MatrixCell
                        key={cellIndex}
                        width={CELL_W}
                        value={value}
                        note={note}
                        onPress={
                          column.categoryId
                            ? () => router.push({ pathname: "/cell-editor", params: { month: month.month, categoryId: column.categoryId! } })
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
function MatrixCell({ width, value, note, onPress }: { width: number; value: number; note?: string; onPress?: () => void }) {
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
        (pressed || (hovered && onPress)) && { backgroundColor: palette.primarySoft },
      ]}
    >
      <Text
        style={[
          type.amountSm,
          { fontSize: 13, color: value < 0 ? palette.negative : value === 0 ? palette.textMuted : palette.text, textAlign: "right" },
        ]}
      >
        {value === 0 ? "—" : formatMinor(value)}
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
