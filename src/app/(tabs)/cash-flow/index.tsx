/** Mali Tablo: the ledger matrix, pivotable, with a phone month-focused mode. */

import React, { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { useRouter, useScrollToTop } from "expo-router";
import ArrowDownRight from "lucide-react-native/icons/arrow-down-right";
import ArrowLeftRight from "lucide-react-native/icons/arrow-left-right";
import ArrowUpRight from "lucide-react-native/icons/arrow-up-right";
import CalendarPlus from "lucide-react-native/icons/calendar-plus";
import ChartNoAxesColumn from "lucide-react-native/icons/chart-no-axes-column";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CreditCard from "lucide-react-native/icons/credit-card";
import Flag from "lucide-react-native/icons/flag";
import Info from "lucide-react-native/icons/info";
import Pencil from "lucide-react-native/icons/pencil";
import Plus from "lucide-react-native/icons/plus";
import Sigma from "lucide-react-native/icons/sigma";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { monthFlowTotals, type LedgerBundle } from "../../../domain/balance";
import { buildCashFlowMatrixModel, type CashFlowMatrixColumn } from "../../../domain/cash-flow-matrix";
import { orderLedgerCategories, resolveYearColumns } from "../../../domain/year-columns";
import { monthKeyOf, monthOf, makeMonthKey, todayISO, yearOf, type MonthKey } from "../../../domain/dates";
import { resolveMatrixMode, type MatrixMode } from "../../../domain/matrix-preferences";
import { formatMinorCompact } from "../../../domain/money";
import { dateLabel, monthLabel, monthName, shortMonthLabel, tr } from "../../../i18n/tr";
import { balanceDeclarationDrift, parseBalanceDeclaration } from "../../../domain/balance-declaration";
import {
  settingValue,
  useSettingValue,
  useAllTransactionsState,
  useBalanceColumns,
  useCellNotesState,
  useCategoriesState,
  useComputedColumnsState,
  useLedgerState,
  useMatrixColorsState,
  usePersonsState,
  useSettingsMapState,
  useSourcesState,
  useTxLike,
  useUserId,
} from "../../../data/hooks";
import { combineLiveStates } from "../../../data/live-state";
import { setMatrixColor, setMatrixColorLabels } from "../../../data/repo";
import { appAlert } from "../../../ui/dialog";
import { scheduleSync } from "../../../sync/engine";
import { devError } from "../../../services/logger";
import { kv } from "../../../services/kv";
import { Amount, Button, Card, DataStateNotice, FadeIn, IconButton, Row, Screen, Segmented, Spread } from "../../../ui/components";
import { CURRENT_TINT, StickyTable, STICKY_HEADER_HEIGHT, STICKY_ROW_HEIGHT } from "../../../ui/sticky-table";
import { MatrixColorSheet } from "../../../ui/matrix-color-sheet";
import { buildColorIndex, matrixColorLabel, MATRIX_COLOR_TOKENS, parseMatrixColorLabels, resolveCellToken, type MatrixColorLabels, type MatrixColorScope, type MatrixColorToken } from "../../../domain/matrix-colors";
import { interactionSurface } from "../../../ui/interaction";
import { circle, controlSize, iconSize, matrixColorStyle, radius, spacing, type, useTheme } from "../../../ui/theme";
import { ledgerCellWidth, shouldStartTableDetailsOpen, shouldUseWideWorkspace } from "../../../ui/responsive";
import { useContentWidth } from "../../../ui/viewport";
import { CategoryIcon } from "../../../ui/category-icon";

type MatrixModel = ReturnType<typeof buildCashFlowMatrixModel>;

function openUncategorized(router: ReturnType<typeof useRouter>, year: number) {
  router.push({
    pathname: "/cash-flow/item",
    params: { col: "__uncategorized", label: tr.cashflow.uncategorizedLegacy, year: String(year), kind: "uncategorized" },
  });
}

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
      // The press surface is the control's own box, so the lit area is what was pressed.
      style={(state) => ({
        flex: 1,
        flexBasis: 0,
        minWidth: 0,
        minHeight: controlSize.minimumTarget,
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        paddingVertical: spacing.xs,
        borderRadius: radius.sm,
        ...interactionSurface(palette, state),
      })}
    >
      <IconCmp accessible={false} size={15} color={palette.textSecondary} strokeWidth={2} />
      <Text style={[type.caption, { color: palette.textSecondary, textAlign: "center" }]}>{caption}</Text>
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
        <Text style={[type.small, { color: foreground, textAlign: "center", fontSize: type.caption.fontSize }]}>{label}</Text>
      </View>
      <Amount
        minor={amountMinor}
        colorized={false}
        color={foreground}
        style={[type.amountSm, { textAlign: "center", fontSize: type.small.fontSize, marginTop: 2 }]}
      />
    </View>
  );
}

