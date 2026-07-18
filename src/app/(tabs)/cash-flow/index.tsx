/**
 * Mali Tablo. A spreadsheet matrix with a pinned first column (sticky on web
 * and iOS), a pivot toggle (months as rows / columns) available on every
 * width, full Jan–Dec rows with the current month highlighted, and an
 * optional user-pinned extra column. Cells open the editor; notes show a dot.
 * Phones can also switch to a compact month-card list.
 */

import React, { useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, CalendarPlus, ChartNoAxesColumn, ChevronLeft, ChevronRight, CreditCard, Inbox, Pencil, PiggyBank, Plus, Sigma } from "lucide-react-native";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db/client";
import * as s from "../../../db/schema";
import { creditCardSplit } from "../../../domain/analytics";
import { evaluateComputedColumn, parseDefinition } from "../../../domain/computed-columns";
import { resolveYearColumns } from "../../../domain/year-columns";
import { makeMonthKey, monthKeyOf, todayISO, yearOf, type MonthKey } from "../../../domain/dates";
import { formatMinorCompact } from "../../../domain/money";
import { monthLabel, monthName, tr } from "../../../i18n/tr";
import {
  settingValue,
  toTxLike,
  useAllTransactions,
  useCategories,
  useComputedColumns,
  useLedger,
  useLive,
  usePersons,
  useSettingsMap,
  useSources,
  useUserId,
} from "../../../data/hooks";
import type { MonthLedger } from "../../../domain/balance";
import { kv } from "../../../lib/kv";
import { Amount, Button, Card, EmptyState, IconButton, Row, Screen, Segmented, Spread } from "../../../ui/components";
import { StickyTable, STICKY_HEADER_HEIGHT, STICKY_ROW_HEIGHT, type StickyColumn, type StickyRow } from "../../../ui/sticky-table";
import { radius, spacing, type, useTheme } from "../../../ui/theme";
import { lightTap } from "../../../ui/haptics";

type MatrixMode = "cards" | "rows" | "columns";

function FlowStat({
  icon: Icon,
  label,
  amountMinor,
  color,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  amountMinor: number;
  color: string;
}) {
  return (
    <View style={{ flex: 1, minWidth: 0, alignItems: "center", paddingHorizontal: 2 }}>
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: color + "1A",
        }}
      >
        <Icon size={15} color={color} />
      </View>
      <Text style={[type.small, { color, textAlign: "center", marginTop: spacing.xs, minHeight: 32 }]}>{label}</Text>
      <Text style={[type.amountSm, { color, textAlign: "center", fontSize: 12 }]}>{formatMinorCompact(amountMinor)}</Text>
    </View>
  );
}

