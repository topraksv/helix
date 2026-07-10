/**
 * Mali Tablo. A spreadsheet matrix with a pinned first column (sticky on web
 * and iOS), a pivot toggle (months as rows / columns) available on every
 * width, full Jan–Dec rows with the current month highlighted, and an
 * optional user-pinned extra column. Cells open the editor; notes show a dot.
 * Phones can also switch to a compact month-card list.
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
import { StickyTable, type StickyColumn, type StickyRow } from "../../../ui/sticky-table";
import { spacing, type, useTheme } from "../../../ui/theme";

type MatrixMode = "cards" | "rows" | "columns";

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

  const creditCardIds = useMemo(
    () => new Set(sources.filter((src) => src.type === "credit_card").map((src) => src.id)),
    [sources],
  );
  const txLike = useMemo(() => toTxLike(allTx, persons), [allTx, persons]);

  // Year switcher bounds: back to the earliest data, forward only while there
  // is actual data (e.g. installments spilling into next year).
  const minYear = bundle ? yearOf(bundle.startMonth) : currentYear;
  const lastDataYear = allTx.length > 0 ? yearOf(allTx[allTx.length - 1].effectiveDate) : currentYear;
  const maxYear = Math.max(currentYear, lastDataYear);

  // Per-year columns: an imported year (or one edited via `column_years`) shows
  // exactly its recorded columns in order; other years fall back to all active
  // columns. Self-heal without extra state: a column that gained data in the
  // year surfaces automatically, and the live (max) year always shows every
  // active column so newly added ones appear.
  const columnYears = settingValue<Record<string, string[]>>(settings, "column_years", {});
  const yearColIds = columnYears[String(year)];
  const columnCategories = (() => {
    const active = categories.filter((c) => c.isColumn);
    if (!yearColIds) return active;
    const byId = new Map(categories.map((c) => [c.id, c]));
    const seen = new Set<string>();
    const out: typeof active = [];
    for (const id of yearColIds) {
      const c = byId.get(id);
      if (c && !seen.has(id)) {
        out.push(c);
        seen.add(id);
      }
    }
    const dataCats = new Set<string>();
    bundle?.yearMonths.forEach((m) => m.byCategory.forEach((v, cid) => { if (v !== 0) dataCats.add(cid); }));
    for (const c of active) {
      if (!seen.has(c.id) && (dataCats.has(c.id) || year === maxYear)) {
        out.push(c);
        seen.add(c.id);
      }
    }
    return out;
  })();

  const yearSwitcher = (
    <Row gap={spacing.sm}>
      <IconButton icon={ChevronLeft} label={String(year - 1)} onPress={() => setYear(year - 1)} disabled={year <= minYear} />
      <Text style={[type.heading, { color: palette.text, minWidth: 48, textAlign: "center" }]}>{year}</Text>
      <IconButton icon={ChevronRight} label={String(year + 1)} onPress={() => setYear(year + 1)} disabled={year >= maxYear} />
    </Row>
  );

  const orientation = mode === "columns" ? "monthsAsColumns" : "monthsAsRows";
  const showTable = mode !== "cards";

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
        </Row>
      ) : (
        <Row gap={spacing.sm} style={{ marginBottom: spacing.sm, alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Button icon={Plus} size="sm" label={tr.cashflow.addTransaction} onPress={() => router.push("/transaction")} />
          </View>
          <IconButton icon={CreditCard} size={40} label={tr.cashflow.installments} onPress={() => router.push("/cash-flow/installments")} />
          <IconButton icon={ChartNoAxesColumn} size={40} label={tr.cashflow.analysis} onPress={() => router.push("/cash-flow/analytics")} />
          <IconButton icon={CalendarPlus} size={40} label={tr.cashflow.bulkEntry} onPress={() => router.push("/bulk-entry")} />
        </Row>
      )}

      {!bundle ? (
        <EmptyState icon={Inbox} title={tr.cashflow.emptyMonth} hint={tr.cashflow.emptyYearHint} />
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
            <View style={{ alignSelf: "flex-end", marginTop: -spacing.xs, marginBottom: spacing.sm }}>
              <Button icon={Pencil} size="sm" label={tr.cashflow.editColumns} variant="ghost" onPress={() => router.push("/settings/categories")} />
            </View>
          ) : null}

          {showTable ? (
            <View style={{ flex: 1 }} onLayout={(e) => setTableAreaH(e.nativeEvent.layout.height)}>
              {tableAreaH > 0 ? (
                <MatrixTable
                  year={year}
                  bundle={bundle}
                  columnCategories={columnCategories}
                  computedColumns={visibleComputed}
                  creditCardIds={creditCardIds}
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
  ).data;
  const noteByCell = useMemo(() => new Map(cellNotes.map((n) => [`${n.month}:${n.categoryId}`, n.body])), [cellNotes]);

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
      ...columnCategories.map<ColumnDef>((c) => ({ key: c.id, label: c.name, categoryId: c.id, value: (m) => m.byCategory.get(c.id) ?? 0 })),
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

  const CELL_W = compact ? 104 : 128;
  const HEAD_W = compact ? 80 : 132;
  const fontSize = compact ? 12 : 13;
  // Reserve enough for the two-line hint below the table; the card clips
  // (overflow:hidden), so an under-estimate cut the hint in half on phones.
  const HINT_H = 52;

  // The parent measures the exact space above the tab bar (onLayout); pin the
  // table to it minus the hint row so the table — and its bottom hint — always
  // sit fully above the footer, on every platform.
  const tableHeight = compact ? Math.max(240, measuredHeight - HINT_H) : undefined;

  // Category cells open the editor; derived columns may carry their own action.
  const pressFor = (c: ColumnDef, month: MonthKey): (() => void) | undefined =>
    c.categoryId ? () => router.push({ pathname: "/cell-editor", params: { month, categoryId: c.categoryId! } }) : c.action;

  const cell = (value: number | null, note: string | undefined, onPress: (() => void) | undefined, highlighted: boolean) => (
    <MatrixCell value={value} note={note} onPress={onPress} highlighted={highlighted} fontSize={fontSize} />
  );

  let cornerLabel: string;
  let stickyColumns: StickyColumn[];
  let stickyRows: StickyRow[];
  let currentColumnKey: string | undefined;

  if (orientation === "monthsAsRows") {
    cornerLabel = tr.cashflow.monthHeader;
    stickyColumns = columns.map((c) => ({ key: c.key, label: c.label }));
    stickyRows = months.map((slot) => ({
      key: slot.month,
      label: compact ? monthLabel(slot.month).split(" ")[0] : monthLabel(slot.month),
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
    stickyColumns = months.map((slot) => ({ key: slot.month, label: monthLabel(slot.month).split(" ")[0] }));
    currentColumnKey = currentMonth;
    stickyRows = columns.map((c) => ({
      key: c.key,
      label: c.label,
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
    <Card padded={false} style={compact ? { height: measuredHeight } : { flex: 1 }}>
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
        onColumnPress={isColumns ? (key) => router.push(`/cash-flow/${key}`) : undefined}
        height={tableHeight}
      />
      <Text style={[type.small, { color: palette.textMuted, padding: spacing.sm, textAlign: "center" }]}>
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
      onPress={onPress}
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
        {value == null || value === 0 ? "—" : formatMinor(value)}
      </Text>
      {note ? <View style={{ position: "absolute", top: 6, right: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: palette.warning }} /> : null}
    </Pressable>
  );
}
