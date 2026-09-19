/** Analysis: category × month matrix over a selectable window (3/6/12 months
 *  or a calendar year), a category filter, per-category cumulative trend and
 *  transaction search. */

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import FileSpreadsheet from "lucide-react-native/icons/file-spreadsheet";
import Inbox from "lucide-react-native/icons/inbox";
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal";
import Target from "lucide-react-native/icons/target";
import { categoryRangeMatrix, distributionForRange, monthlySeries } from "../../../domain/analytics";
import { addMonthsToKey, firstDayOf, lastDayOf, makeMonthKey, monthKeyOf, monthRange, todayISO, yearOf, type MonthKey } from "../../../domain/dates";
import { formatMinorCompact } from "../../../domain/money";
import { isWorkbookRemainderRow, signedBalanceEffectOf } from "../../../domain/transactions";
import { filterTransactions, sortTransactions, type TransactionSortMode } from "../../../domain/transaction-search";
import { budgetProgress } from "../../../domain/budgets";
import { categoryIconComponent,  } from "../../../ui/category-icon";
import { PaymentSourceLogo } from "../../../ui/logo";
import { transactionDateText } from "../../../ui/transaction-date";
import { monthLabel, monthName, shortMonthLabel, tr } from "../../../i18n/tr";
import {
  useAllTransactionsState,
  useCategoryBudgetsState,
  useCategoriesState,
  usePersonsState,
  useSourcesState,
  useTxLike,
} from "../../../data/hooks";
import { combineLiveStates } from "../../../data/live-state";
import { Amount, Badge, Body, Button, Card, CardList, DataGateScreen, DataStateNotice, Divider, EmptyState, Field, FieldNote, Heading, IconButton, ListRow, MetricStrip, PanelHeader, Row, Screen, SectionHeader, Segmented, Select, Spread } from "../../../ui/components";
import { Bars, ChartFrame, Donut, Lines, distributionDonutData, useSeriesColors } from "../../../ui/charts";
import { Collapse } from "../../../ui/motion-primitives";
import { StickyTable } from "../../../ui/sticky-table";
import { shouldOfferTrendChart, shouldPairFilterCards, shouldUseNarrowAnalytics, shouldUseWideWorkspace } from "../../../ui/responsive";
import { useContentWidth } from "../../../ui/viewport";
import { interactionBleed, interactionSurface } from "../../../ui/interaction";
import { radius, segmentedMaxWidth, spacing, type, useTheme } from "../../../ui/theme";
import { renderKeyboardSafeListScroll } from "../../../ui/keyboard-safe";

/** The Select's own icon column, so a source mark fits it exactly. */
const SOURCE_MARK = 22;

type Period = "1m" | "3m" | "6m" | "12m" | "year" | "custom";

/** Results shown before the user asks for the rest. */
const RESULT_PREVIEW_COUNT = 5;

/** What one table row occupies when its label fits a single line, and the
 *  header plus footer around the rows. A CEILING input, never a measurement. */
const ANALYSIS_ROW_HEIGHT = 52;
const ANALYSIS_TABLE_CHROME = 60;

type TxRow = ReturnType<typeof useAllTransactionsState>["data"][number];
type Category = ReturnType<typeof useCategoriesState>["data"][number];
type Source = ReturnType<typeof useSourcesState>["data"][number];
type CategoryRow = { category: Category; data: NonNullable<ReturnType<ReturnType<typeof categoryRangeMatrix>["get"]>> };

/** The months under analysis: a rolling window ending now, a calendar year, or a range the owner names. */
function useAnalysisWindow(narrow: boolean, today: string) {
  const currentYear = yearOf(today);
  const currentMonth = monthKeyOf(today);
  // Phone starts with a useful comparison that fits the table in fewer
  // horizontal gestures; year and custom windows remain explicit choices.
  const [period, setPeriod] = useState<Period>(narrow ? "3m" : "year");
  const [year, setYear] = useState(currentYear);
  // A custom window is two months the user names outright. Seeded to the last
  // six so switching to it shows a real range instead of an empty one.
  const [customStart, setCustomStart] = useState<MonthKey>(addMonthsToKey(currentMonth, -5));
  const [customEnd, setCustomEnd] = useState<MonthKey>(currentMonth);
  // Ordered here rather than guarded at each stepper: whichever end the user
  // moves past the other, the window stays a window.
  const [startMonth, endMonth] = period === "year"
    ? [makeMonthKey(year, 1), year === currentYear ? currentMonth : makeMonthKey(year, 12)]
    : period === "custom"
      ? [customStart, customEnd].sort() as [MonthKey, MonthKey]
      : [addMonthsToKey(currentMonth, -(Number(period.replace("m", "")) - 1)), currentMonth];
  const monthKeys = useMemo(() => monthRange(startMonth, endMonth), [startMonth, endMonth]);
  return { currentYear, currentMonth, period, setPeriod, year, setYear, customStart, setCustomStart, customEnd, setCustomEnd, startMonth, endMonth, monthKeys };
}

