/**
 * Mali Tablo. A spreadsheet matrix with a pinned first column (sticky on web
 * and iOS), a pivot toggle (months as rows / columns) available on every
 * width, full Jan–Dec rows with the current month highlighted, and an
 * optional user-pinned extra column. Cells open the editor; notes show a dot.
 * Phones can also switch to a no-horizontal-scroll, month-focused table.
 */

import React, { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useRouter, type Href } from "expo-router";
import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, CalendarPlus, ChartNoAxesColumn, ChevronLeft, ChevronRight, CreditCard, Inbox, Info, Pencil, PiggyBank, Plus, Sigma } from "lucide-react-native";
import { monthFlowTotals } from "../../../domain/balance";
import { buildCashFlowMatrixModel, type CashFlowMatrixColumn } from "../../../domain/cash-flow-matrix";
import { resolveYearColumns } from "../../../domain/year-columns";
import { monthKeyOf, todayISO, yearOf, type MonthKey } from "../../../domain/dates";
import { resolveMatrixMode, type MatrixMode } from "../../../domain/matrix-preferences";
import { formatMinor, formatMinorCompact } from "../../../domain/money";
import { monthLabel, monthName, shortMonthLabel, tr } from "../../../i18n/tr";
import {
  settingValue,
  toTxLike,
  useAllTransactionsState,
  useCellNotesState,
  useCategoriesState,
  useComputedColumnsState,
  useLedgerState,
  usePersonsState,
  useSettingsMapState,
  useSourcesState,
  type LedgerBundle,
} from "../../../data/hooks";
import { combineLiveQueryStatus } from "../../../data/live-state";
import { kv } from "../../../services/kv";
import { Amount, Button, Card, DataStateNotice, EmptyState, IconButton, Row, Screen, Segmented, Spread } from "../../../ui/components";
import { useScrollToTop } from "@react-navigation/native";
import { StickyTable, STICKY_HEADER_HEIGHT, STICKY_ROW_HEIGHT, type StickyColumn, type StickyRow } from "../../../ui/sticky-table";
import { controlSize, radius, spacing, type, useTheme } from "../../../ui/theme";
import { shouldUseWideWorkspace } from "../../../ui/responsive";
import { useClusterWidth, useContentWidth } from "../../../ui/viewport";
import { categoryIcon } from "../../../data/category-icons";

type MatrixModel = ReturnType<typeof buildCashFlowMatrixModel>;

/** Phone toolbar item: icon + always-visible mini caption. Five equal tools
 *  share one 44px band so the matrix, not its chrome, owns the screen. */