/** Device-local preferences for the matrix's independent orientations. */
const GUIDE_KEY = "helix.matrix.guide";
const LEGACY_PIN_KEY = "helix.matrix.pinned";
const ROW_PIN_KEY = "helix.matrix.pinned.rows";
const COLUMN_PIN_KEY = "helix.matrix.pinned.columns";
const PIN_KEYS = { rows: ROW_PIN_KEY, columns: COLUMN_PIN_KEY } as const;
type PinMode = keyof typeof PIN_KEYS;

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
  const matrixColorsState = useMatrixColorsState();
  const bundle = ledgerState.data;
  const categories = categoriesState.data;
  const computed = computedState.data;
  const settings = settingsState.data;
  const hiddenComputed = useSettingValue<string[]>(settings, "computed_columns_hidden", []);
  // "You told me X; this table says Y." The declaration is the last balance the
  // user checked against a real account.
  const balanceDeclaration = parseBalanceDeclaration(settingValue<unknown>(settings, "balance_declared", null));
  const storedColorLabels = useSettingValue<unknown>(settings, "matrix_color_labels", null);
  const colorLabels = useMemo(() => parseMatrixColorLabels(storedColorLabels), [storedColorLabels]);
  const balanceDrift = balanceDeclarationDrift(balanceDeclaration, bundle?.actualBalanceMinor ?? null);
  const visibleComputed = useMemo(() => computed.filter((c) => !hiddenComputed.includes(c.id)), [computed, hiddenComputed]);
  const sources = sourcesState.data;
  const allTx = allTxState.data;
  const { status: dataStatus, retry: retryData } = combineLiveStates([ledgerState, categoriesState, computedState, settingsState, sourcesState, personsState, allTxState, cellNotesState, matrixColorsState]);
  const contentWidth = useContentWidth();
  const wide = shouldUseWideWorkspace(contentWidth);
  const router = useRouter();
  const { palette } = useTheme();
  // A phone opens on one month, which fits its width without a sideways
  // scroll; a wide workspace has room for the year-wide row mode. Once the
  // owner chooses, that persisted preference wins over device width.
  const defaultMode: MatrixMode = wide ? "rows" : "cards";
  const [mode, setMode] = useState<MatrixMode>(defaultMode);
  const [hasSavedMode, setHasSavedMode] = useState<boolean | null>(null);
  const [focusMonthNumber, setFocusMonthNumber] = useState(monthOf(todayISO()));
  const [pinnedByMode, setPinnedByMode] = useState<Record<PinMode, string | null>>({ rows: null, columns: null });
  const [tableAreaH, setTableAreaH] = useState(0);
  const [tableAreaW, setTableAreaW] = useState(0);
  // Rounded, so a sub-pixel layout report cannot rebuild the grid.
  const onTableAreaLayout = React.useCallback((event: LayoutChangeEvent) => {
    const height = Math.round(event.nativeEvent.layout.height);
    const width = Math.round(event.nativeEvent.layout.width);
    setTableAreaH((current) => (current === height ? current : height));
    setTableAreaW((current) => (current === width ? current : width));
  }, []);
  // Starts open on desktop; a close is remembered per device so the guide is not re-taught.
  const [showTableDetails, setShowTableDetails] = useState(() => shouldStartTableDetailsOpen(contentWidth));
  // The tab's repeat-press behavior needs the active month-focused scroller.
  const monthFocusScrollRef = React.useRef<ScrollView>(null);
  const tableRef = useRef<ScrollView>(null);
  React.useEffect(() => {
    void kv.get("helix.matrix.mode").then((v) => {
      setHasSavedMode(Boolean(v));
      setMode(v ? resolveMatrixMode(v) : defaultMode);
    });
    void Promise.all([kv.get(PIN_KEYS.rows), kv.get(PIN_KEYS.columns), kv.get(LEGACY_PIN_KEY)]).then(async ([rowsPin, columnsPin, legacyPin]) => {
      // The legacy key held one pin for whichever orientation was open. Seed both slots only when
      // neither new slot exists, or a deliberately cleared pin would come back.
      const hasNewPreferences = rowsPin !== null || columnsPin !== null;
      const migratedPin = !hasNewPreferences ? legacyPin || null : null;
      setPinnedByMode({
        rows: hasNewPreferences ? rowsPin || null : migratedPin,
        columns: hasNewPreferences ? columnsPin || null : migratedPin,
      });
      if (migratedPin) {
        await Promise.all([
          kv.set(ROW_PIN_KEY, migratedPin),
          kv.set(COLUMN_PIN_KEY, migratedPin),
          kv.remove(LEGACY_PIN_KEY),
        ]);
      }
    });
    void kv.get(GUIDE_KEY).then((v) => {
      if (v) setShowTableDetails(v === "true");
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
  // Stable callback: MatrixTable is memoized and an inline arrow would defeat it.
  const togglePin = React.useCallback((key: string) => {
    if (mode === "cards") return;
    const pinMode: PinMode = mode === "columns" ? "columns" : "rows";
    const next = pinnedByMode[pinMode] === key ? null : key;
    setPinnedByMode((current) => ({ ...current, [pinMode]: next }));
    if (pinMode === "rows") void kv.set(ROW_PIN_KEY, next ?? "");
    else void kv.set(COLUMN_PIN_KEY, next ?? "");
  }, [mode, pinnedByMode]);
  const focusMonth = makeMonthKey(year, focusMonthNumber);

  // Derived from the data, not the render: this maps the whole ledger.
  const creditCardIds = useMemo(
    () => new Set(sources.filter((src) => src.type === "credit_card").map((src) => src.id)),
    [sources],
  );
  const txLike = useTxLike();

  // The floor is the first month holding data, not the anchor: an import's anchor would otherwise offer empty years.
  const firstMonth = bundle
    ? (bundle.firstRecordedMonth != null && bundle.firstRecordedMonth > bundle.startMonth
        ? bundle.firstRecordedMonth
        : bundle.startMonth)
    : null;
  const minYear = firstMonth ? yearOf(firstMonth) : currentYear;
  const lastTransaction = allTx.at(-1);
  const lastDataYear = lastTransaction ? yearOf(lastTransaction.effectiveDate) : currentYear;
  const maxYear = Math.max(currentYear, lastDataYear);

  // Per-year columns (see domain/year-columns.ts for the resolution rules).
  const columnYears = useSettingValue<Record<string, string[]>>(settings, "column_years", {});
  const dataCats = useMemo(() => {
    const used = new Set<string>();
    bundle?.yearMonths.forEach((m) => m.byCategory.forEach((v, cid) => { if (v !== 0) used.add(cid); }));
    return used;
  }, [bundle]);
  const orderedCategories = useMemo(() => orderLedgerCategories(categories), [categories]);
  const columnCategories = useMemo(
    () => resolveYearColumns(orderedCategories, columnYears, year, maxYear, dataCats),
    [orderedCategories, columnYears, year, maxYear, dataCats],
  );
  // Every live category id — used to expose a repair link for legacy rows whose
  // category is missing, without inventing a special non-editable table column.
  const liveCategoryIds = useMemo(() => new Set(categories.map((c) => c.id)), [categories]);
  const today = todayISO();
  const balanceColumns = useBalanceColumns();
  const tableMatrix = useMemo(
    () => bundle
      ? buildCashFlowMatrixModel({
          year,
          yearMonths: bundle.yearMonths,
          categories: columnCategories,
          computedColumns: visibleComputed,
          transactions: txLike,
          creditCardIds,
          liveCategoryIds,
          today,
          openingLabel: balanceColumns.openingLabel,
          closingLabel: balanceColumns.closingLabel,
          showOpening: balanceColumns.showOpening,
          startMonth: firstMonth ?? bundle.startMonth,
        })
      : null,
    [bundle, firstMonth, year, columnCategories, visibleComputed, txLike, creditCardIds, liveCategoryIds, today, balanceColumns],
  );

  const yearSwitcher = (
    <Row testID="cash-flow-year-control" gap={spacing.sm}>
      <IconButton icon={ChevronLeft} label={String(year - 1)} onPress={() => setYear(year - 1)} disabled={year <= minYear} />
      <Text style={[type.label, { color: palette.text, minWidth: 44, textAlign: "center" }]}>{year}</Text>
      <IconButton icon={ChevronRight} label={String(year + 1)} onPress={() => setYear(year + 1)} disabled={year >= maxYear} />
    </Row>
  );

  const orientation = mode === "columns" ? "monthsAsColumns" : "monthsAsRows";
  const showTable = mode !== "cards";
  // This tab hosts its own scroller and swaps between two, so tab-press-to-top follows the mounted one.
  useScrollToTop(showTable ? tableRef : monthFocusScrollRef);
  // In column-focused view the categories are rows, so the editor label flips.
  const editLabel = orientation === "monthsAsColumns" ? tr.cashflow.editRows : tr.cashflow.editColumns;
  // Open the column/row editor as a modal so closing returns to Mali Tablo
  // (not into the Settings tab).
  const editColumns = () => router.push("/columns-editor");

  return (
    // `wide`: the one dense grid, which the workspace cap would force into sideways scrolling.
    <Screen title={tr.cashflow.title} right={yearSwitcher} width="wide" scroll={false} padded>
      <View
        style={{
          gap: spacing.sm,
          marginBottom: spacing.sm,
        }}
      >
        {/* One toolbar at every width, so the screen is not relearned when the window changes. */}
        <View
          testID="cash-flow-action-toolbar"
          style={{
            gap: spacing.xs,
            width: "100%",
            padding: spacing.xs,
            borderRadius: radius.md,
            backgroundColor: palette.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border + "70",
          }}
        >
          <Button icon={Plus} size="sm" label={tr.cashflow.addTransaction} onPress={() => router.push("/transaction")} />
          <Row gap={2} style={{ justifyContent: "center", alignItems: "stretch", flexWrap: "nowrap", width: "100%" }}>
            <MatrixTool icon={Pencil} caption={tr.cashflow.toolEdit} label={editLabel} onPress={editColumns} />
            <MatrixTool icon={CreditCard} caption={tr.cashflow.toolInstallments} label={tr.cashflow.installments} onPress={() => router.push("/cash-flow/installments")} />
            <MatrixTool icon={ChartNoAxesColumn} caption={tr.cashflow.toolAnalysis} label={tr.cashflow.analysis} onPress={() => router.push("/cash-flow/analytics")} />
            <MatrixTool icon={CalendarPlus} caption={tr.cashflow.toolBulk} label={tr.cashflow.bulkEntry} onPress={() => router.push("/bulk-entry")} />
            <MatrixTool icon={Flag} caption={tr.cashflow.toolOpening} label={tr.cashflow.openingLink} onPress={() => router.push("/opening-balance")} />
          </Row>
        </View>
      </View>

      <DataStateNotice status={dataStatus} retry={retryData} />
      {balanceDrift != null && balanceDeclaration ? (
        // The ledger is where the mismatch is visible, so it is where the way
        // out belongs: the figure the user confirmed against a real account
        // against the one this table now computes.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr.settings.balanceDriftTitle}
          onPress={() => router.push("/opening-balance")}
          style={(state) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            marginBottom: spacing.sm,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            borderRadius: radius.md,
            ...interactionSurface(palette, state, { base: palette.warning + "16" }),
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.warning + "70",
          })}
        >
          <TriangleAlert accessible={false} size={15} color={palette.warningText} strokeWidth={2.3} />
          <Text style={[type.small, { color: palette.warningText, flex: 1, minWidth: 0 }]}>
            {tr.settings.balanceDriftBody(
              formatMinorCompact(balanceDeclaration.minor),
              formatMinorCompact(bundle?.actualBalanceMinor ?? 0),
              dateLabel(balanceDeclaration.at),
            )}
          </Text>
          <ChevronRight accessible={false} size={16} color={palette.warningText} />
        </Pressable>
      ) : null}

      {/* No empty state: an unanchored ledger draws at zero, and DataStateNotice owns loading and failure. */}
      {bundle == null ? null : (
        <View style={{ flex: 1 }}>
          {/* The pivot spans and centres so it sits in one place at every width; the guide toggle shares its strip. */}
          <View style={{ marginBottom: spacing.md, width: "100%" }}>
            <Segmented
              fill
              noMargin
              options={PIVOT_MODES}
              value={mode}
              onChange={changeMode}
              action={showTable
                ? {
                    icon: Info,
                    label: tr.cashflow.tableGuide,
                    active: showTableDetails,
                    onPress: () => setShowTableDetails((visible) => {
                      void kv.set(GUIDE_KEY, String(!visible));
                      return !visible;
                    }),
                  }
                : undefined}
            />
          </View>
          {/* Fade only, height in one step: animating height re-lays out the grid every frame. */}
          {showTable && tableMatrix && showTableDetails ? (
            <FadeIn>
              <TableDetailsPanel
                hasUncategorized={tableMatrix.hasUncategorized}
                uncategorizedTotal={tableMatrix.uncategorizedTotal}
                colorLabels={colorLabels}
                onOpenUncategorized={() => openUncategorized(router, year)}
              />
            </FadeIn>
          ) : null}
          {showTable ? (
            <View style={{ flex: 1 }} onLayout={onTableAreaLayout}>
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
                  measuredWidth={tableAreaW}
                  colors={matrixColorsState.data}
                  colorLabels={colorLabels}
                  pinnedKey={pinnedByMode[mode === "columns" ? "columns" : "rows"]}
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
                matrix={tableMatrix!}
                columnCategories={columnCategories}
                cellNotes={cellNotesState.data}
              />
            </ScrollView>
          )}
        </View>
      )}
    </Screen>
  );
}

/** Card view of the same memoized matrix model the table renders. */
function MonthFocusTable({
  year,
  month,
  onMonthChange,
  bundle,
  matrix,
  columnCategories,
  cellNotes,
}: {
  year: number;
  month: MonthKey;
  onMonthChange: (monthNumber: number) => void;
  bundle: LedgerBundle;
  matrix: MatrixModel;
  columnCategories: ReturnType<typeof useCategoriesState>["data"];
  cellNotes: ReturnType<typeof useCellNotesState>["data"];
}) {
  const { palette } = useTheme();
  const router = useRouter();
  const today = todayISO();
  const balanceColumns = useBalanceColumns();
  const monthNumber = monthOf(month);
  const monthData = bundle.yearMonths.find((item) => item.month === month);
  const flows = monthData ? monthFlowTotals(monthData) : null;
  const noteByCategory = new Map(
    cellNotes.filter((note) => note.month === month).map((note) => [note.categoryId, note.body]),
  );
  const adjustmentNote = monthData?.adjustmentMinor
    ? tr.cashflow.adjustedCell(formatMinorCompact(monthData.adjustmentMinor))
    : undefined;

  const actionFor = (column: CashFlowMatrixColumn): (() => void) | undefined => {
    if (column.categoryId) {
      return () => router.push({ pathname: "/cell-editor", params: { month, categoryId: column.categoryId! } });
    }
    if (column.key === "closing" && adjustmentNote) return () => router.push("/opening-balance");
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
          label={monthLabel(makeMonthKey(year, Math.max(1, monthNumber - 1)))}
          disabled={monthNumber <= 1}
          onPress={() => onMonthChange(monthNumber - 1)}
        />
        <Text accessibilityRole="header" style={[type.heading, { color: month === monthKeyOf(today) ? palette.primaryText : palette.text }]}>
          {monthLabel(month)}
        </Text>
        <IconButton
          icon={ChevronRight}
          label={monthLabel(makeMonthKey(year, Math.min(12, monthNumber + 1)))}
          disabled={monthNumber >= 12}
          onPress={() => onMonthChange(monthNumber + 1)}
        />
      </View>

      {flows ? (
        <Card testID="month-focus-card" style={{ padding: spacing.md }}>
          <Spread style={{ alignItems: "center" }}>
            <View>
              <Text style={[type.small, { color: palette.textSecondary }]}>{balanceColumns.closingLabel}</Text>
              <Amount minor={flows.closingMinor} large />
            </View>
            <IconButton icon={ChevronRight} label={tr.cashflow.openMonth} onPress={() => router.push(`/cash-flow/${month}`)} />
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
          return (
            <Pressable
              key={column.key}
              disabled={!onPress}
              onPress={onPress}
              role={onPress ? "button" : "group"}
              accessibilityLabel={tr.a11y.matrixCell(monthLabel(month), column.label, formatMinorCompact(value), Boolean(note))}
              accessibilityHint={note}
              style={(state) => ({
                minHeight: 48,
                flexDirection: "row",
                alignItems: "center",
                paddingLeft: spacing.sm,
                paddingRight: spacing.md,
                borderBottomWidth: index < matrix.columns.length - 1 ? StyleSheet.hairlineWidth : 0,
                borderColor: palette.border,
                ...interactionSurface(palette, state),
              })}
            >
              <View
                style={{
                  width: 30,
                  height: 30,
                  flexShrink: 0,
                  borderRadius: radius.md,
                  backgroundColor: column.computed ? palette.tertiarySoft : palette.surfaceAlt,
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: spacing.sm,
                }}
              >
                {/* One drawing language for every column mark. */}
                {column.computed ? (
                  <Sigma accessible={false} size={iconSize.compact} color={palette.tertiaryText} />
                ) : category ? (
                  <CategoryIcon category={category} size={iconSize.compact} color={palette.accentText} />
                ) : (
                  <Flag accessible={false} size={iconSize.compact} color={palette.textSecondary} />
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
              <Amount
                testID="matrix-value"
                minor={value}
                colorized={false}
                color={value < 0 ? palette.negativeText : value === 0 ? palette.textSecondary : palette.text}
                style={[type.amountSm, { width: 108, textAlign: "right", fontSize: type.small.fontSize }]}
              />
            </Pressable>
          );
        })}
        {matrix.hasUncategorized ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => openUncategorized(router, year)}
            style={(state) => ({ padding: spacing.md, backgroundColor: palette.warning + "12", ...interactionSurface(palette, state) })}
          >
            <Spread>
              <Text style={[type.label, { color: palette.warningText, flex: 1 }]}>{tr.cashflow.uncategorizedLegacy}</Text>
              <Amount
                minor={matrix.uncategorizedTotal}
                colorized={false}
                color={palette.warningText}
                style={{ textAlign: "right" }}
              />
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
  colorLabels,
  onOpenUncategorized,
}: {
  colorLabels: MatrixColorLabels | null;
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
      {/* The marks use the owner's own colour names, so the guide lists them rather than a fixed sentence. */}
      <View>
        <Text style={[type.small, { color: palette.textSecondary }]}>{tr.cashflow.tableColorHint}</Text>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={`${tr.matrixColor.legend}: ${MATRIX_COLOR_TOKENS
            .map((token) => matrixColorLabel(token, colorLabels, tr.matrixColor.token))
            .join(", ")}`}
          style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm }}
        >
          {MATRIX_COLOR_TOKENS.map((token) => {
            const mark = matrixColorStyle(palette, token);
            return (
              <View
                key={token}
                accessible={false}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.xs,
                  paddingVertical: 3,
                  paddingHorizontal: spacing.sm,
                  borderRadius: radius.full,
                  backgroundColor: mark.fill,
                  borderLeftWidth: 3,
                  borderLeftColor: mark.edge,
                }}
              >
                <Text style={[type.small, { color: palette.text, fontSize: type.caption.fontSize }]}>
                  {matrixColorLabel(token, colorLabels, tr.matrixColor.token)}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
      {hasUncategorized ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr.cashflow.uncategorizedLegacy}
          onPress={onOpenUncategorized}
          style={(state) => ({
            padding: spacing.sm,
            borderRadius: radius.sm,
            ...interactionSurface(palette, state, { base: palette.surface }),
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
          <Amount
            minor={uncategorizedTotal}
            colorized={false}
            color={uncategorizedTotal < 0 ? palette.negativeText : palette.text}
            style={{ textAlign: "right" }}
          />
          <ChevronRight accessible={false} size={16} color={palette.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

// Memoized: ~300 cells, and most parent renders change none of them.
const MatrixTable = React.memo(function MatrixTable({
  year,
  bundle,
  matrix,
  cellNotes,
  orientation,
  compact,
  measuredHeight,
  measuredWidth,
  pinnedKey,
  onTogglePin,
  colors,
  colorLabels,
  scrollRef,
}: {
  year: number;
  bundle: LedgerBundle;
  matrix: MatrixModel;
  cellNotes: ReturnType<typeof useCellNotesState>["data"];
  orientation: "monthsAsRows" | "monthsAsColumns";
  compact: boolean;
  measuredHeight: number;
  measuredWidth: number;
  pinnedKey: string | null;
  onTogglePin: (key: string) => void;
  colors: ReturnType<typeof useMatrixColorsState>["data"];
  /** What the owner calls each mark hue. Account-wide, never per cell. */
  colorLabels: MatrixColorLabels | null;
  scrollRef: React.RefObject<ScrollView | null>;
}) {
  const router = useRouter();
  const { palette } = useTheme();
  const userId = useUserId();
  const today = todayISO();
  const colorIndex = React.useMemo(
    () => buildColorIndex(colors.map((row) => ({
      id: row.id,
      scope: row.scope as MatrixColorScope,
      itemKey: row.itemKey,
      month: row.month,
      token: row.token,
    }))),
    [colors],
  );
  /** The owner's name for a hue, or null when nothing is marked. */
  const nameForToken = React.useCallback(
    (token: MatrixColorToken | null) => (token ? matrixColorLabel(token, colorLabels, tr.matrixColor.token) : null),
    [colorLabels],
  );
  /** Which target the colour sheet is open for, if any. */
  const [colorTarget, setColorTarget] = React.useState<
    { scope: MatrixColorScope; itemKey: string | null; month: string | null; label: string } | null
  >(null);
  const currentMonth = monthKeyOf(today);

  // Keyed on the live-query references, so an unrelated render is a no-op.
  const noteByCell = useMemo(
    () => new Map(cellNotes.map((note) => [`${note.month}:${note.categoryId}`, note.body])),
    [cellNotes],
  );
  // A reconciled month carries a marker, or its closing figure silently stops matching the flows above.
  const adjustmentByMonth = useMemo(
    () => new Map(
      bundle.yearMonths
        .filter((month) => month.adjustmentMinor !== 0)
        .map((month) => [month.month, tr.cashflow.adjustedCell(formatMinorCompact(month.adjustmentMinor))]),
    ),
    [bundle.yearMonths],
  );
  const { months, columns } = matrix;

  // Row-focused: the fixed column holds month names, so it stays narrow. Column-focused: it holds
  // user-authored names, so it gets prose width.
  // The month rail fits the longest month name; the platform floor keeps "Temmuz" from wrapping on iOS.
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
  // A user-authored column name may be a paragraph; the header only gets to
  // ask for as much width as a reasonable one needs.
  const longestHeaderChars = orientation === "monthsAsRows"
    ? columns.reduce((longest, column) => Math.max(longest, Math.min(column.label.length, 24)), 0)
    : months.reduce((longest, month) => Math.max(longest, (compact ? shortMonthLabel(month.month) : monthName(month.month)).length), 0);
  const bodyTableWidth = Math.max(1, measuredWidth - HEAD_W);
  const CELL_W = ledgerCellWidth({
    gridWidth: bodyTableWidth,
    valueChars: longestValueChars,
    headerChars: longestHeaderChars,
    columnCount: visibleColumnCount,
    compact,
  });
  const fontSize = compact ? type.caption.fontSize : type.label.fontSize;
  // Natural content height capped at the measured space: few rows shrink, many rows scroll inside.
  const rowCount = orientation === "monthsAsRows" ? months.length : columns.length;
  // Initial sizing floor; StickyTable grows headers from their text.
  const naturalTableH = STICKY_HEADER_HEIGHT + rowCount * STICKY_ROW_HEIGHT + spacing.sm;
  const availTableH = Math.max(160, measuredHeight);
  const tableHeight = Math.min(naturalTableH, availTableH);

  // Tapping a category/computed column opens its month-by-month breakdown.
  // Opening/closing balances are derived summaries — intentionally not tappable.
  const openBreakdown = React.useCallback((key: string) => {
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
  }, [columns, year, router]);

  // One stable dispatcher for every cell; a per-cell closure would defeat MatrixCell's memo.
  const onCellPress = React.useCallback((columnKey: string, month: MonthKey) => {
    const c = columns.find((col) => col.key === columnKey);
    if (!c) return;
    if (c.categoryId) {
      router.push({ pathname: "/cell-editor", params: { month, categoryId: c.categoryId } });
      return;
    }
    // A reconciled closing figure opens the adjustment that moved it. Root route, so back and the edge swipe return here.
    if (c.key === "closing" && adjustmentByMonth.has(month)) {
      router.push("/opening-balance");
      return;
    }
    if (c.system) return;
    openBreakdown(c.key); // computed column cell → its breakdown
  }, [columns, adjustmentByMonth, router, openBreakdown]);

  /** Hold anything on the grid to mark it. The gesture carries the target, so the sheet never asks which cell and no colour control sits on the grid. */
  const openColorSheet = React.useCallback(
    (scope: MatrixColorScope, itemKey: string | null, month: string | null, label: string) =>
      setColorTarget({ scope, itemKey, month, label }),
    [],
  );
  const onCellLongPress = React.useCallback((columnKey: string, month: MonthKey) => {
    const column = columns.find((col) => col.key === columnKey);
    if (!column) return;
    openColorSheet("cell", column.categoryId ?? column.key, month, `${monthLabel(month)} · ${column.label}`);
  }, [columns, openColorSheet]);
  const onItemLongPress = React.useCallback((key: string) => {
    const column = columns.find((col) => col.key === key);
    if (!column) return;
    openColorSheet("row", column.categoryId ?? column.key, null, column.label);
  }, [columns, openColorSheet]);
  const onMonthLongPress = React.useCallback(
    (month: string) => openColorSheet("column", null, month, monthLabel(month as MonthKey)),
    [openColorSheet],
  );

  const applyColorLabels = React.useCallback(async (labels: MatrixColorLabels) => {
    try {
      await setMatrixColorLabels(userId, labels);
      scheduleSync(userId);
    } catch (error) {
      devError("matrix-color-labels", error);
      void appAlert(tr.matrixColor.renameFailed, tr.errors.title);
    }
  }, [userId]);

  const applyColor = React.useCallback(async (token: MatrixColorToken | null) => {
    const target = colorTarget;
    if (!target) return;
    setColorTarget(null);
    try {
      await setMatrixColor(userId, { scope: target.scope, itemKey: target.itemKey, month: target.month }, token);
      scheduleSync(userId);
    } catch (error) {
      devError("matrix-color", error);
    }
  }, [colorTarget, userId]);

  // Deps are only what changes a cell's value, note, target or label, so StickyTable gets identical arrays.
  const { cornerLabel, stickyColumns, stickyRows, currentColumnKey } = useMemo(() => {
    const noteFor = (column: { key: string; categoryId?: string | null }, month: MonthKey): string | undefined =>
      column.key === "closing"
        ? adjustmentByMonth.get(month)
        : column.categoryId
          ? noteByCell.get(`${month}:${column.categoryId}`)
          : undefined;
    const rowMarkEdge = (itemKey: string): string | undefined => {
      const token = colorIndex.row.get(itemKey);
      return token ? matrixColorStyle(palette, token).edge : undefined;
    };
    const columnMarkEdge = (month: string): string | undefined => {
      const token = colorIndex.column.get(month);
      return token ? matrixColorStyle(palette, token).edge : undefined;
    };
    const canPressCell = (c: CashFlowMatrixColumn, month: MonthKey): boolean => {
      if (c.categoryId) return true;
      if (c.key === "closing" && adjustmentByMonth.has(month)) return true;
      return !c.system;
    };
    const cellNode = (column: CashFlowMatrixColumn, month: MonthKey, highlighted: boolean): React.ReactNode => {
      const value = column.values.get(month) ?? null;
      const note = noteFor(column, month);
      const balanceColumn = column.key === "opening" || column.key === "closing";
      const colorToken = resolveCellToken(colorIndex, column.categoryId ?? column.key, month);
      return (
        <MatrixCell
          columnKey={column.key}
          month={month}
          zeroIsMeaningful={balanceColumn}
          canPress={canPressCell(column, month)}
          onCellPress={onCellPress}
          colorToken={colorToken}
          colorName={nameForToken(colorToken)}
          onCellLongPress={onCellLongPress}
          value={value}
          note={note}
          markerTone={column.key === "closing" ? "adjustment" : "note"}
          highlighted={highlighted}
          fontSize={fontSize}
          accessibilityLabel={tr.a11y.matrixCell(
            monthLabel(month),
            column.label,
            hasPrintableValue(value, balanceColumn) ? formatMinorCompact(value) : tr.a11y.emptyValue,
            Boolean(note),
          )}
        />
      );
    };

    if (orientation === "monthsAsRows") {
      return {
        cornerLabel: tr.cashflow.monthHeader,
        currentColumnKey: undefined as string | undefined,
        stickyColumns: columns.map((c) => ({
          key: c.key,
          label: c.label,
          icon: c.computed ? Sigma : undefined,
          markEdge: rowMarkEdge(c.categoryId ?? c.key),
        })),
        stickyRows: months.map((slot) => ({
          key: slot.month,
          label: monthName(slot.month),
          accessibilityLabel: monthLabel(slot.month),
          onLabelPress: () => router.push(`/cash-flow/${slot.month}`),
          labelHighlight: slot.month === currentMonth,
          rowHighlight: slot.month === currentMonth,
          markEdge: columnMarkEdge(slot.month),
          // Highlighted per cell, not by the row wash, which sits under a marked cell's own fill and is lost.
          cells: columns.map((c) => cellNode(c, slot.month, slot.month === currentMonth)),
        })),
      };
    }
    return {
      cornerLabel: tr.cashflow.itemHeader,
      currentColumnKey: currentMonth,
      stickyColumns: months.map((slot) => ({
        key: slot.month,
        label: compact ? shortMonthLabel(slot.month) : monthName(slot.month),
        accessibilityLabel: monthName(slot.month),
        markEdge: columnMarkEdge(slot.month),
      })),
      stickyRows: columns.map((c) => ({
        key: c.key,
        label: c.label,
        icon: c.computed ? Sigma : undefined,
        onLabelPress: c.key === "opening" || c.key === "closing" ? undefined : () => openBreakdown(c.key),
        markEdge: rowMarkEdge(c.categoryId ?? c.key),
        cells: months.map((slot) => cellNode(c, slot.month, slot.month === currentMonth)),
      })),
    };
  }, [orientation, columns, months, compact, fontSize, noteByCell, adjustmentByMonth, onCellPress, onCellLongPress, colorIndex, nameForToken, palette, openBreakdown, router, currentMonth]);

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
        onColumnLongPress={isColumns ? onMonthLongPress : onItemLongPress}
        onRowLongPress={isColumns ? onItemLongPress : onMonthLongPress}
        height={tableHeight}
      />
      {colorTarget ? (
        <MatrixColorSheet
          scope={colorTarget.scope}
          targetLabel={colorTarget.label}
          current={
            colorTarget.scope === "row"
              ? colorIndex.row.get(colorTarget.itemKey ?? "") ?? null
              : colorTarget.scope === "column"
                ? colorIndex.column.get(colorTarget.month ?? "") ?? null
                : colorIndex.cell.get(`${colorTarget.itemKey}\u0000${colorTarget.month}`) ?? null
          }
          labels={colorLabels}
          onCancel={() => setColorTarget(null)}
          onSelect={applyColor}
          onRename={applyColorLabels}
        />
      ) : null}
    </Card>
  );
});

/** Whether a cell prints anything. Zero is blank in a category cell and a real value in a balance column; one predicate keeps the drawn and spoken cell in agreement. */
function hasPrintableValue(value: number | null, zeroIsMeaningful: boolean): value is number {
  return value != null && (value !== 0 || zeroIsMeaningful);
}

// Memoized leaf; `onCellPress` must stay referentially stable or this memo is a no-op.
const MatrixCell = React.memo(function MatrixCell({
  columnKey,
  month,
  canPress,
  onCellPress,
  value,
  zeroIsMeaningful,
  note,
  markerTone = "note",
  highlighted,
  fontSize,
  accessibilityLabel,
  colorToken,
  colorName,
  onCellLongPress,
}: {
  columnKey: string;
  month: MonthKey;
  canPress: boolean;
  onCellPress: (columnKey: string, month: MonthKey) => void;
  colorToken?: MatrixColorToken | null;
  /** What the owner calls that hue — spoken, so a mark is never colour alone. */
  colorName?: string | null;
  onCellLongPress?: (columnKey: string, month: MonthKey) => void;
  value: number | null;
  /** A balance column's zero is a real number; a category cell's zero is not. */
  zeroIsMeaningful: boolean;
  note?: string;
  /** What the corner dot means, so the two never look alike. */
  markerTone?: "note" | "adjustment";
  highlighted?: boolean;
  fontSize: number;
  accessibilityLabel: string;
}) {
  const { palette } = useTheme();
  const onPress = canPress ? () => onCellPress(columnKey, month) : undefined;
  const onLongPress = onCellLongPress ? () => onCellLongPress(columnKey, month) : undefined;
  const mark = colorToken ? matrixColorStyle(palette, colorToken) : null;
  return (
    <Pressable
      disabled={!onPress && !onLongPress}
      // The grid is one tab stop; arrows move between cells (useGridKeyboard) and Enter opens the focused one.
      tabIndex={-1}
      onPress={onPress}
      onLongPress={onLongPress}
      // A cell that cannot be opened still announces month/column/value, as a labelled group.
      role={onPress ? "button" : "group"}
      // The mark is spoken as well as painted.
      accessibilityLabel={colorToken ? `${accessibilityLabel}. ${tr.matrixColor.marked(colorName ?? "")}` : accessibilityLabel}
      // Hold to mark; sighted users find it by trying, everyone else hears it here.
      accessibilityHint={[note, onLongPress ? tr.matrixColor.action : null].filter(Boolean).join(". ") || undefined}
      style={(state) => [
        {
          flex: 1,
          minWidth: 0,
          justifyContent: "center",
          paddingHorizontal: fontSize <= type.caption.fontSize ? 2 : spacing.sm,
        },
        mark && { backgroundColor: mark.fill, borderLeftWidth: 3, borderLeftColor: mark.edge },
        interactionSurface(palette, state, { enabled: Boolean(onPress) }),
      ]}
    >
      {/* The current-month wash is an overlay: a second backgroundColor replaces the colour mark instead of compositing. */}
      {highlighted ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[StyleSheet.absoluteFill, { backgroundColor: palette.primary + CURRENT_TINT }]}
        />
      ) : null}
      {hasPrintableValue(value, zeroIsMeaningful) ? (
        <View style={{ width: "100%", minWidth: 0, alignItems: "flex-end" }}>
          <Amount
            testID="matrix-value"
            minor={value}
            colorized={false}
            color={value < 0 ? palette.negativeText : palette.text}
            style={[type.amountSm, { maxWidth: "100%", fontSize, textAlign: "right" }]}
          />
        </View>
      ) : null}
      {note ? (
        <View
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 6,
            height: 6,
            borderRadius: circle(6),
            // A reconciled month is not a note, so it does not wear the note's dot.
            backgroundColor: markerTone === "adjustment" ? palette.primary : palette.warning,
          }}
        />
      ) : null}
    </Pressable>
  );
});