/** Finding transactions: a query and filters over the window or all time, sorted, five at a time. */
function useTransactionSearch({ transactions, categoryById, sources, categoryFilter, startMonth, endMonth }: {
  transactions: TxRow[];
  categoryById: Map<string, Category>;
  sources: Source[];
  categoryFilter: string | null;
  startMonth: MonthKey;
  endMonth: MonthKey;
}) {
  const [query, setQuery] = useState("");
  const [transactionType, setTransactionType] = useState<"expense" | "income" | "transfer" | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [searchScope, setSearchScope] = useState<"period" | "all">("period");
  const [sortMode, setSortMode] = useState<TransactionSortMode>("recent");
  const [showAllResults, setShowAllResults] = useState(false);
  const [showSearchDetails, setShowSearchDetails] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const sourceNameById = useMemo(() => new Map(sources.map((source) => [source.id, source.name])), [sources]);
  // Asking for all time is itself a request to see records, so it counts as a
  // filter. Without it, clearing the payment method back to "Tümü" emptied
  // the list even though the owner had just told the screen what to search.
  const active = deferredQuery.trim() !== "" || transactionType != null || categoryFilter != null || sourceFilter != null || searchScope === "all";
  // The token line calls the money formatter — an `Intl.NumberFormat` — once
  // per transaction the account has: measured 65 ms at 100k rows. Built from
  // the render it was rebuilt on every keystroke in the box above it, every
  // filter chip and every layout measurement. It follows the data now, and
  // still only exists while a search is actually open.
  const index = useMemo(
    () => (!active ? [] : transactions.map((transaction) => ({
      ...transaction,
      searchText: [
        transaction.categoryId ? categoryById.get(transaction.categoryId)?.name ?? "" : "",
        sourceNameById.get(transaction.paymentSourceId ?? "") ?? "",
        transaction.note ?? "",
        monthName(monthKeyOf(transaction.effectiveDate)),
        String(yearOf(transaction.effectiveDate)),
        String(Math.round(transaction.amountTryMinor / 100)),
        // The plain major number is a non-rendered search token; every
        // spoken or painted amount below uses the shared formatter.
        formatMinorCompact(transaction.amountTryMinor),
      ].join(" "),
    }))),
    [active, transactions, categoryById, sourceNameById],
  );
  const results = useMemo(
    () => (active
      ? filterTransactions(index, {
          query: deferredQuery,
          type: transactionType,
          categoryId: categoryFilter,
          paymentSourceId: sourceFilter,
          from: searchScope === "period" ? firstDayOf(startMonth) : null,
          to: searchScope === "period" ? lastDayOf(endMonth) : null,
        })
      : []),
    [active, index, deferredQuery, transactionType, categoryFilter, sourceFilter, searchScope, startMonth, endMonth],
  );
  const sorted = useMemo(() => sortTransactions(results, sortMode), [results, sortMode]);
  return {
    query, setQuery, transactionType, setTransactionType, sourceFilter, setSourceFilter, searchScope, setSearchScope, sortMode, setSortMode,
    showAllResults, setShowAllResults, showSearchDetails, setShowSearchDetails, active, sorted, sourceNameById,
    // A period can match hundreds of rows, and a wall of them answers no question.
    // Five is what fits under the filters without scrolling; the sort decides which five.
    visible: showAllResults ? sorted : sorted.slice(0, RESULT_PREVIEW_COUNT),
  };
}

type AnalysisWindow = ReturnType<typeof useAnalysisWindow>;
type Search = ReturnType<typeof useTransactionSearch>;