export default function CashflowScreen() {
  const currentYear = yearOf(todayISO());
  const [year, setYear] = useState(currentYear);
  const bundle = useLedger(year);
  const categories = useCategories();
  const computed = useComputedColumns();
  const settings = useSettingsMap();
  const hiddenComputed = settingValue<string[]>(settings, "computed_columns_hidden", []);
  const visibleComputed = computed.filter((c) => !hiddenComputed.includes(c.id));
  const sources = useSources();
  const persons = usePersons();
  const allTx = useAllTransactions();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const router = useRouter();
  const { palette } = useTheme();
  const [mode, setMode] = useState<MatrixMode>("rows");
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [tableAreaH, setTableAreaH] = useState(0);
  // Card view: scroll the current month into view on open (mirrors the table's
  // current-month centering). Reset the one-shot flag whenever view/year flips.
  const cardsScrollRef = React.useRef<ScrollView>(null);
  const didFocusCards = React.useRef(false);
  React.useEffect(() => {
    didFocusCards.current = false;
  }, [mode, year]);

  React.useEffect(() => {
    void kv.get("helix.matrix.mode").then((v) => {
      if (v === "cards" || v === "rows" || v === "columns") setMode(v);
    });
    void kv.get("helix.matrix.pinned").then((v) => {
      if (v) setPinnedKey(v);
    });
  }, []);
  const changeMode = (v: MatrixMode) => {
    setMode(v);
    void kv.set("helix.matrix.mode", v);
  };
  const togglePin = (key: string) => {
    const next = pinnedKey === key ? null : key;
    setPinnedKey(next);
    void kv.set("helix.matrix.pinned", next ?? "");
  };

  const creditCardIds = new Set(sources.filter((src) => src.type === "credit_card").map((src) => src.id));
  const txLike = toTxLike(allTx, persons, categories);

  // Year switcher bounds: back to the earliest data, forward only while there
  // is actual data (e.g. installments spilling into next year).
  const minYear = bundle ? yearOf(bundle.startMonth) : currentYear;
  const lastTransaction = allTx.at(-1);
  const lastDataYear = lastTransaction ? yearOf(lastTransaction.effectiveDate) : currentYear;
  const maxYear = Math.max(currentYear, lastDataYear);

  // Per-year columns (see domain/year-columns.ts for the resolution rules).
  const columnYears = settingValue<Record<string, string[]>>(settings, "column_years", {});
  const dataCats = new Set<string>();
  bundle?.yearMonths.forEach((m) => m.byCategory.forEach((v, cid) => { if (v !== 0) dataCats.add(cid); }));
  const columnCategories = resolveYearColumns(categories, columnYears, year, maxYear, dataCats);
  // Every live category id — used to expose a repair link for legacy rows whose
  // category is missing, without inventing a special non-editable table column.
  const liveCategoryIds = new Set(categories.map((c) => c.id));

  const yearSwitcher = (
    <Row gap={spacing.sm}>
      <IconButton icon={ChevronLeft} label={String(year - 1)} onPress={() => setYear(year - 1)} disabled={year <= minYear} />
      <Text style={[type.heading, { color: palette.text, minWidth: 48, textAlign: "center" }]}>{year}</Text>
      <IconButton icon={ChevronRight} label={String(year + 1)} onPress={() => setYear(year + 1)} disabled={year >= maxYear} />
    </Row>
  );

  const orientation = mode === "columns" ? "monthsAsColumns" : "monthsAsRows";
  const showTable = mode !== "cards";
  // In column-focused view the categories are rows, so the editor label flips.
  const editLabel = orientation === "monthsAsColumns" ? tr.cashflow.editRows : tr.cashflow.editColumns;
  // Open the column/row editor as a modal so closing returns to Mali Tablo
  // (not into the Settings tab).
  const editColumns = () => router.push("/columns-editor");

  return (
    <Screen title={tr.cashflow.title} right={yearSwitcher} maxWidth={wide ? 1200 : 760} scroll={false} padded>
      {/* On phones keep the table the focus: one action row — a primary
          "İşlem Ekle" plus icon-only secondaries — instead of two wrapped rows. */}
      {wide ? (
        <Row gap={spacing.sm} style={{ marginBottom: spacing.md, flexWrap: "wrap" }}>
          <Button icon={Plus} label={tr.cashflow.addTransaction} onPress={() => router.push("/transaction")} />
          <Button icon={CreditCard} size="sm" label={tr.cashflow.installments} variant="secondary" onPress={() => router.push("/cash-flow/installments")} />
          <Button icon={ChartNoAxesColumn} size="sm" label={tr.cashflow.analysis} variant="secondary" onPress={() => router.push("/cash-flow/analytics")} />
          <Button icon={CalendarPlus} size="sm" label={tr.cashflow.bulkEntry} variant="secondary" onPress={() => router.push("/bulk-entry")} />
          {showTable ? <Button icon={Pencil} size="sm" label={editLabel} variant="secondary" onPress={editColumns} /> : null}
          <Button icon={PiggyBank} size="sm" label={tr.cashflow.openingLink} variant="ghost" onPress={() => router.push("/opening-balance")} />
        </Row>
      ) : (
        <Row gap={spacing.sm} style={{ marginBottom: spacing.sm, alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Button icon={Plus} size="sm" label={tr.cashflow.addTransaction} onPress={() => router.push("/transaction")} />
          </View>
          {showTable ? <IconButton icon={Pencil} size={40} label={editLabel} onPress={editColumns} /> : null}
          <IconButton icon={CreditCard} size={40} label={tr.cashflow.installments} onPress={() => router.push("/cash-flow/installments")} />
          <IconButton icon={ChartNoAxesColumn} size={40} label={tr.cashflow.analysis} onPress={() => router.push("/cash-flow/analytics")} />
          <IconButton icon={CalendarPlus} size={40} label={tr.cashflow.bulkEntry} onPress={() => router.push("/bulk-entry")} />
          <IconButton icon={PiggyBank} size={40} label={tr.cashflow.openingLink} onPress={() => router.push("/opening-balance")} />
        </Row>
      )}

      {!bundle ? (
        <View style={{ gap: spacing.md }}>
          <EmptyState icon={Inbox} title={tr.cashflow.emptyMonth} hint={tr.cashflow.emptyYearHint} />
          <Button icon={PiggyBank} label={tr.cashflow.openingLink} variant="secondary" onPress={() => router.push("/opening-balance")} />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {/* Full-width segmented so the month-orientation labels never clip
              (web ignores adjustsFontSizeToFit); the column editor sits below. */}
          <Segmented
            options={[
              { value: "rows", label: tr.cashflow.monthsAsRows },
              { value: "columns", label: tr.cashflow.monthsAsColumns },
              { value: "cards", label: tr.cashflow.viewCards },
            ]}
            value={mode}
            onChange={changeMode}
          />
          {showTable ? (
            <View style={{ flex: 1 }} onLayout={(e) => setTableAreaH(e.nativeEvent.layout.height)}>
              {tableAreaH > 0 ? (
                <MatrixTable
                  year={year}
                  bundle={bundle}
                  columnCategories={columnCategories}
                  computedColumns={visibleComputed}
                  creditCardIds={creditCardIds}
                  liveCategoryIds={liveCategoryIds}
                  txLike={txLike}
                  orientation={orientation}
                  compact={!wide}
                  measuredHeight={tableAreaH}
                  pinnedKey={pinnedKey}
                  onTogglePin={togglePin}
                />
              ) : null}
            </View>
          ) : (
            <ScrollView ref={cardsScrollRef} showsVerticalScrollIndicator={false}>
              {bundle.yearMonths.map((m) => {
                const isCurrent = m.month === monthKeyOf(todayISO());
                return (
                  <Card
                    key={m.month}
                    onPress={() => router.push(`/cash-flow/${m.month}`)}
                    style={isCurrent ? { borderWidth: 1.5, borderColor: palette.primary } : undefined}
                    onLayout={
                      isCurrent
                        ? (e) => {
                            if (didFocusCards.current) return;
                            didFocusCards.current = true;
                            const y = e.nativeEvent.layout.y;
                            requestAnimationFrame(() =>
                              cardsScrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.lg), animated: false }),
                            );
                          }
                        : undefined
                    }
                  >
                    <Spread>
                      <Text style={[type.heading, { color: isCurrent ? palette.primary : palette.text }]}>{monthLabel(m.month)}</Text>
                      <Amount minor={m.closingMinor} />
                    </Spread>
                    <View style={{ flexDirection: "row", gap: spacing.xs, marginTop: spacing.md, alignItems: "stretch" }}>
                      <FlowStat icon={ArrowUpRight} label={tr.cashflow.income} amountMinor={m.incomeMinor} color={palette.positive} />
                      <FlowStat icon={ArrowDownRight} label={tr.cashflow.expense} amountMinor={m.expenseMinor} color={palette.negative} />
                      <FlowStat icon={ArrowLeftRight} label={tr.cashflow.transfer} amountMinor={m.transferMinor} color={palette.textMuted} />
                    </View>
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
  /** True for user-defined computed (formula) columns — marked with an icon. */
  computed?: boolean;
  /** null = not computable (e.g. a broken computed-column definition) — the
   *  cell renders empty instead of a misleading 0. */
  value: (m: MonthLedger) => number | null;
  /** Optional action for derived columns (e.g. cc split → Taksitler screen). */
  action?: () => void;
}

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
  liveCategoryIds,
  txLike,
  orientation,
  compact,
  measuredHeight,
  pinnedKey,
  onTogglePin,
}: {
  year: number;
  bundle: NonNullable<ReturnType<typeof useLedger>>;
  columnCategories: ReturnType<typeof useCategories>;
  computedColumns: ReturnType<typeof useComputedColumns>;
  creditCardIds: Set<string>;
  liveCategoryIds: Set<string>;
  txLike: ReturnType<typeof toTxLike>;
  orientation: "monthsAsRows" | "monthsAsColumns";
  compact: boolean;
  measuredHeight: number;
  pinnedKey: string | null;
  onTogglePin: (key: string) => void;
}) {
  const { palette } = useTheme();
  const router = useRouter();
  const userId = useUserId();
  const today = todayISO();
  const currentMonth = monthKeyOf(today);

  const cellNotes = useLive(
    getDb().select().from(s.cellNotes).where(and(eq(s.cellNotes.userId, userId), isNull(s.cellNotes.deletedAt))),
    [userId],
    ["cell_notes"],
  ).data;
  const noteByCell = new Map(cellNotes.map((note) => [`${note.month}:${note.categoryId}`, note.body]));

  const dataByMonth = new Map(bundle.yearMonths.map((month) => [month.month, month]));
  const months: MonthSlot[] = Array.from({ length: 12 }, (_, index) => {
    const month = makeMonthKey(year, index + 1);
    return { month, data: dataByMonth.get(month) ?? null };
  });

  const ccByMonth = new Map<string, ReturnType<typeof creditCardSplit>>();
  for (const month of bundle.yearMonths) {
    ccByMonth.set(month.month, creditCardSplit(txLike, creditCardIds, month.month, today));
  }

  // Sum of amounts booked to a category that no longer exists (deleted) — kept
  // visible so deleting a category never makes its money disappear from the table.
  const uncategorizedValue = (m: MonthLedger): number => {
    let sum = m.uncategorizedMinor;
    m.byCategory.forEach((v, cid) => {
      if (!liveCategoryIds.has(cid)) sum += v;
    });
    return sum;
  };
  const hasUncategorized = bundle.yearMonths.some((m) => uncategorizedValue(m) !== 0);
  const uncategorizedTotal = bundle.yearMonths.reduce((sum, month) => sum + uncategorizedValue(month), 0);

  const columns: ColumnDef[] = [
    ...columnCategories.map<ColumnDef>((category) => ({
      key: category.id,
      label: category.name,
      categoryId: category.id,
      value: (month) => month.byCategory.get(category.id) ?? 0,
    })),
    ...computedColumns.map<ColumnDef>((column) => ({
      key: column.id,
      label: column.name,
      categoryId: null,
      computed: true,
      value: (month) => {
        const cc = ccByMonth.get(month.month);
        try {
          return evaluateComputedColumn(parseDefinition(JSON.parse(column.definition)), {
            month: month.month,
            byCategory: month.byCategory,
            incomeMinor: month.incomeMinor,
            expenseMinor: month.expenseMinor,
            ccSingleMinor: cc?.singleMinor ?? 0,
            ccInstallmentMinor: cc?.installmentMinor ?? 0,
          });
        } catch {
          return null; // broken definition → empty cell, not a fake 0
        }
      },
    })),
    { key: "opening", label: tr.cashflow.opening, categoryId: null, value: (month) => month.openingMinor },
    { key: "closing", label: tr.cashflow.closing, categoryId: null, value: (month) => month.closingMinor },
  ];

  const CELL_W = compact ? 104 : 128;
  const HEAD_W = compact ? 80 : 132;
  const fontSize = compact ? 12 : 13;
  // Reserve enough for the two-line hint below the table; the card clips
  // (overflow:hidden), so an under-estimate cut the hint in half on phones.
  const HINT_H = 30;
  // Breathing room between the bottom hint and the tab bar so the two never
  // crowd each other (the card is content-sized, so this leaves a real gap
  // below it before the footer).
  const FOOTER_GAP = spacing.lg;

  // Size the table to its natural content (StickyTable's fixed header/row
  // heights) but never taller than the space measured above the tab bar. When
  // there are few items (e.g. a short column-focused view) the table shrinks
  // instead of stretching to a fixed height with dead space; with many rows it
  // caps at the available height and scrolls inside.
  const rowCount = orientation === "monthsAsRows" ? months.length : columns.length;
  const naturalTableH = STICKY_HEADER_HEIGHT + rowCount * STICKY_ROW_HEIGHT + spacing.sm;
  const availTableH = Math.max(160, measuredHeight - HINT_H - FOOTER_GAP);
  const tableHeight = Math.min(naturalTableH, availTableH);

  // Tapping a category/computed column opens its month-by-month breakdown.
  // Opening/closing balances are derived summaries — intentionally not tappable.
  const openBreakdown = (key: string) => {
    const col = columns.find((c) => c.key === key);
    if (!col || col.key === "opening" || col.key === "closing") return;
    router.push({
      pathname: "/cash-flow/item",
      params: {
        col: col.categoryId ?? col.key,
        label: col.label,
        year: String(year),
        kind: col.categoryId ? "category" : "computed",
      },
    });
  };

  // Category cells open the month's cell editor; computed columns are derived
  // (no transactions to edit) so their cells open the breakdown — the same as
  // tapping their header — so no visible cell is ever a dead tap. Opening/
  // closing stay non-interactive by design.
  const pressFor = (c: ColumnDef, month: MonthKey): (() => void) | undefined => {
    if (c.categoryId) return () => router.push({ pathname: "/cell-editor", params: { month, categoryId: c.categoryId! } });
    if (c.action) return c.action;
    if (c.key === "opening" || c.key === "closing") return undefined;
    return () => openBreakdown(c.key); // computed column cell → its breakdown
  };

  const cell = (value: number | null, note: string | undefined, onPress: (() => void) | undefined, highlighted: boolean) => (
    <MatrixCell value={value} note={note} onPress={onPress} highlighted={highlighted} fontSize={fontSize} />
  );
  const breakdownFor = (key: string): (() => void) | undefined =>
    key === "opening" || key === "closing" ? undefined : () => openBreakdown(key);

  let cornerLabel: string;
  let stickyColumns: StickyColumn[];
  let stickyRows: StickyRow[];
  let currentColumnKey: string | undefined;

  if (orientation === "monthsAsRows") {
    cornerLabel = tr.cashflow.monthHeader;
    stickyColumns = columns.map((c) => ({ key: c.key, label: c.label, icon: c.computed ? Sigma : undefined }));
    stickyRows = months.map((slot) => ({
      key: slot.month,
      label: compact ? monthName(slot.month) : monthLabel(slot.month),
      onLabelPress: () => router.push(`/cash-flow/${slot.month}`),
      labelHighlight: slot.month === currentMonth,
      rowHighlight: slot.month === currentMonth,
      cells: columns.map((c) =>
        cell(
          slot.data ? c.value(slot.data) : null,
          c.categoryId ? noteByCell.get(`${slot.month}:${c.categoryId}`) : undefined,
          pressFor(c, slot.month),
          false,
        ),
      ),
    }));
  } else {
    cornerLabel = tr.cashflow.itemHeader;
    stickyColumns = months.map((slot) => ({ key: slot.month, label: monthName(slot.month) }));
    currentColumnKey = currentMonth;
    stickyRows = columns.map((c) => ({
      key: c.key,
      label: c.label,
      icon: c.computed ? Sigma : undefined,
      onLabelPress: breakdownFor(c.key),
      cells: months.map((slot) =>
        cell(
          slot.data ? c.value(slot.data) : null,
          c.categoryId ? noteByCell.get(`${slot.month}:${c.categoryId}`) : undefined,
          pressFor(c, slot.month),
          slot.month === currentMonth,
        ),
      ),
    }));
  }

  const isColumns = orientation === "monthsAsColumns";
  const validPin = pinnedKey && stickyColumns.some((c) => c.key === pinnedKey) ? pinnedKey : null;
  // Center the current month on open (only when it's in the shown year).
  const focusMonth = yearOf(currentMonth) === year ? currentMonth : undefined;

  return (
    <Card padded={false} style={{ alignSelf: "stretch" }}>
      <StickyTable
        cornerLabel={cornerLabel}
        columns={stickyColumns}
        rows={stickyRows}
        headWidth={HEAD_W}
        cellWidth={CELL_W}
        currentColumnKey={currentColumnKey}
        focusColumnKey={isColumns ? focusMonth : undefined}
        focusRowKey={isColumns ? undefined : focusMonth}
        pinnedKey={validPin}
        onTogglePin={onTogglePin}
        onColumnPress={isColumns ? (key) => router.push(`/cash-flow/${key}`) : openBreakdown}
        height={tableHeight}
      />
      {hasUncategorized ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({
            pathname: "/cash-flow/item",
            params: { col: "__uncategorized", label: tr.cashflow.uncategorizedLegacy, year: String(year), kind: "uncategorized" },
          })}
          style={({ pressed }) => ({
            marginHorizontal: spacing.md,
            marginTop: spacing.sm,
            padding: spacing.sm,
            borderRadius: radius.sm,
            backgroundColor: pressed ? palette.primarySoft : palette.surfaceAlt,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
          })}
        >
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: palette.text }]}>{tr.cashflow.uncategorizedLegacy}</Text>
            <Text style={[type.small, { color: palette.textMuted }]}>{tr.cashflow.uncategorizedRepairHint}</Text>
          </View>
          <Text style={[type.amountSm, { color: uncategorizedTotal < 0 ? palette.negative : palette.text }]}>{formatMinorCompact(uncategorizedTotal)}</Text>
          <ChevronRight size={16} color={palette.textMuted} />
        </Pressable>
      ) : null}
      <Text style={[type.small, { color: palette.textMuted, paddingVertical: spacing.xs, paddingHorizontal: spacing.md, textAlign: "center" }]}>
        {isColumns ? tr.cashflow.monthTapHint : tr.cashflow.pinHint}
      </Text>
    </Card>
  );
}

function MatrixCell({
  value,
  note,
  highlighted,
  onPress,
  fontSize,
}: {
  value: number | null;
  note?: string;
  highlighted?: boolean;
  onPress?: () => void;
  fontSize: number;
}) {
  const { palette } = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress ? () => {
        lightTap();
        onPress();
      } : undefined}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityHint={note}
      style={[
        { flex: 1, justifyContent: "center", paddingHorizontal: spacing.sm },
        highlighted && { backgroundColor: palette.primarySoft + "55" },
        hovered && onPress && { backgroundColor: palette.primarySoft },
      ]}
    >
      <Text
        style={[
          type.amountSm,
          { fontSize, color: value == null || value === 0 ? palette.textMuted : value < 0 ? palette.negative : palette.text, textAlign: "right" },
        ]}
      >
        {value == null || value === 0 ? "" : formatMinorCompact(value)}
      </Text>
      {note ? <View style={{ position: "absolute", top: 6, right: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: palette.warning }} /> : null}
    </Pressable>
  );
}