function MatrixTool({
  icon: IconCmp,
  caption,
  label,
  onPress,
}: {
  icon: React.ComponentType<{ size?: number; color?: string; accessible?: boolean; strokeWidth?: number }>;
  caption: string;
  label: string;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={{ flex: 1, flexBasis: 0, minWidth: 0, minHeight: controlSize.minimumTarget, alignItems: "center", justifyContent: "center", gap: 1 }}
    >
      {({ pressed }) => (
        <>
          <View
            style={{
              width: 30,
              height: 28,
              borderRadius: radius.sm,
              backgroundColor: pressed ? palette.surfaceHover : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconCmp accessible={false} size={15} color={palette.textSecondary} strokeWidth={2} />
          </View>
          <Text style={[type.small, { fontSize: 9, lineHeight: 11, color: palette.textSecondary, textAlign: "center" }]}>{caption}</Text>
        </>
      )}
    </Pressable>
  );
}

function FlowStat({
  icon: Icon,
  label,
  amountMinor,
  color,
  foreground = color,
}: {
  icon: React.ComponentType<{ size?: number; color?: string; accessible?: boolean }>;
  label: string;
  amountMinor: number;
  color: string;
  foreground?: string;
}) {
  return (
    <View style={{ flex: 1, minWidth: 0, alignItems: "center", paddingHorizontal: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs }}>
        <Icon accessible={false} size={13} color={color} />
        <Text style={[type.small, { color: foreground, textAlign: "center", fontSize: 11 }]}>{label}</Text>
      </View>
      <Text style={[type.amountSm, { color: foreground, textAlign: "center", fontSize: 12, marginTop: 2 }]}>{formatMinorCompact(amountMinor)}</Text>
    </View>
  );
}

/** Edit, installments, analysis, bulk entry, opening balance. Named so the
 *  cluster's bound and the row it bounds cannot disagree about the count. */
const MATRIX_TOOL_COUNT = 5;

/** The pivot's three orientations, named so the control and the wrapper that
 *  bounds it cannot disagree about how many segments there are. */
const PIVOT_MODES = [
  { value: "rows" as MatrixMode, label: tr.cashflow.monthsAsRows },
  { value: "columns" as MatrixMode, label: tr.cashflow.monthsAsColumns },
  { value: "cards" as MatrixMode, label: tr.cashflow.viewCards },
];

export default function CashflowScreen() {
  const currentYear = yearOf(todayISO());
  const [year, setYear] = useState(currentYear);
  const ledgerState = useLedgerState(year);
  const categoriesState = useCategoriesState();
  const computedState = useComputedColumnsState();
  const settingsState = useSettingsMapState();
  const sourcesState = useSourcesState();
  const personsState = usePersonsState();
  const allTxState = useAllTransactionsState();
  const cellNotesState = useCellNotesState();
  const bundle = ledgerState.data;
  const categories = categoriesState.data;
  const computed = computedState.data;
  const settings = settingsState.data;
  const hiddenComputed = settingValue<string[]>(settings, "computed_columns_hidden", []);
  const visibleComputed = computed.filter((c) => !hiddenComputed.includes(c.id));
  const sources = sourcesState.data;
  const persons = personsState.data;
  const allTx = allTxState.data;
  const liveStates = [ledgerState, categoriesState, computedState, settingsState, sourcesState, personsState, allTxState, cellNotesState];
  const dataStatus = combineLiveQueryStatus(liveStates);
  const retryData = () => {
    ledgerState.retry();
    categoriesState.retry();
    computedState.retry();
    settingsState.retry();
    sourcesState.retry();
    personsState.retry();
    allTxState.retry();
    cellNotesState.retry();
  };
  const { width } = useWindowDimensions();
  const contentWidth = useContentWidth();
  const wide = shouldUseWideWorkspace(contentWidth);
  const toolClusterWidth = useClusterWidth(MATRIX_TOOL_COUNT);
  const router = useRouter();
  const { palette } = useTheme();
  // A phone needs the category-first scan of column mode; a wide workspace has
  // room for the year-wide row mode. Once the owner chooses, that persisted
  // preference wins over device width on every later mount.
  const defaultMode: MatrixMode = wide ? "rows" : "columns";
  const [mode, setMode] = useState<MatrixMode>(defaultMode);
  const [hasSavedMode, setHasSavedMode] = useState<boolean | null>(null);
  const [focusMonthNumber, setFocusMonthNumber] = useState(Number(monthKeyOf(todayISO()).slice(5, 7)));
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [tableAreaH, setTableAreaH] = useState(0);
  // Desktop starts with the reading guide open so the table explains itself;
  // every viewport can collapse it once the user knows the grammar.
  const [showTableDetails, setShowTableDetails] = useState(() => width >= 600);
  // The tab's repeat-press behavior needs the active month-focused scroller.
  const monthFocusScrollRef = React.useRef<ScrollView>(null);
  const tableRef = useRef<ScrollView>(null);
  React.useEffect(() => {
    void kv.get("helix.matrix.mode").then((v) => {
      setHasSavedMode(Boolean(v));
      setMode(v ? resolveMatrixMode(v) : defaultMode);
    });
    void kv.get("helix.matrix.pinned").then((v) => {
      if (v) setPinnedKey(v);
    });
  }, [defaultMode]);
  React.useEffect(() => {
    if (hasSavedMode === false) setMode(defaultMode);
  }, [defaultMode, hasSavedMode]);
  const changeMode = (v: MatrixMode) => {
    setMode(v);
    if (v === "cards") setShowTableDetails(false);
    setHasSavedMode(true);
    void kv.set("helix.matrix.mode", v);
  };
  const togglePin = (key: string) => {
    const next = pinnedKey === key ? null : key;
    setPinnedKey(next);
    void kv.set("helix.matrix.pinned", next ?? "");
  };
  const focusMonth = `${year}-${String(focusMonthNumber).padStart(2, "0")}` as MonthKey;

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
  const tableMatrix = bundle
    ? buildCashFlowMatrixModel({
        year,
        yearMonths: bundle.yearMonths,
        categories: columnCategories,
        computedColumns: visibleComputed,
        transactions: txLike,
        creditCardIds,
        liveCategoryIds,
        today: todayISO(),
        openingLabel: tr.cashflow.opening,
        closingLabel: tr.cashflow.closing,
      })
    : null;

  const yearSwitcher = (
    <Row testID="cash-flow-year-control" gap={spacing.sm}>
      <IconButton size={36} icon={ChevronLeft} label={String(year - 1)} onPress={() => setYear(year - 1)} disabled={year <= minYear} />
      <Text style={[type.label, { color: palette.text, minWidth: 44, textAlign: "center" }]}>{year}</Text>
      <IconButton size={36} icon={ChevronRight} label={String(year + 1)} onPress={() => setYear(year + 1)} disabled={year >= maxYear} />
    </Row>
  );

  const orientation = mode === "columns" ? "monthsAsColumns" : "monthsAsRows";
  const showTable = mode !== "cards";
  // This tab hosts its own scroller instead of `Screen`'s, and swaps between
  // two, so the tab-press-returns-to-top hook is pointed at whichever view is
  // mounted. The hook re-subscribes when the ref identity changes.
  useScrollToTop(showTable ? tableRef : monthFocusScrollRef);
  // In column-focused view the categories are rows, so the editor label flips.
  const editLabel = orientation === "monthsAsColumns" ? tr.cashflow.editRows : tr.cashflow.editColumns;
  // Open the column/row editor as a modal so closing returns to Mali Tablo
  // (not into the Settings tab).
  const editColumns = () => router.push("/columns-editor");

  return (
    <Screen title={tr.cashflow.title} right={yearSwitcher} width="workspace" scroll={false} padded>
      <View
        style={{
          gap: spacing.sm,
          marginBottom: spacing.sm,
        }}
      >
        {wide ? (
          <View
            testID="cash-flow-action-toolbar"
            style={{
              flexDirection: "row",
              alignItems: "center",
              flexWrap: "wrap",
              gap: spacing.sm,
              padding: spacing.xs,
              borderRadius: radius.md,
              backgroundColor: palette.surface,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: palette.border + "70",
            }}
          >
            <Button icon={Plus} label={tr.cashflow.addTransaction} onPress={() => router.push("/transaction")} />
            <Row gap={spacing.sm} style={{ flex: 1, minWidth: 0, flexWrap: "wrap" }}>
              <Button icon={CreditCard} size="sm" label={tr.cashflow.installments} variant="secondary" onPress={() => router.push("/cash-flow/installments")} />
              <Button icon={ChartNoAxesColumn} size="sm" label={tr.cashflow.analysis} variant="secondary" onPress={() => router.push("/cash-flow/analytics")} />
              <Button icon={CalendarPlus} size="sm" label={tr.cashflow.bulkEntry} variant="secondary" onPress={() => router.push("/bulk-entry")} />
              <Button icon={Pencil} size="sm" label={editLabel} variant="secondary" onPress={editColumns} />
              <Button icon={PiggyBank} size="sm" label={tr.cashflow.openingLink} variant="ghost" onPress={() => router.push("/opening-balance")} />
            </Row>
          </View>
        ) : (
          <View style={{ gap: spacing.xs, maxWidth: toolClusterWidth, width: "100%" }}>
            <Button icon={Plus} size="sm" label={tr.cashflow.addTransaction} onPress={() => router.push("/transaction")} />
            {/* Five icon tools are a cluster, not a band. Given the row they
                spread one tool per 145px on a tablet, which reads as five
                unrelated buttons pinned to the edges of a gap; bounded, they
                stay a group whose width comes from its own items. A phone is
                below the bound and keeps the full-width band it needs. */}
            <Row gap={2} style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "nowrap", maxWidth: toolClusterWidth, width: "100%" }}>
              <MatrixTool icon={Pencil} caption={tr.cashflow.toolEdit} label={editLabel} onPress={editColumns} />
              <MatrixTool icon={CreditCard} caption={tr.cashflow.toolInstallments} label={tr.cashflow.installments} onPress={() => router.push("/cash-flow/installments")} />
              <MatrixTool icon={ChartNoAxesColumn} caption={tr.cashflow.toolAnalysis} label={tr.cashflow.analysis} onPress={() => router.push("/cash-flow/analytics")} />
              <MatrixTool icon={CalendarPlus} caption={tr.cashflow.toolBulk} label={tr.cashflow.bulkEntry} onPress={() => router.push("/bulk-entry")} />
              <MatrixTool icon={PiggyBank} caption={tr.cashflow.toolOpening} label={tr.cashflow.openingLink} onPress={() => router.push("/opening-balance")} />
            </Row>
          </View>
        )}
      </View>

      <DataStateNotice status={dataStatus} retry={retryData} />

      {!bundle ? (
        dataStatus === "loading" || dataStatus === "error" ? null : (
          <EmptyState
            icon={Inbox}
            title={tr.cashflow.emptyMonth}
            hint={tr.cashflow.emptyYearHint}
            action={<Button icon={PiggyBank} label={tr.cashflow.openingLink} variant="secondary" onPress={() => router.push("/opening-balance")} />}
          />
        )
      ) : (
        <View style={{ flex: 1 }}>
          {/* The pivot fills the row on a phone so its month-orientation labels
              never clip (web ignores adjustsFontSizeToFit), and stops at the
              control's own bound above that. The wrapper carries the same bound:
              left to stretch it parked the guide button a thousand pixels away
              from the control it explains on a wide monitor. */}
          {/* The guide toggle lives inside the pivot's own strip, so it shares
              its height, its baseline and its selected treatment instead of
              sitting beside it as a taller bordered square. */}
          <View style={{ marginBottom: spacing.md }}>
            <Segmented
              noMargin
              options={PIVOT_MODES}
              value={mode}
              onChange={changeMode}
              action={showTable
                ? {
                    icon: Info,
                    label: tr.cashflow.tableGuide,
                    active: showTableDetails,
                    onPress: () => setShowTableDetails((visible) => !visible),
                  }
                : undefined}
            />
          </View>
          {showTable && tableMatrix && showTableDetails ? (
            <TableDetailsPanel
              hasUncategorized={tableMatrix.hasUncategorized}
              uncategorizedTotal={tableMatrix.uncategorizedTotal}
              onOpenUncategorized={() => router.push({
                pathname: "/cash-flow/item",
                params: { col: "__uncategorized", label: tr.cashflow.uncategorizedLegacy, year: String(year), kind: "uncategorized" },
              })}
            />
          ) : null}
          {showTable ? (
            <View style={{ flex: 1 }} onLayout={(e) => setTableAreaH(e.nativeEvent.layout.height)}>
              {tableAreaH > 0 ? (
                <MatrixTable
                  scrollRef={tableRef}
                  year={year}
                  bundle={bundle}
                  matrix={tableMatrix!}
                  cellNotes={cellNotesState.data}
                  orientation={orientation}
                  compact={!wide}
                  measuredHeight={tableAreaH}
                  pinnedKey={pinnedKey}
                  onTogglePin={togglePin}
                />
              ) : null}
            </View>
          ) : (
            <ScrollView ref={monthFocusScrollRef} showsVerticalScrollIndicator={false}>
              <MonthFocusTable
                year={year}
                month={focusMonth}
                onMonthChange={setFocusMonthNumber}
                bundle={bundle}
                columnCategories={columnCategories}
                computedColumns={visibleComputed}
                creditCardIds={creditCardIds}
                liveCategoryIds={liveCategoryIds}
                txLike={txLike}
                cellNotes={cellNotesState.data}
              />
            </ScrollView>
          )}
        </View>
      )}
    </Screen>
  );
}