function WindowCard({ range, minYear, categories, categoryFilter, onCategoryFilter, allTime, style }: {
  range: AnalysisWindow;
  minYear: number;
  categories: Category[];
  categoryFilter: string | null;
  onCategoryFilter: (categoryId: string | null) => void;
  allTime: boolean;
  style?: { flex: number };
}) {
  const { palette } = useTheme();
  const { period, year } = range;
  // Newest first: a custom range is nearly always anchored near today.
  const monthOptions = monthRange(makeMonthKey(minYear, 1), range.currentMonth).reverse().map((month) => ({ value: month, label: monthLabel(month) }));
  return (
    <Card style={style}>
      <SectionHeader>{tr.analysis.viewWindow}</SectionHeader>
      {/* The slicer owns its own row: sharing one with the year switcher left
          "12 Ay" wrapping at six segments. What the period needs sits under it. */}
      <Segmented
        disabled={allTime}
        options={[
          { value: "1m", label: tr.analysis.period1m },
          { value: "3m", label: tr.analysis.period3m },
          { value: "6m", label: tr.analysis.period6m },
          { value: "12m", label: tr.analysis.period12m },
          { value: "year", label: tr.analysis.periodYear },
          { value: "custom", label: tr.analysis.periodCustom },
        ]}
        value={period}
        onChange={range.setPeriod}
      />
      {period === "year" ? (
        <Spread style={{ marginBottom: spacing.md }}>
          <IconButton icon={ChevronLeft} label={String(year - 1)} onPress={() => range.setYear(year - 1)} disabled={allTime || year <= minYear} />
          <Text style={[type.heading, { color: palette.text, minWidth: 48, textAlign: "center" }]}>{year}</Text>
          <IconButton icon={ChevronRight} label={String(year + 1)} onPress={() => range.setYear(year + 1)} disabled={allTime || year >= range.currentYear} />
        </Spread>
      ) : null}
      {period === "custom" ? (
        /* Two month lists side by side, not two steppers stacked: a stepper asks
           one tap per month, and stacked they cost two thirds of the screen. */
        <Row style={{ alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <Select label={tr.analysis.customStart} options={monthOptions} value={range.customStart} onChange={range.setCustomStart} disabled={allTime} />
          </View>
          <View style={{ flex: 1 }}>
            <Select label={tr.analysis.customEnd} options={monthOptions} value={range.customEnd} onChange={range.setCustomEnd} disabled={allTime} />
          </View>
        </Row>
      ) : null}
      <Select
        label={tr.tx.category}
        options={[{ value: "", label: tr.analysis.allCategories }, ...categories.map((c) => ({ value: c.id, label: c.name, icon: categoryIconComponent(c) }))]}
        value={categoryFilter ?? ""}
        onChange={(v) => onCategoryFilter(v === "" ? null : v)}
      />
    </Card>
  );
}

function SearchCard({ search, sources, compact, periodLabel, onClear, style }: {
  search: Search;
  sources: Source[];
  compact: boolean;
  periodLabel: string;
  onClear: () => void;
  style?: { flex: number };
}) {
  const { searchScope, showSearchDetails } = search;
  return (
    <Card style={style}>
      <SectionHeader>{tr.analysis.findTransaction}</SectionHeader>
      <Field accessibilityLabel={tr.common.search} placeholder={tr.analysis.searchPlaceholder} value={search.query} onChangeText={search.setQuery} autoCapitalize="none" />
      <Segmented
        options={[
          { value: "all", label: tr.common.all },
          { value: "expense", label: tr.cashflow.expense },
          { value: "income", label: tr.cashflow.income },
          { value: "transfer", label: tr.cashflow.transfer },
        ]}
        value={search.transactionType ?? "all"}
        onChange={(value) => search.setTransactionType(value === "all" ? null : value)}
      />
      {compact ? (
        <View style={{ alignItems: "flex-start", marginBottom: showSearchDetails ? spacing.md : 0 }}>
          <Button
            icon={SlidersHorizontal}
            size="sm"
            variant="ghost"
            label={showSearchDetails ? tr.analysis.hideSearchFilters : tr.analysis.showSearchFilters}
            expanded={showSearchDetails}
            onPress={() => search.setShowSearchDetails(!showSearchDetails)}
          />
        </View>
      ) : null}
      {/* Both fields keep one line: the range belongs in the hint below, not
          inside a collapsed dropdown where it wrapped to three lines. */}
      <Collapse open={!compact || showSearchDetails}>
        <FieldNote note={searchScope === "period" ? tr.analysis.selectedPeriodRange(periodLabel) : tr.analysis.allTimeHint}>
          <Row style={{ alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <Select
                label={tr.analysis.searchSource}
                options={[{ value: "", label: tr.common.all }, ...sources.map((source) => ({ value: source.id, label: source.name, icon: <PaymentSourceLogo name={source.name} type={source.type} logoRef={source.logoRef} size={SOURCE_MARK} /> }))]}
                value={search.sourceFilter ?? ""}
                onChange={(value) => search.setSourceFilter(value || null)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Select
                label={tr.analysis.searchPeriod}
                options={[{ value: "period", label: tr.analysis.selectedPeriod }, { value: "all", label: tr.analysis.allTime }]}
                value={searchScope}
                onChange={search.setSearchScope}
              />
            </View>
          </Row>
        </FieldNote>
      </Collapse>
      {search.active && search.sorted.length > 1 ? (
        <Select
          label={tr.analysis.sortLabel}
          options={[
            { value: "recent", label: tr.analysis.sortRecent },
            { value: "oldest", label: tr.analysis.sortOldest },
            { value: "highest", label: tr.analysis.sortHighest },
            { value: "lowest", label: tr.analysis.sortLowest },
          ]}
          value={search.sortMode}
          onChange={search.setSortMode}
        />
      ) : null}
      {search.active && search.sorted.length === 0 ? (
        <View style={{ gap: spacing.sm, paddingTop: spacing.sm }}>
          <Body muted>{tr.analysis.noResults}</Body>
          {searchScope === "period" ? (
            <Button
              label={tr.analysis.searchAllTime}
              variant="ghost"
              size="sm"
              onPress={() => {
                search.setSearchScope("all");
                search.setShowSearchDetails(true);
              }}
            />
          ) : null}
          <Button label={tr.analysis.clearSearch} variant="ghost" size="sm" onPress={onClear} />
        </View>
      ) : null}
    </Card>
  );
}

/**
 * One found transaction. A broad filter can match every transaction, so results
 * render inside the screen's FlatList (real virtualization) with the card look
 * split across the first and last rows instead of a wrapping Card.
 */
function ResultRow({ transaction: t, first, last, categoryById, sourceName }: { transaction: TxRow; first: boolean; last: boolean; categoryById: Map<string, Category>; sourceName: string | undefined }) {
  const router = useRouter();
  const { palette } = useTheme();
  const category = t.categoryId ? categoryById.get(t.categoryId) : undefined;
  return (
    <View
      style={[
        { backgroundColor: palette.surface, paddingHorizontal: spacing.lg },
        first && { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.sm },
        last && { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, paddingBottom: spacing.sm, marginBottom: spacing.md },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityHint={tr.analysis.openTransaction}
        onPress={() => router.push({ pathname: "/transaction", params: { id: t.id } })}
        style={(state) => ({
          ...interactionBleed(),
          // The vertical padding belongs to the PRESSABLE: on the child the fill
          // stopped short of its own control top and bottom.
          paddingVertical: spacing.xs,
          borderRadius: radius.sm,
          ...interactionSurface(palette, state),
        })}
      >
        <Spread>
          <View style={{ flex: 1, paddingRight: spacing.sm }}>
            <Body>{category?.name || tr.common.none}</Body>
            <Body muted style={{ fontSize: type.small.fontSize }}>
              {transactionDateText(t)}
              {sourceName ? ` · ${sourceName}` : ""}
              {t.note ? ` · ${t.note}` : ""}
            </Body>
            {isWorkbookRemainderRow(t) ? (
              <View style={{ marginTop: spacing.xs, alignItems: "flex-start" }}>
                <Badge text={tr.analysis.remainderBadge} tone="muted" />
              </View>
            ) : t.amountTryMinor < 0 ? (
              <View style={{ marginTop: spacing.xs, alignItems: "flex-start" }}>
                <Badge text={tr.tx.reversalLabel(t.type)} tone={t.type === "income" ? "negative" : "positive"} />
              </View>
            ) : null}
          </View>
          <Amount minor={signedBalanceEffectOf(t.type, t.amountTryMinor, category?.kind ?? null)} />
        </Spread>
      </Pressable>
      {last ? null : <Divider flush />}
    </View>
  );
}

function DistributionCard({ narrow, supportsTrend, monthKeys, categoryFilter, categoryName, distribution, bars }: {
  narrow: boolean;
  supportsTrend: boolean;
  monthKeys: MonthKey[];
  categoryFilter: string | null;
  categoryName: string;
  distribution: ReturnType<typeof distributionDonutData>;
  bars: { groups: { label: string; values: number[] }[]; series: { label: string; color: string }[] };
}) {
  const colors = useSeriesColors();
  const [chartType, setChartType] = useState<"pie" | "bars" | "trend">("pie");
  useEffect(() => {
    if (!supportsTrend && chartType === "trend") setChartType("bars");
  }, [supportsTrend, chartType]);
  // One list for the control and for the width it needs: a third option
  // appearing only when a trend is available must not leave it sized for two.
  const chartModes = [
    { value: "pie" as const, label: tr.analysis.chartPie },
    { value: "bars" as const, label: tr.analysis.chartBars },
    ...(supportsTrend ? [{ value: "trend" as const, label: tr.analysis.chartTrend }] : []),
  ];
  const title = chartType === "pie" ? tr.analysis.chartExpenseDist : chartType === "trend" ? tr.analysis.chartNetTrendTitle : categoryFilter ? categoryName : tr.analysis.monthlyFlows;
  const hasSlices = distribution.slices.length > 0 || distribution.supplementalSlices.length > 0;
  return (
    <Card>
      {/* Wraps on its own box, not on the screen's width: beside the limits card
          a heading and a three-option control overflowed by 21px. */}
      <View
        style={{
          flexDirection: narrow ? "column" : "row",
          alignItems: narrow ? "stretch" : "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: spacing.md,
          marginBottom: spacing.md,
        }}
      >
        <Heading style={{ marginTop: 0, marginBottom: 0, flex: narrow ? undefined : 1 }}>{title}</Heading>
        {/* The control asks for what its labels need; the heading beside it yields the difference. */}
        <View style={narrow ? { width: "100%" } : { flexGrow: 1, flexBasis: segmentedMaxWidth(chartModes.length), minWidth: 240, maxWidth: segmentedMaxWidth(chartModes.length) }}>
          <Segmented noMargin options={chartModes} value={chartType} onChange={setChartType} />
        </View>
      </View>
      {chartType === "pie" ? (
        hasSlices
          ? <Donut slices={distribution.slices} supplementalSlices={distribution.supplementalSlices} totalMinor={distribution.totalMinor} size={narrow ? 168 : 220} />
          : <Body muted>{tr.analysis.noResults}</Body>
      ) : (
        <ChartFrame>
          {(chartWidth) => chartType === "bars"
            ? <Bars width={chartWidth} groups={bars.groups} series={bars.series} />
            : (
              <Lines
                width={chartWidth}
                height={220}
                xLabels={monthKeys.map(shortMonthLabel)}
                series={[{
                  label: tr.dashboard.netChange,
                  color: colors[0],
                  points: bars.groups.map((group) => (group.values[0] ?? 0) - (group.values[1] ?? 0) - (group.values[2] ?? 0)),
                }]}
              />
            )}
        </ChartFrame>
      )}
    </Card>
  );
}

function BudgetsCard({ budgets, endMonth, categoryById }: { budgets: ReturnType<typeof budgetProgress>; endMonth: MonthKey; categoryById: Map<string, Category> }) {
  const router = useRouter();
  // Budgets lives in the Settings tab, so opening it is a cross-tab push that
  // belongs at the root: what sits under it is this screen, where back returns.
  const openBudgets = () => router.push("/budgets");
  if (budgets.length === 0) {
    return (
      <Card rows>
        <ListRow icon={Target} title={tr.budgets.emptyAnalysisTitle} subtitle={tr.budgets.emptyAnalysisHint} chevron onPress={openBudgets} />
      </Card>
    );
  }
  return (
    /* `CardList` rather than bare rows in a `Card`: these are a list, and every
       other list in the app carries the rule between its rows. */
    <CardList
      items={budgets}
      keyExtractor={(budget) => budget.id}
      header={
        <Spread style={{ marginBottom: spacing.sm }}>
          <Heading style={{ marginTop: 0, marginBottom: 0, flexShrink: 1 }}>{tr.budgets.analysisTitle(monthName(endMonth))}</Heading>
          <Button label={tr.common.edit} size="sm" variant="ghost" onPress={openBudgets} />
        </Spread>
      }
      renderItem={(budget) => (
        <ListRow
          title={categoryById.get(budget.categoryId)?.name ?? tr.common.none}
          /* The badge reads the same figures as the line above it, so it belongs
             under them rather than diagonally away in the action corner. */
          subtitle={
            <View style={{ alignItems: "flex-start", gap: spacing.xs }}>
              <Body muted style={{ fontSize: type.small.fontSize }}>
                {tr.budgets.progress(formatMinorCompact(budget.spentMinor), formatMinorCompact(budget.amountMinor))}
              </Body>
              <Badge
                text={budget.remainingMinor < 0 ? tr.budgets.over(formatMinorCompact(-budget.remainingMinor)) : tr.budgets.remaining(formatMinorCompact(budget.remainingMinor))}
                tone={budget.remainingMinor < 0 ? "negative" : budget.ratio >= 0.8 ? "warning" : "positive"}
              />
            </View>
          }
        />
      )}
    />
  );
}

function CategoryTable({ rows, monthKeys, currentMonth, compact, selected, onSelect }: {
  rows: CategoryRow[];
  monthKeys: MonthKey[];
  currentMonth: MonthKey;
  compact: boolean;
  selected: string | null;
  onSelect: (categoryId: string | null) => void;
}) {
  const { palette } = useTheme();
  const maxAmountChars = useMemo(
    () => rows.reduce((longest, { data }) => {
      const values = [...monthKeys.map((month) => data.monthly.get(month) ?? 0), data.ytdMinor];
      return Math.max(longest, ...values.filter((value) => value !== 0).map((value) => formatMinorCompact(value).length));
    }, 0),
    [rows, monthKeys],
  );
  // The table already scrolls horizontally; size each numeric column for the
  // longest actual value so amounts remain on one line instead of wrapping.
  const cellWidth = Math.min(240, Math.max(compact ? 120 : 128, Math.ceil(maxAmountChars * 7.5) + spacing.lg * 2));
  const amountStyle = [type.amountSm, { textAlign: "right" as const, paddingHorizontal: spacing.md, fontSize: compact ? 12 : 13 }];
  if (rows.length === 0) return <EmptyState icon={Inbox} title={tr.cashflow.emptyMonth} />;
  return (
    // `maxHeight`, not `height`: this app never shortens a label, so a long
    // category name wraps and a computed height clipped it. A ceiling lets the
    // table be as tall as its content up to the same limit.
    <Card padded={false} style={{ maxHeight: Math.min(rows.length, 8) * ANALYSIS_ROW_HEIGHT + ANALYSIS_TABLE_CHROME }}>
      <StickyTable
        cornerLabel={tr.tx.category}
        headWidth={compact ? 112 : 148}
        cellWidth={cellWidth}
        currentColumnKey={currentMonth}
        // This month when the window holds it, otherwise the window's last: a
        // past year or custom range opened on January and had to be dragged.
        focusColumnKey={monthKeys.includes(currentMonth) ? currentMonth : monthKeys.at(-1)}
        columns={[...monthKeys.map((m) => ({ key: m, label: shortMonthLabel(m) })), { key: "__total", label: tr.common.total }]}
        rows={rows.map(({ category, data }) => ({
          key: category.id,
          label: category.name,
          onLabelPress: () => onSelect(selected === category.id ? null : category.id),
          rowHighlight: selected === category.id,
          cells: [
            ...monthKeys.map((m) => {
              const v = data.monthly.get(m) ?? 0;
              return <Amount key={m} minor={v} colorized={false} color={v === 0 ? palette.textSecondary : palette.text} style={[...amountStyle, { fontVariant: ["tabular-nums"] }]} />;
            }),
            <Amount key="__total" minor={data.ytdMinor} colorized={false} color={palette.text} style={amountStyle} />,
          ],
        }))}
      />
    </Card>
  );
}

/** One month is one point: there is no shape to read, so a trend needs two. */
function CategoryTrend({ row, monthKeys }: { row: CategoryRow | null | undefined; monthKeys: MonthKey[] }) {
  const colors = useSeriesColors();
  const [first, last] = [monthKeys[0], monthKeys.at(-1)];
  if (!row || !first || !last || monthKeys.length < 2) return null;
  return (
    <Card>
      <Heading style={{ marginTop: 0 }}>{tr.analysis.trendOf(row.category.name, monthKeys.length)}</Heading>
      <ChartFrame>
        {(chartWidth) => (
          <Lines
            width={chartWidth}
            xLabels={monthKeys.map(shortMonthLabel)}
            series={[{ label: row.category.name, color: colors[0], points: monthlySeries(row.data, first, last).map((p) => p.amountMinor) }]}
          />
        )}
      </ChartFrame>
    </Card>
  );
}

export default function AnalysisScreen() {
  const today = todayISO();
  const contentWidth = useContentWidth();
  const compact = !shouldUseWideWorkspace(contentWidth);
  const stackedFilters = !shouldPairFilterCards(contentWidth);
  const narrow = shouldUseNarrowAnalytics(contentWidth);
  const range = useAnalysisWindow(narrow, today);
  const { startMonth, endMonth, monthKeys } = range;
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const categoriesState = useCategoriesState();
  const personsState = usePersonsState();
  const sourcesState = useSourcesState();
  const budgetsState = useCategoryBudgetsState();
  const transactionsState = useAllTransactionsState();
  const categories = categoriesState.data;
  const allTx = transactionsState.data;
  const { palette } = useTheme();
  const colors = useSeriesColors();
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([categoriesState, personsState, sourcesState, budgetsState, transactionsState]);

  // These walk the whole transaction list, and used to do it on every render —
  // every keystroke in the search box, every filter chip and every layout
  // measurement. Derived from the data, not the render.
  const txLike = useTxLike();
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  // The analysis matrix is an all-flow view: transfer/investment categories
  // stay visibly separate from expense totals, but must not disappear from the
  // user's category-by-month history.
  const matrix = useMemo(() => categoryRangeMatrix(txLike, startMonth, endMonth, today, { includeTransfers: true }), [txLike, startMonth, endMonth, today]);
  const rows = useMemo(
    () => categories
      .flatMap((category) => {
        const data = matrix.get(category.id);
        return data && data.ytdMinor !== 0 ? [{ category, data }] : [];
      })
      .filter((r) => categoryFilter == null || r.category.id === categoryFilter),
    [categories, matrix, categoryFilter],
  );
  const search = useTransactionSearch({ transactions: allTx, categoryById, sources: sourcesState.data, categoryFilter, startMonth, endMonth });
  // "Tüm zamanlar" takes the window out of the question, so the controls that
  // set it stop accepting input rather than sitting there implying otherwise.
  const allTime = search.searchScope === "all";
  const categoryName = (categoryId: string | null) => (categoryId ? categoryById.get(categoryId)?.name ?? "" : "");

  const periodDistribution = useMemo(() => distributionForRange(txLike, firstDayOf(startMonth), lastDayOf(endMonth), today), [txLike, startMonth, endMonth, today]);
  const donut = distributionDonutData(periodDistribution, colors, (id) => categoryById.get(id)?.name ?? tr.common.none);
  // One full scan of the ledger per month in the window — up to thirteen of
  // them, and every one of them ran again for a keystroke the chart cannot see.
  const barGroups = useMemo(
    () => monthKeys.map((m) => {
      const label = shortMonthLabel(m);
      if (categoryFilter) return { label, values: [matrix.get(categoryFilter)?.monthly.get(m) ?? 0] };
      const distribution = distributionForRange(txLike, firstDayOf(m), lastDayOf(m), today);
      return { label, values: [distribution.incomeTotalMinor, distribution.expenseTotalMinor, distribution.transferTotalMinor] };
    }),
    [monthKeys, categoryFilter, matrix, txLike, today],
  );
  const barSeries = categoryFilter
    ? [{ label: categoryName(categoryFilter) || tr.tx.category, color: colors[0] }]
    : [
        { label: tr.cashflow.income, color: palette.positive },
        { label: tr.cashflow.expense, color: palette.negative },
        { label: tr.cashflow.transfer, color: palette.secondary },
      ];
  const activeBudgetRows = useMemo(
    () => budgetProgress(budgetsState.data, txLike, endMonth, today).filter((budget) => categoryById.has(budget.categoryId)),
    [budgetsState.data, txLike, endMonth, today, categoryById],
  );

  const chooseCategory = (categoryId: string | null) => {
    setCategoryFilter(categoryId);
    setSelected(null);
  };
  const clearSearch = () => {
    search.setQuery("");
    search.setTransactionType(null);
    chooseCategory(null);
    search.setSourceFilter(null);
    search.setSearchScope("period");
  };

  if (!dataReady) {
    // Same `Screen`, same width, same scroll mode as the ready state: differing
    // in all three, the page re-mounted with its heading when data landed.
    return <DataGateScreen status={dataStatus} retry={retryData} scroll={false} width="workspace" />;
  }

  const paired = stackedFilters ? undefined : { flex: 1 };
  const header = (
    <View>
      <DataStateNotice status={dataStatus} retry={retryData} />
      <View style={{ flexDirection: stackedFilters ? "column" : "row", alignItems: "stretch", gap: stackedFilters ? 0 : spacing.lg }}>
        <WindowCard
          range={range}
          // Year navigation is bounded to where data exists (mirrors Mali Tablo).
          minYear={allTx[0] ? yearOf(allTx[0].effectiveDate) : range.currentYear}
          categories={categories}
          categoryFilter={categoryFilter}
          onCategoryFilter={chooseCategory}
          allTime={allTime}
          style={paired}
        />
        <SearchCard search={search} sources={sourcesState.data} compact={compact} periodLabel={`${monthLabel(startMonth)} – ${monthLabel(endMonth)}`} onClear={clearSearch} style={paired} />
      </View>
      <MetricStrip
        style={{ marginBottom: spacing.lg }}
        // A year of a real ledger can reach the compact scale; the Amount
        // primitive owns the fit ladder, so each total keeps its own line.
        items={[
          { label: tr.cashflow.income, minor: periodDistribution.incomeTotalMinor, color: palette.positiveText },
          { label: tr.cashflow.expense, minor: -periodDistribution.expenseTotalMinor, color: palette.negativeText },
          { label: tr.cashflow.transfer, minor: -periodDistribution.transferTotalMinor, color: palette.secondaryText },
        ]}
      />
    </View>
  );

  const footer = (
    <View>
      {/* Between the results and everything below, so "show all" reads as
          belonging to the list it grows. */}
      {search.active && search.sorted.length > RESULT_PREVIEW_COUNT ? (
        <View style={{ alignItems: "center", marginTop: spacing.sm, marginBottom: spacing.md }}>
          <Button
            size="sm"
            variant="ghost"
            label={search.showAllResults ? tr.analysis.showFewerResults : tr.analysis.showAllResults(search.sorted.length)}
            onPress={() => search.setShowAllResults(!search.showAllResults)}
          />
        </View>
      ) : null}
      {/* The distribution gets the full width and the limits sit under it: a
          ring, a legend and a trend line are read by comparing shapes. */}
      {rows.length > 0 || donut.slices.length > 0 || donut.supplementalSlices.length > 0 ? (
        <DistributionCard
          narrow={narrow}
          supportsTrend={shouldOfferTrendChart(contentWidth) && monthKeys.length >= 2 && !categoryFilter}
          monthKeys={monthKeys}
          categoryFilter={categoryFilter}
          categoryName={categoryName(categoryFilter)}
          distribution={donut}
          bars={{ groups: barGroups, series: barSeries }}
        />
      ) : null}
      {/* Beside the chart rather than inside it: these rows hold an imported
          column equal to its file and are not spending, so the charts leave them out and say so here. */}
      {periodDistribution.workbookRemainderMinor !== 0 ? (
        <Card testID="analysis-workbook-remainder">
          <PanelHeader icon={FileSpreadsheet} title={tr.analysis.remainderTitle} description={tr.analysis.remainderHint} right={<Amount minor={periodDistribution.workbookRemainderMinor} />} />
        </Card>
      ) : null}
      <BudgetsCard budgets={activeBudgetRows} endMonth={endMonth} categoryById={categoryById} />
      <CategoryTable rows={rows} monthKeys={monthKeys} currentMonth={range.currentMonth} compact={compact} selected={selected} onSelect={setSelected} />
      <CategoryTrend row={(selected ? rows.find((r) => r.category.id === selected) : null) ?? (categoryFilter ? rows[0] : null)} monthKeys={monthKeys} />
    </View>
  );

  return (
    <Screen scroll={false} width="workspace">
      <FlatList
        data={search.active ? search.visible : []}
        keyExtractor={(t: TxRow) => t.id}
        renderItem={({ item, index }) => (
          <ResultRow
            transaction={item}
            first={index === 0}
            last={index === search.visible.length - 1}
            categoryById={categoryById}
            sourceName={item.paymentSourceId ? search.sourceNameById.get(item.paymentSourceId) : undefined}
          />
        )}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        renderScrollComponent={renderKeyboardSafeListScroll}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustContentInsets={false}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}
