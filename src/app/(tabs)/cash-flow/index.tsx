/**
 * Mali Tablo. A spreadsheet matrix with a pinned first column (sticky on web
 * and iOS), a pivot toggle (months as rows / columns) available on every
 * width, full Jan–Dec rows with the current month highlighted, and an
 * optional user-pinned extra column. Cells open the editor; notes show a dot.
 * Phones can also switch to a no-horizontal-scroll, month-focused table.
 */

import React, { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { useRouter, type Href } from "expo-router";
import ArrowDownRight from "lucide-react-native/icons/arrow-down-right";
import ArrowLeftRight from "lucide-react-native/icons/arrow-left-right";
import ArrowUpRight from "lucide-react-native/icons/arrow-up-right";
import CalendarPlus from "lucide-react-native/icons/calendar-plus";
import ChartNoAxesColumn from "lucide-react-native/icons/chart-no-axes-column";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CreditCard from "lucide-react-native/icons/credit-card";
import Flag from "lucide-react-native/icons/flag";
import Inbox from "lucide-react-native/icons/inbox";
import Info from "lucide-react-native/icons/info";
import Pencil from "lucide-react-native/icons/pencil";
import Plus from "lucide-react-native/icons/plus";
import Sigma from "lucide-react-native/icons/sigma";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { monthFlowTotals, type LedgerBundle } from "../../../domain/balance";
import { buildCashFlowMatrixModel, type CashFlowMatrixColumn } from "../../../domain/cash-flow-matrix";
import { orderLedgerCategories, resolveYearColumns } from "../../../domain/year-columns";
import { monthKeyOf, todayISO, yearOf, type MonthKey } from "../../../domain/dates";
import { resolveMatrixMode, type MatrixMode } from "../../../domain/matrix-preferences";
import { formatMinorCompact } from "../../../domain/money";
import { dateLabel, monthLabel, monthName, shortMonthLabel, tr } from "../../../i18n/tr";
import { balanceDeclarationDrift, parseBalanceDeclaration } from "../../../domain/balance-declaration";
import {
  settingValue,
  useAllTransactionsState,
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
import { Amount, Button, Card, DataStateNotice, EmptyState, FadeIn, IconButton, Row, Screen, Segmented, Spread } from "../../../ui/components";
import { useScrollToTop } from "@react-navigation/native";
import { StickyTable, STICKY_HEADER_HEIGHT, STICKY_ROW_HEIGHT } from "../../../ui/sticky-table";
import { MatrixColorSheet } from "../../../ui/matrix-color-sheet";
import { buildColorIndex, matrixColorLabel, MATRIX_COLOR_TOKENS, parseMatrixColorLabels, resolveCellToken, type MatrixColorLabels, type MatrixColorScope, type MatrixColorToken } from "../../../domain/matrix-colors";
import { interactionSurface } from "../../../ui/interaction";
import { circle, controlSize, iconSize, matrixColorStyle, radius, spacing, type, useTheme } from "../../../ui/theme";
import { ledgerCellWidth, shouldStartTableDetailsOpen, shouldUseWideWorkspace } from "../../../ui/responsive";
import { useContentWidth } from "../../../ui/viewport";
import { CategoryIcon } from "../../../ui/category-icon";

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
      // The press surface is the control's own box. It used to be a 30x28
      // rectangle behind the icon while the pressable was the whole column,
      // so holding the tool lit a small patch sitting above its own caption
      // instead of the thing being pressed.
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

/** The pivot's three orientations, named so the control and the wrapper that
 *  bounds it cannot disagree about how many segments there are. */
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
  const hiddenComputed = useMemo(() => settingValue<string[]>(settings, "computed_columns_hidden", []), [settings]);
  // "You told me X; this table says Y." The declaration is the last balance the
  // user checked against a real account.
  const balanceDeclaration = parseBalanceDeclaration(settingValue<unknown>(settings, "balance_declared", null));
  // Memoized like the other JSON settings: `settingValue` parses on every read,
  // so an unmemoized one hands the memoized table a new object each render and
  // defeats it.
  const colorLabels = useMemo(
    () => parseMatrixColorLabels(settingValue<unknown>(settings, "matrix_color_labels", null)),
    [settings],
  );
  const balanceDrift = balanceDeclarationDrift(balanceDeclaration, bundle?.actualBalanceMinor ?? null);
  const visibleComputed = useMemo(() => computed.filter((c) => !hiddenComputed.includes(c.id)), [computed, hiddenComputed]);
  const sources = sourcesState.data;
  const allTx = allTxState.data;
  const { status: dataStatus, retry: retryData } = combineLiveStates([ledgerState, categoriesState, computedState, settingsState, sourcesState, personsState, allTxState, cellNotesState, matrixColorsState]);
  const contentWidth = useContentWidth();
  const wide = shouldUseWideWorkspace(contentWidth);
  const router = useRouter();
  const { palette } = useTheme();
  // A phone needs the category-first scan of column mode; a wide workspace has
  // room for the year-wide row mode. Once the owner chooses, that persisted
  // preference wins over device width on every later mount.
  const defaultMode: MatrixMode = wide ? "rows" : "columns";
  const [mode, setMode] = useState<MatrixMode>(defaultMode);
  const [hasSavedMode, setHasSavedMode] = useState<boolean | null>(null);
  const [focusMonthNumber, setFocusMonthNumber] = useState(Number(monthKeyOf(todayISO()).slice(5, 7)));
  const [pinnedByMode, setPinnedByMode] = useState<Record<PinMode, string | null>>({ rows: null, columns: null });
  const [tableAreaH, setTableAreaH] = useState(0);
  // Rounded, so a sub-pixel layout report cannot rebuild the grid.
  const onTableAreaLayout = React.useCallback((event: LayoutChangeEvent) => {
    const height = Math.round(event.nativeEvent.layout.height);
    setTableAreaH((current) => (current === height ? current : height));
  }, []);
  // Desktop starts with the reading guide open so the table explains itself;
  // every viewport can collapse it once the user knows the grammar. Closing it
  // is remembered — it is a statement about what the user already knows, and
  // re-teaching them the grammar on every visit is exactly what they asked to
  // stop. Device-local, beside the pivot and pin: a phone and a desktop are
  // allowed to disagree about it.
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
      // The old single key was valid for whichever orientation happened to be
      // open. Seed both slots only when neither new slot exists. Falling back
      // to the legacy key one slot at a time would resurrect a pin the user
      // had deliberately cleared after the migration.
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
  // MatrixTable is memoized below; an inline arrow here would recreate
  // `onTogglePin` — and defeat that memo — on every unrelated render (resize,
  // layout measurement, live query).
  const togglePin = React.useCallback((key: string) => {
    if (mode === "cards") return;
    const pinMode: PinMode = mode === "columns" ? "columns" : "rows";
    const next = pinnedByMode[pinMode] === key ? null : key;
    setPinnedByMode((current) => ({ ...current, [pinMode]: next }));
    if (pinMode === "rows") void kv.set(ROW_PIN_KEY, next ?? "");
    else void kv.set(COLUMN_PIN_KEY, next ?? "");
  }, [mode, pinnedByMode]);
  const focusMonth = `${year}-${String(focusMonthNumber).padStart(2, "0")}` as MonthKey;

  // Everything from here to `tableMatrix` is derived from the whole ledger, and
  // all of it used to be recomputed on EVERY render of this screen — including
  // the ones caused by a pin, a layout measurement, a resize, or the router
  // re-rendering the scaffold on navigation. On a real workbook that is the
  // entire transaction list mapped, grouped and totalled before React can paint
  // anything, which is the stutter felt when arriving at Mali Tablo and when
  // opening the reading guide. It is derived from the data now, not from the
  // render.
  const creditCardIds = useMemo(
    () => new Set(sources.filter((src) => src.type === "credit_card").map((src) => src.id)),
    [sources],
  );
  const txLike = useTxLike();

  // Year switcher bounds: back to the earliest data, forward only while there
  // is actual data (e.g. installments spilling into next year).
  const minYear = bundle ? yearOf(bundle.startMonth) : currentYear;
  const lastTransaction = allTx.at(-1);
  const lastDataYear = lastTransaction ? yearOf(lastTransaction.effectiveDate) : currentYear;
  const maxYear = Math.max(currentYear, lastDataYear);

  // Per-year columns (see domain/year-columns.ts for the resolution rules).
  // `settingValue` parses JSON, so an unmemoized read hands a brand-new object
  // to every consumer below it on every render.
  const columnYears = useMemo(
    () => settingValue<Record<string, string[]>>(settings, "column_years", {}),
    [settings],
  );
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
          openingLabel: tr.cashflow.opening,
          closingLabel: tr.cashflow.closing,
          startMonth: bundle.startMonth,
        })
      : null,
    [bundle, year, columnCategories, visibleComputed, txLike, creditCardIds, liveCategoryIds, today],
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
    // `wide`, not `workspace`: this is the one surface that is a dense grid all
    // the way down. At 1920 the workspace cap left the ledger scrolling
    // sideways with 350px of empty page beside it — the screen was asking to be
    // used and the width refused.
    <Screen title={tr.cashflow.title} right={yearSwitcher} width="wide" scroll={false} padded>
      <View
        style={{
          gap: spacing.sm,
          marginBottom: spacing.sm,
        }}
      >
        {/* ONE toolbar, at every width.
            It used to be two: six labelled buttons in a row above a tablet, and
            below it a small button over five icon tiles whose captions were 9px
            — three sizes under the smallest role the type scale declares. Same
            five destinations, two control languages and two label sets, so the
            same screen had to be relearned when the window changed. The band
            spans the page, the entry action leads it, and the five tools share
            the row underneath at any size. */}
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

      {!bundle ? (
        dataStatus === "loading" || dataStatus === "error" ? null : (
          <EmptyState
            icon={Inbox}
            title={tr.cashflow.emptyMonth}
            hint={tr.cashflow.emptyYearHint}
            action={<Button icon={Flag} label={tr.cashflow.openingLink} variant="secondary" onPress={() => router.push("/opening-balance")} />}
          />
        )
      ) : (
        <View style={{ flex: 1 }}>
          {/* The pivot spans the page and centres its segments, so it sits in
              the same place on a phone, a tablet and a zoomed desktop. The
              guide toggle lives inside its strip, sharing the height, baseline
              and selected treatment rather than standing beside it as a taller
              bordered square. */}
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
          {/* It fades in, and its height changes in one step.
              Animating the height meant the table underneath was re-laid out on
              every frame of it — a twelve-column grid rebuilt a dozen times
              inside one 220ms transition, which is the stutter the owner felt
              on this button. Opacity is composited, so the panel still arrives
              rather than blinking, and the grid moves exactly once. */}
          {showTable && tableMatrix && showTableDetails ? (
            <FadeIn>
              <TableDetailsPanel
                hasUncategorized={tableMatrix.hasUncategorized}
                uncategorizedTotal={tableMatrix.uncategorizedTotal}
                colorLabels={colorLabels}
                onOpenUncategorized={() => router.push({
                  pathname: "/cash-flow/item",
                  params: { col: "__uncategorized", label: tr.cashflow.uncategorizedLegacy, year: String(year), kind: "uncategorized" },
                })}
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

/** The card view of the same matrix the table renders — one model, one owner.
 *  It used to rebuild `buildCashFlowMatrixModel` from the same arguments the
 *  screen had already memoized, so switching to cards paid for the whole
 *  ledger twice and then again on every re-render of this subtree. */
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
  const monthNumber = Number(month.slice(5, 7));
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
          label={monthLabel(`${year}-${String(Math.max(1, monthNumber - 1)).padStart(2, "0")}`)}
          disabled={monthNumber <= 1}
          onPress={() => onMonthChange(monthNumber - 1)}
        />
        <Text accessibilityRole="header" style={[type.heading, { color: month === monthKeyOf(today) ? palette.primaryText : palette.text }]}>
          {monthLabel(month)}
        </Text>
        <IconButton
          icon={ChevronRight}
          label={monthLabel(`${year}-${String(Math.min(12, monthNumber + 1)).padStart(2, "0")}`)}
          disabled={monthNumber >= 12}
          onPress={() => onMonthChange(monthNumber + 1)}
        />
      </View>

      {flows ? (
        <Card testID="month-focus-card" style={{ padding: spacing.md }}>
          <Spread style={{ alignItems: "center" }}>
            <View>
              <Text style={[type.small, { color: palette.textSecondary }]}>{tr.cashflow.closing}</Text>
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
                {/* One drawing language in one box. This used to be a 15pt
                    lucide Sigma, a 14pt colour emoji, or a 15pt lucide Flag
                    depending on the column — three marks that agreed about
                    nothing, stacked down a single column of the app's main
                    financial surface. */}
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
            onPress={() => router.push({
              pathname: "/cash-flow/item",
              params: { col: "__uncategorized", label: tr.cashflow.uncategorizedLegacy, year: String(year), kind: "uncategorized" },
            })}
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
      {/* The marks, said once and shown once. A guide that explains holding a
          cell without showing what the four colours are called leaves the
          reader to open the sheet to find out — and these are the OWNER's
          names, so a fixed sentence could not have listed them. */}
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

// Memoized: this builds ~300 cell elements (25 columns × 12 months) plus their
// row/column wrappers. Unmemoized, every parent render — a resize event, the
// table-area layout measurement, a pin/pivot toggle, any of the ~8 live
// queries the screen subscribes to — rebuilt the whole tree from scratch even
// though the arithmetic behind it (`tableMatrix`) was already memoized.
const MatrixTable = React.memo(function MatrixTable({
  year,
  bundle,
  matrix,
  cellNotes,
  orientation,
  compact,
  measuredHeight,
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
  pinnedKey: string | null;
  onTogglePin: (key: string) => void;
  colors: ReturnType<typeof useMatrixColorsState>["data"];
  /** What the owner calls each mark hue. Account-wide, never per cell. */
  colorLabels: MatrixColorLabels | null;
  scrollRef: React.RefObject<ScrollView | null>;
}) {
  const { width: viewportWidth } = useWindowDimensions();
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

  // Rebuilt from scratch every render before, same cost class as the grid
  // itself. Keyed off the same `cellNotes`/`bundle` references the live
  // queries already hand down, so an unrelated render is a no-op here too.
  const noteByCell = useMemo(
    () => new Map(cellNotes.map((note) => [`${note.month}:${note.categoryId}`, note.body])),
    [cellNotes],
  );
  // A reconciled month looks exactly like an ordinary one in this table, so the
  // closing figure silently stopped matching the flows above it. It carries the
  // same marker a cell note does — the cell has something extra behind it.
  const adjustmentByMonth = useMemo(
    () => new Map(
      bundle.yearMonths
        .filter((month) => month.adjustmentMinor !== 0)
        .map((month) => [month.month, tr.cashflow.adjustedCell(formatMinorCompact(month.adjustmentMinor))]),
    ),
    [bundle.yearMonths],
  );
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
  // A user-authored column name may be a paragraph; the header only gets to
  // ask for as much width as a reasonable one needs.
  const longestHeaderChars = orientation === "monthsAsRows"
    ? columns.reduce((longest, column) => Math.max(longest, Math.min(column.label.length, 24)), 0)
    : months.reduce((longest, month) => Math.max(longest, (compact ? shortMonthLabel(month.month) : monthName(month.month)).length), 0);
  const bodyTableWidth = Math.max(1, availableTableWidth - HEAD_W);
  const CELL_W = ledgerCellWidth({
    gridWidth: bodyTableWidth,
    valueChars: longestValueChars,
    headerChars: longestHeaderChars,
    columnCount: visibleColumnCount,
    compact,
  });
  const fontSize = compact ? type.caption.fontSize : type.label.fontSize;
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

  // One dispatcher shared by every cell, keyed by (columnKey, month) at press
  // time, instead of a fresh `() => router.push(...)` closure built per cell
  // per render (the old `pressFor`). MatrixCell is memoized below; a
  // per-render closure prop would defeat that memo regardless of `useCallback`
  // on the function that *returns* it, since each call still allocates a new
  // function.
  const onCellPress = React.useCallback((columnKey: string, month: MonthKey) => {
    const c = columns.find((col) => col.key === columnKey);
    if (!c) return;
    if (c.categoryId) {
      router.push({ pathname: "/cell-editor", params: { month, categoryId: c.categoryId } });
      return;
    }
    // A reconciled closing figure is the one system cell with somewhere to go:
    // the adjustment that moved it. Root-level route, so what sits underneath
    // is this screen and both the back button and the edge swipe return here.
    if (c.key === "closing" && adjustmentByMonth.has(month)) {
      router.push("/opening-balance" as Href);
      return;
    }
    if (c.system) return;
    openBreakdown(c.key); // computed column cell → its breakdown
  }, [columns, adjustmentByMonth, router, openBreakdown]);

  /**
   * Hold anything on the grid to mark it.
   *
   * The gesture carries the target, so the sheet never asks "which cell did
   * you mean" and the app needs no permanently visible colour control on a
   * screen whose whole job is showing money.
   */
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

  // Builds the ~300 cell elements plus their row/column wrappers. Honest
  // deps: only what can actually change a cell's value, note, press target or
  // label. A resize, the table-area layout measurement, or a pin toggle
  // touches none of these, so the memo skips rebuilding the tree entirely —
  // StickyTable then receives the exact same row/column arrays it had before,
  // not just shallow-equal ones.
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
      // Zero means two different things in this grid, and it used to be drawn
      // and spoken as if it meant one. In a CATEGORY cell, zero is "nothing
      // happened": the cell stays blank and announces itself as empty. In a
      // BALANCE column, zero is a real balance the chain arrived at, so a
      // blank cell there reads as "not calculated" — the month that closed at
      // exactly ₺0,00 simply vanished from the running balance, while a screen
      // reader was told "₺0,00" for all 91 genuinely-empty cells beside it.
      const balanceColumn = column.key === "opening" || column.key === "closing";
      const shown = balanceColumn ? value : value === 0 ? null : value;
      return (
        <MatrixCell
          columnKey={column.key}
          month={month}
          zeroIsMeaningful={balanceColumn}
          canPress={canPressCell(column, month)}
          onCellPress={onCellPress}
          colorToken={resolveCellToken(colorIndex, column.categoryId ?? column.key, month)}
          colorName={nameForToken(resolveCellToken(colorIndex, column.categoryId ?? column.key, month))}
          onCellLongPress={onCellLongPress}
          value={value}
          note={note}
          markerTone={column.key === "closing" ? "adjustment" : "note"}
          highlighted={highlighted}
          fontSize={fontSize}
          accessibilityLabel={tr.a11y.matrixCell(
            monthLabel(month),
            column.label,
            shown == null ? tr.a11y.emptyValue : formatMinorCompact(shown),
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
          cells: columns.map((c) => cellNode(c, slot.month, false)),
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

/**
 * Whether a cell prints anything at all.
 *
 * Zero means two different things in this grid: in a category cell it is "no
 * activity" and stays blank, in a balance column it is a real balance the
 * chain arrived at. One predicate, so the drawn cell and its spoken label can
 * never disagree again — they did, and 91 of 240 cells were announced as
 * "₺0,00" while showing nothing.
 */
function hasPrintableValue(value: number | null, zeroIsMeaningful: boolean): value is number {
  return value != null && (value !== 0 || zeroIsMeaningful);
}

// Memoized: each cell is a leaf in a ~300-node grid, re-rendered only when
// its own props change. `onCellPress` is the one non-primitive prop — it must
// stay referentially stable (see MatrixTable's `useCallback`) or this memo is
// a no-op.
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
      // The grid is ONE tab stop, not 240. Reaching the navigation bar behind a
      // two-year ledger used to take 240 Tab presses; the arrows now move
      // between cells (see `useGridKeyboard`) and Tab moves past the table.
      // Still focusable programmatically, so Enter opens the focused cell.
      tabIndex={-1}
      onPress={onPress}
      onLongPress={onLongPress}
      // A cell that cannot be opened (a system column, or one with nothing to
      // edit) still has to announce its month/column/value. A labelled group
      // keeps that context without implying an action.
      role={onPress ? "button" : "group"}
      // The mark is SPOKEN as well as painted. A cell whose only difference is
      // a wash of colour is a cell that says nothing to a screen reader and
      // nothing to someone who cannot separate the hues.
      accessibilityLabel={colorToken ? `${accessibilityLabel}. ${tr.matrixColor.marked(colorName ?? "")}` : accessibilityLabel}
      // Holding a cell marks it. Sighted users find that by trying it; this is
      // how everyone else does, without a permanent control on the grid.
      accessibilityHint={[note, onLongPress ? tr.matrixColor.action : null].filter(Boolean).join(". ") || undefined}
      style={(state) => [
        {
          flex: 1,
          minWidth: 0,
          justifyContent: "center",
          paddingHorizontal: fontSize <= type.caption.fontSize ? 2 : spacing.sm,
        },
        // The mark sits UNDER the current-month highlight: a marked cell in
        // the current month has to keep reading as the current month.
        mark && { backgroundColor: mark.fill, borderLeftWidth: 3, borderLeftColor: mark.edge },
        highlighted && { backgroundColor: palette.primarySoft + "55" },
        interactionSurface(palette, state, { enabled: Boolean(onPress) }),
      ]}
    >
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
            // A reconciled month is not a note, and wearing the note's amber
            // dot said it was — same mark, nothing behind it when tapped.
            backgroundColor: markerTone === "adjustment" ? palette.primary : palette.warning,
          }}
        />
      ) : null}
    </Pressable>
  );
});