function MonthFocusTable({
  year,
  month,
  onMonthChange,
  bundle,
  columnCategories,
  computedColumns,
  creditCardIds,
  liveCategoryIds,
  txLike,
  cellNotes,
}: {
  year: number;
  month: MonthKey;
  onMonthChange: (monthNumber: number) => void;
  bundle: LedgerBundle;
  columnCategories: ReturnType<typeof useCategoriesState>["data"];
  computedColumns: ReturnType<typeof useComputedColumnsState>["data"];
  creditCardIds: Set<string>;
  liveCategoryIds: Set<string>;
  txLike: ReturnType<typeof toTxLike>;
  cellNotes: ReturnType<typeof useCellNotesState>["data"];
}) {
  const { palette } = useTheme();
  const router = useRouter();
  const today = todayISO();
  const monthNumber = Number(month.slice(5, 7));
  const matrix = buildCashFlowMatrixModel({
    year,
    yearMonths: bundle.yearMonths,
    categories: columnCategories,
    computedColumns,
    transactions: txLike,
    creditCardIds,
    liveCategoryIds,
    today,
    openingLabel: tr.cashflow.opening,
    closingLabel: tr.cashflow.closing,
  });
  const monthData = bundle.yearMonths.find((item) => item.month === month);
  const flows = monthData ? monthFlowTotals(monthData) : null;
  const noteByCategory = new Map(
    cellNotes.filter((note) => note.month === month).map((note) => [note.categoryId, note.body]),
  );
  const adjustmentNote = monthData?.adjustmentMinor
    ? tr.cashflow.adjustedCell(formatMinor(monthData.adjustmentMinor))
    : undefined;

  const actionFor = (column: CashFlowMatrixColumn): (() => void) | undefined => {
    if (column.categoryId) {
      return () => router.push({ pathname: "/cell-editor", params: { month, categoryId: column.categoryId! } });
    }
    if (column.key === "closing" && adjustmentNote) return () => router.push("/opening-balance" as Href);
    if (column.system) return undefined;
    return () => router.push({
      pathname: "/cash-flow/item",
      params: {
        col: column.key,
        label: column.label,
        year: String(year),
        kind: "computed",
      },
    });
  };

  return (
    <View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: palette.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.border,
          borderRadius: radius.md,
          padding: spacing.xs,
          marginBottom: spacing.sm,
        }}
      >
        <IconButton
          icon={ChevronLeft}
          size={36}
          label={monthLabel(`${year}-${String(Math.max(1, monthNumber - 1)).padStart(2, "0")}`)}
          disabled={monthNumber <= 1}
          onPress={() => onMonthChange(monthNumber - 1)}
        />
        <Text accessibilityRole="header" style={[type.heading, { color: month === monthKeyOf(today) ? palette.primaryText : palette.text }]}>
          {monthLabel(month)}
        </Text>
        <IconButton
          icon={ChevronRight}
          size={36}
          label={monthLabel(`${year}-${String(Math.min(12, monthNumber + 1)).padStart(2, "0")}`)}
          disabled={monthNumber >= 12}
          onPress={() => onMonthChange(monthNumber + 1)}
        />
      </View>

      {flows ? (
        <Card style={{ padding: spacing.md }}>
          <Spread style={{ alignItems: "center" }}>
            <View>
              <Text style={[type.small, { color: palette.textSecondary }]}>{tr.cashflow.closing}</Text>
              <Amount minor={flows.closingMinor} large />
            </View>
            <IconButton icon={ChevronRight} size={36} label={tr.cashflow.openMonth} onPress={() => router.push(`/cash-flow/${month}`)} />
          </Spread>
          <View style={{ flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm }}>
            <FlowStat icon={ArrowUpRight} label={tr.cashflow.income} amountMinor={flows.incomeMinor} color={palette.positive} foreground={palette.positiveText} />
            <FlowStat icon={ArrowDownRight} label={tr.cashflow.expense} amountMinor={flows.expenseMinor} color={palette.negative} foreground={palette.negativeText} />
            <FlowStat icon={ArrowLeftRight} label={tr.cashflow.transfer} amountMinor={flows.transferMinor} color={palette.textSecondary} />
          </View>
        </Card>
      ) : null}

      <Card padded={false}>
        <View
          style={{
            minHeight: 42,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: spacing.md,
            backgroundColor: palette.surfaceAlt,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border,
          }}
        >
          <Text style={[type.label, { color: palette.textSecondary, flex: 1 }]}>{tr.cashflow.itemHeader}</Text>
          <Text style={[type.label, { color: palette.textSecondary, width: 108, textAlign: "right" }]}>{tr.tx.amount}</Text>
        </View>
        {matrix.columns.map((column, index) => {
          const category = column.categoryId
            ? columnCategories.find((item) => item.id === column.categoryId)
            : undefined;
          const value = column.values.get(month) ?? 0;
          const note = column.key === "closing"
            ? adjustmentNote
            : column.categoryId
              ? noteByCategory.get(column.categoryId)
              : undefined;
          const onPress = actionFor(column);
          const iconText = category ? categoryIcon(category) : null;
          return (
            <Pressable
              key={column.key}
              disabled={!onPress}
              onPress={onPress}
              role={onPress ? "button" : "group"}
              accessibilityLabel={tr.a11y.matrixCell(monthLabel(month), column.label, formatMinor(value), Boolean(note))}
              accessibilityHint={note}
              style={({ pressed }) => ({
                minHeight: 48,
                flexDirection: "row",
                alignItems: "center",
                paddingLeft: spacing.sm,
                paddingRight: spacing.md,
                borderBottomWidth: index < matrix.columns.length - 1 ? StyleSheet.hairlineWidth : 0,
                borderColor: palette.border,
                backgroundColor: pressed ? palette.surfaceHover : "transparent",
              })}
            >
              <View
                style={{
                  width: 30,
                  height: 30,
                  flexShrink: 0,
                  borderRadius: 10,
                  backgroundColor: column.computed ? palette.tertiarySoft : palette.surfaceAlt,
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: spacing.sm,
                }}
              >
                {column.computed ? (
                  <Sigma accessible={false} size={15} color={palette.tertiaryText} />
                ) : iconText ? (
                  <Text style={{ fontSize: 14 }}>{iconText}</Text>
                ) : (
                  <PiggyBank accessible={false} size={15} color={palette.textSecondary} />
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0, paddingVertical: spacing.sm }}>
                <Text testID="table-row-label" style={[type.label, { color: onPress ? palette.text : palette.textSecondary }]}>
                  {column.label}
                </Text>
                {note ? (
                  <Text style={[type.small, { color: column.key === "closing" ? palette.primaryText : palette.warningText, marginTop: 2 }]}>
                    {note}
                  </Text>
                ) : null}
              </View>
              <Text
                testID="matrix-value"
                style={[
                  type.amountSm,
                  {
                    width: 108,
                    textAlign: "right",
                    color: value < 0 ? palette.negativeText : value === 0 ? palette.textSecondary : palette.text,
                    fontSize: 12,
                  },
                ]}
              >
                {formatMinorCompact(value)}
              </Text>
            </Pressable>
          );
        })}
        {matrix.hasUncategorized ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({
              pathname: "/cash-flow/item",
              params: { col: "__uncategorized", label: tr.cashflow.uncategorizedLegacy, year: String(year), kind: "uncategorized" },
            })}
            style={{ padding: spacing.md, backgroundColor: palette.warning + "12" }}
          >
            <Spread>
              <Text style={[type.label, { color: palette.warningText, flex: 1 }]}>{tr.cashflow.uncategorizedLegacy}</Text>
              <Text style={[type.amountSm, { color: palette.warningText }]}>{formatMinorCompact(matrix.uncategorizedTotal)}</Text>
            </Spread>
            <Text style={[type.small, { color: palette.textSecondary, marginTop: 2 }]}>{tr.cashflow.uncategorizedRepairHint}</Text>
          </Pressable>
        ) : null}
      </Card>
    </View>
  );
}

function TableDetailsPanel({
  hasUncategorized,
  uncategorizedTotal,
  onOpenUncategorized,
}: {
  hasUncategorized: boolean;
  uncategorizedTotal: number;
  onOpenUncategorized: () => void;
}) {
  const { palette } = useTheme();
  return (
    <View
      testID="cash-flow-table-details-content"
      style={{
        marginBottom: spacing.sm,
        padding: spacing.md,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.primary + "60",
        backgroundColor: palette.surfaceAlt,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Info accessible={false} size={17} color={palette.accentText} strokeWidth={2.2} />
        <Text style={[type.heading, { color: palette.textStrong, flex: 1, minWidth: 0 }]}>{tr.cashflow.tableGuide}</Text>
      </View>
      <Text style={[type.small, { color: palette.textSecondary }]}>{tr.cashflow.tableHint}</Text>
      {hasUncategorized ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr.cashflow.uncategorizedLegacy}
          onPress={onOpenUncategorized}
          style={({ pressed }) => ({
            padding: spacing.sm,
            borderRadius: radius.sm,
            backgroundColor: pressed ? palette.primarySoft : palette.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.warning + "55",
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
          })}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.label, { color: palette.warningText }]}>{tr.cashflow.uncategorizedLegacy}</Text>
            <Text style={[type.small, { color: palette.textSecondary }]}>{tr.cashflow.uncategorizedRepairHint}</Text>
          </View>
          <Text style={[type.amountSm, { color: uncategorizedTotal < 0 ? palette.negativeText : palette.text }]}>
            {formatMinorCompact(uncategorizedTotal)}
          </Text>
          <ChevronRight accessible={false} size={16} color={palette.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

function MatrixTable({
  year,
  bundle,
  matrix,
  cellNotes,
  orientation,
  compact,
  measuredHeight,
  pinnedKey,
  onTogglePin,
  scrollRef,
}: {
  year: number;
  bundle: LedgerBundle;
  matrix: MatrixModel;
  cellNotes: ReturnType<typeof useCellNotesState>["data"];
  orientation: "monthsAsRows" | "monthsAsColumns";
  compact: boolean;
  measuredHeight: number;
  pinnedKey: string | null;
  onTogglePin: (key: string) => void;
  scrollRef: React.RefObject<ScrollView | null>;
}) {
  const { width: viewportWidth } = useWindowDimensions();
  const router = useRouter();
  const today = todayISO();
  const currentMonth = monthKeyOf(today);

  const noteByCell = new Map(cellNotes.map((note) => [`${note.month}:${note.categoryId}`, note.body]));
  // A reconciled month looks exactly like an ordinary one in this table, so the
  // closing figure silently stopped matching the flows above it. It carries the
  // same marker a cell note does — the cell has something extra behind it.
  const adjustmentByMonth = new Map(
    bundle.yearMonths
      .filter((month) => month.adjustmentMinor !== 0)
      .map((month) => [month.month, tr.cashflow.adjustedCell(formatMinor(month.adjustmentMinor))]),
  );
  const noteFor = (column: { key: string; categoryId?: string | null }, month: MonthKey): string | undefined =>
    column.key === "closing"
      ? adjustmentByMonth.get(month)
      : column.categoryId
        ? noteByCell.get(`${month}:${column.categoryId}`)
        : undefined;

  const { months, columns } = matrix;

  /**
   * The two pivots do not share a useful first-column shape.
   *
   * - Row-focused: the fixed column contains month names, so keeping it narrow
   *   buys another complete financial column on a phone.
   * - Column-focused: the fixed column contains user-authored category names,
   *   so it gets prose width and may grow vertically instead of crushing text
   *   into the same month-sized box.
   */
  // The compact month rail follows the longest translated month instead of a
  // category-derived fixed width. Web's measured 13px semibold glyph ceiling
  // is 7.7px, while iOS shapes the same word a few points wider; the 96pt
  // platform floor keeps "Temmuz" whole instead of letting its final letter
  // wrap. The other pivot keeps its wider prose rail.
  const compactMonthHeadWidth = Math.max(
    96,
    Math.ceil(
      months.reduce((longest, month) => Math.max(longest, monthName(month.month).length), 0) * 7.7
        + spacing.md * 2,
    ),
  );
  const HEAD_W = orientation === "monthsAsRows"
    ? (compact ? compactMonthHeadWidth : 96)
    : (compact ? 112 : 168);
  const HEAD_HORIZONTAL_PADDING = orientation === "monthsAsRows" && compact ? spacing.md : spacing.sm;
  const visibleColumnCount = orientation === "monthsAsRows" ? columns.length : months.length;
  // `Screen`'s max width includes its horizontal padding. Size against the
  // actual inner surface so the last fitted column ends on the card edge
  // instead of leaving a gap or creating a hidden 32px overflow.
  const availableTableWidth = Math.min(viewportWidth, 1200) - spacing.lg * 2;
  const longestValueChars = columns.reduce(
    (longest, column) => Math.max(
      longest,
      ...months.map((month) => {
        const value = column.values.get(month.month) ?? 0;
        return value === 0 ? 0 : formatMinorCompact(value).length;
      }),
    ),
    0,
  );
  // Compact cells render tabular figures at 11px. Their widest measured glyph
  // is ~6.2px; the 4px edge insets below make a ten-character TRY amount fit a
  // 70px cell without wrapping. Wider real values still grow the cell rather
  // than squeezing or clipping the amount.
  const valueSafeCellWidth = compact
    ? Math.ceil(longestValueChars * 6.2 + spacing.xs * 2)
    : Math.ceil(longestValueChars * 7.2 + spacing.sm * 2);
  const longestHeaderChars = orientation === "monthsAsRows"
    ? columns.reduce((longest, column) => Math.max(longest, Math.min(column.label.length, 24)), 0)
    : months.reduce((longest, month) => Math.max(longest, (compact ? shortMonthLabel(month.month) : monthName(month.month)).length), 0);
  // Header markers reserve 48px at both sides together. Give ordinary names
  // enough room for one or two balanced lines. Longer user-authored names keep
  // wrapping and grow the shared header height.
  const headerSafeCellWidth = Math.min(168, Math.max(112, Math.ceil(longestHeaderChars * 5.8 + 48)));
  // Fit an integer number of complete columns in the desktop viewport. A
  // clipped half-header at the right edge technically signalled scrolling but
  // looked broken; the next column now starts beyond the edge as one unit.
  const bodyTableWidth = Math.max(1, availableTableWidth - HEAD_W);
  const naturalCellWidth = Math.max(112, valueSafeCellWidth, headerSafeCellWidth);
  const wholeColumnCount = visibleColumnCount > 0
    ? Math.min(visibleColumnCount, Math.max(1, Math.floor(bodyTableWidth / naturalCellWidth)))
    : 1;
  const wholeColumnCellWidth = Math.floor(bodyTableWidth / wholeColumnCount);
  // Phones/tablets favor complete columns too, but let ordinary headers wrap.
  // The orientation-specific pinned column determines how many complete data
  // cells fit. The measured value floor remains authoritative, so an unusually
  // long amount widens the cells instead of wrapping a financial figure.
  const compactNaturalCellWidth = Math.max(70, valueSafeCellWidth);
  const compactWholeColumnCount = visibleColumnCount > 0
    ? Math.min(visibleColumnCount, Math.max(1, Math.floor(bodyTableWidth / compactNaturalCellWidth)))
    : 1;
  const compactWholeColumnCellWidth = Math.floor(bodyTableWidth / compactWholeColumnCount);
  const CELL_W = compact
    ? Math.max(compactNaturalCellWidth, Math.min(144, compactWholeColumnCellWidth))
    : Math.max(naturalCellWidth, Math.min(320, wholeColumnCellWidth));
  const fontSize = compact ? 11 : 13;
  // The optional details panel now lives above this flex area, so the table
  // receives all remaining height while the panel is hidden or open.
  // Size the table to its natural content (StickyTable's fixed header/row
  // heights) but never taller than the space measured above the tab bar. When
  // there are few items (e.g. a short column-focused view) the table shrinks
  // instead of stretching to a fixed height with dead space; with many rows it
  // caps at the available height and scrolls inside.
  const rowCount = orientation === "monthsAsRows" ? months.length : columns.length;
  // StickyTable measures the actual header copy and adds only its shared small
  // inset. This is the minimum used for initial content sizing; category
  // headers grow from their text while short month headers stay at this floor.
  const naturalTableH = STICKY_HEADER_HEIGHT + rowCount * STICKY_ROW_HEIGHT + spacing.sm;
  const availTableH = Math.max(160, measuredHeight);
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
  const pressFor = (c: CashFlowMatrixColumn, month: MonthKey): (() => void) | undefined => {
    if (c.categoryId) return () => router.push({ pathname: "/cell-editor", params: { month, categoryId: c.categoryId! } });
    // A reconciled closing figure is the one system cell with somewhere to go:
    // the adjustment that moved it. Root-level route, so what sits underneath
    // is this screen and both the back button and the edge swipe return here.
    if (c.key === "closing" && adjustmentByMonth.has(month)) return () => router.push("/opening-balance" as Href);
    if (c.system) return undefined;
    return () => openBreakdown(c.key); // computed column cell → its breakdown
  };

  const cell = (
    value: number | null,
    note: string | undefined,
    onPress: (() => void) | undefined,
    highlighted: boolean,
    month: MonthKey,
    columnLabel: string,
    markerTone: "note" | "adjustment" = "note",
  ) => (
    <MatrixCell
      value={value}
      note={note}
      markerTone={markerTone}
      onPress={onPress}
      highlighted={highlighted}
      fontSize={fontSize}
      accessibilityLabel={tr.a11y.matrixCell(
        monthLabel(month),
        columnLabel,
        value == null ? tr.a11y.emptyValue : formatMinor(value),
        Boolean(note),
      )}
    />
  );
  const breakdownFor = (key: string): (() => void) | undefined =>
    key === "opening" || key === "closing" ? undefined : () => openBreakdown(key);

  let cornerLabel: string;
  let stickyColumns: StickyColumn[];
  let stickyRows: StickyRow[];
  let currentColumnKey: string | undefined;

  if (orientation === "monthsAsRows") {
    cornerLabel = tr.cashflow.monthHeader;
    stickyColumns = columns.map((c) => ({
      key: c.key,
      label: c.label,
      truncateLabel: true,
      icon: c.computed ? Sigma : undefined,
    }));
    stickyRows = months.map((slot) => ({
      key: slot.month,
      label: monthName(slot.month),
      accessibilityLabel: monthLabel(slot.month),
      onLabelPress: () => router.push(`/cash-flow/${slot.month}`),
      labelHighlight: slot.month === currentMonth,
      rowHighlight: slot.month === currentMonth,
      cells: columns.map((c) =>
        cell(
          c.values.get(slot.month) ?? null,
          noteFor(c, slot.month),
          pressFor(c, slot.month),
          false,
          slot.month,
          c.label,
          c.key === "closing" ? "adjustment" : "note",
        ),
      ),
    }));
  } else {
    cornerLabel = tr.cashflow.itemHeader;
    stickyColumns = months.map((slot) => ({
      key: slot.month,
      label: compact ? shortMonthLabel(slot.month) : monthName(slot.month),
      accessibilityLabel: monthName(slot.month),
    }));
    currentColumnKey = currentMonth;
    stickyRows = columns.map((c) => ({
      key: c.key,
      label: c.label,
      truncateLabel: true,
      icon: c.computed ? Sigma : undefined,
      onLabelPress: breakdownFor(c.key),
      cells: months.map((slot) =>
        cell(
          c.values.get(slot.month) ?? null,
          noteFor(c, slot.month),
          pressFor(c, slot.month),
          slot.month === currentMonth,
          slot.month,
          c.label,
          c.key === "closing" ? "adjustment" : "note",
        ),
      ),
    }));
  }

  const isColumns = orientation === "monthsAsColumns";
  const validPin = pinnedKey && stickyColumns.some((c) => c.key === pinnedKey) ? pinnedKey : null;
  // Center the current month on open (only when it's in the shown year).
  const focusMonth = yearOf(currentMonth) === year ? currentMonth : undefined;

  return (
    <Card testID="cash-flow-matrix-table" padded={false} style={{ alignSelf: "stretch" }}>
      <StickyTable
        scrollRef={scrollRef}
        cornerLabel={cornerLabel}
        columns={stickyColumns}
        rows={stickyRows}
        headWidth={HEAD_W}
        headHorizontalPadding={HEAD_HORIZONTAL_PADDING}
        cellWidth={CELL_W}
        currentColumnKey={currentColumnKey}
        focusColumnKey={isColumns ? focusMonth : undefined}
        focusRowKey={isColumns ? undefined : focusMonth}
        pinnedKey={validPin}
        onTogglePin={onTogglePin}
        onColumnPress={isColumns ? (key) => router.push(`/cash-flow/${key}`) : openBreakdown}
        height={tableHeight}
      />
    </Card>
  );
}

function MatrixCell({
  value,
  note,
  markerTone = "note",
  highlighted,
  onPress,
  fontSize,
  accessibilityLabel,
}: {
  value: number | null;
  note?: string;
  /** What the corner dot means, so the two never look alike. */
  markerTone?: "note" | "adjustment";
  highlighted?: boolean;
  onPress?: () => void;
  fontSize: number;
  accessibilityLabel: string;
}) {
  const { palette } = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      // A cell that cannot be opened (a system column, or one with nothing to
      // edit) still has to announce its month/column/value. A labelled group
      // keeps that context without implying an action.
      role={onPress ? "button" : "group"}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={note}
      style={[
        { flex: 1, justifyContent: "center", paddingHorizontal: fontSize <= 11 ? 2 : spacing.sm },
        highlighted && { backgroundColor: palette.primarySoft + "55" },
        hovered && onPress && { backgroundColor: palette.primarySoft },
      ]}
    >
      <Text
        testID="matrix-value"
        style={[
          type.amountSm,
          { fontSize, color: value == null || value === 0 ? palette.textSecondary : value < 0 ? palette.negativeText : palette.text, textAlign: "right" },
        ]}
      >
        {value == null || value === 0 ? "" : formatMinorCompact(value)}
      </Text>
      {note ? (
        <View
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 6,
            height: 6,
            borderRadius: 3,
            // A reconciled month is not a note, and wearing the note's amber
            // dot said it was — same mark, nothing behind it when tapped.
            backgroundColor: markerTone === "adjustment" ? palette.primary : palette.warning,
          }}
        />
      ) : null}
    </Pressable>
  );
}
