/** Analysis: category × month matrix over a selectable window (3/6/12 months
 *  or a calendar year), a category filter, per-category cumulative trend and
 *  transaction search. */

import React, { useDeferredValue, useEffect, useState } from "react";
import { FlatList, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, Inbox, SlidersHorizontal, Target } from "lucide-react-native";
import { categoryRangeMatrix, distributionForRange, monthlySeries } from "../../../domain/analytics";
import { addMonthsToKey, firstDayOf, lastDayOf, makeMonthKey, monthKeyOf, monthRange, todayISO, yearOf, type MonthKey } from "../../../domain/dates";
import { formatMinorCompact } from "../../../domain/money";
import { signedBalanceEffectOf } from "../../../domain/transactions";
import { filterTransactions, sortTransactions, type TransactionSortMode } from "../../../domain/transaction-search";
import { budgetProgress } from "../../../domain/budgets";
import { transactionDateText } from "../../../ui/transaction-date";
import { monthLabel, monthName, shortMonthLabel, tr } from "../../../i18n/tr";
import {
  toTxLike,
  useAllTransactionsState,
  useCategoryBudgetsState,
  useCategoriesState,
  usePersonsState,
  useSourcesState,
} from "../../../data/hooks";
import { combineLiveQueryStatus } from "../../../data/live-state";
import { categoryIcon, paymentSourceIcon } from "../../../data/category-icons";
import { Amount, Badge, Body, Button, Card, CardList, DataStateNotice, Divider, EmptyState, Field, Heading, IconButton, ListRow, MetricStrip, Row, Screen, SectionHeader, Segmented, Select, Spread } from "../../../ui/components";
import { Bars, Donut, Lines, distributionDonutData, useSeriesColors } from "../../../ui/charts";
import { StickyTable } from "../../../ui/sticky-table";
import { shouldUseNarrowAnalytics, shouldUseWideWorkspace } from "../../../ui/responsive";
import { radius, spacing, type, useTheme } from "../../../ui/theme";

type Period = "1m" | "3m" | "6m" | "12m" | "year" | "custom";

/** Results shown before the user asks for the rest. */
const RESULT_PREVIEW_COUNT = 5;

export default function AnalysisScreen() {
  const today = todayISO();
  const currentYear = yearOf(today);
  const currentMonth = monthKeyOf(today);
  const { width } = useWindowDimensions();
  const compact = !shouldUseWideWorkspace(width);
  const narrow = shouldUseNarrowAnalytics(width);
  // Phone starts with a useful comparison that fits the table in fewer
  // horizontal gestures; year and custom windows remain explicit choices.
  const [period, setPeriod] = useState<Period>(narrow ? "3m" : "year");
  const [year, setYear] = useState(currentYear);
  // A custom window is two months the user names outright. Seeded to the last
  // six so switching to it shows a real range instead of an empty one.
  const [customStart, setCustomStart] = useState<MonthKey>(addMonthsToKey(currentMonth, -5));
  const [customEnd, setCustomEnd] = useState<MonthKey>(currentMonth);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [chartType, setChartType] = useState<"pie" | "bars" | "trend">("pie");
  const [query, setQuery] = useState("");
  const [transactionType, setTransactionType] = useState<"expense" | "income" | "transfer" | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [searchScope, setSearchScope] = useState<"period" | "all">("period");
  const [sortMode, setSortMode] = useState<TransactionSortMode>("recent");
  const [showAllResults, setShowAllResults] = useState(false);
  const [showSearchDetails, setShowSearchDetails] = useState(false);
  const categoriesState = useCategoriesState();
  const personsState = usePersonsState();
  const sourcesState = useSourcesState();
  const budgetsState = useCategoryBudgetsState();
  const transactionsState = useAllTransactionsState();
  const categories = categoriesState.data;
  const persons = personsState.data;
  const sources = sourcesState.data;
  const budgets = budgetsState.data;
  const allTx = transactionsState.data;
  const router = useRouter();
  const { palette } = useTheme();
  // Budgets lives in the Settings tab, so opening it from here is a cross-tab
  // push and belongs at the root: what sits under it is this screen, which is
  // where both the back button and the edge swipe then return. It used to be
  // an anchored push that relayed this screen's own origin so Budgets could
  // rebuild the URL it came from — a whole mechanism that existed only because
  // the anchor put the wrong screen underneath in the first place.
  const openBudgets = () => router.push("/budgets");
  const colors = useSeriesColors();
  const liveStates = [categoriesState, personsState, sourcesState, budgetsState, transactionsState];
  const dataStatus = combineLiveQueryStatus(liveStates);
  const dataReady = liveStates.every((state) => state.updatedAt != null);
  const retryData = () => {
    categoriesState.retry();
    personsState.retry();
    sourcesState.retry();
    budgetsState.retry();
    transactionsState.retry();
  };

  // Window: rolling N months ending now, or a calendar year (navigable).
  const [startMonth, endMonth] =
    period === "year"
      ? [makeMonthKey(year, 1), year === currentYear ? currentMonth : makeMonthKey(year, 12)]
      : period === "custom"
        // Ordered here rather than guarded at each stepper: whichever end the
        // user moves past the other, the window stays a window.
        ? [customStart <= customEnd ? customStart : customEnd, customStart <= customEnd ? customEnd : customStart]
        : [addMonthsToKey(currentMonth, -(Number(period.replace("m", "")) - 1)), currentMonth];
  const monthKeys = monthRange(startMonth, endMonth);
  const searchPeriodLabel = `${monthLabel(startMonth)} – ${monthLabel(endMonth)}`;

  const txLike = toTxLike(allTx, persons, categories);
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  // Legacy type/category mismatches are normalized by the shared domain flow,
  // so category details and aggregate charts use one financial rule.
  // The analysis matrix is an all-flow view: transfer/investment categories
  // stay visibly separate from expense totals, but must not disappear from the
  // user's category-by-month history.
  const matrix = categoryRangeMatrix(txLike, startMonth, endMonth, today, { includeTransfers: true });

  // Year navigation is bounded to where data exists (mirrors Mali Tablo) so the
  // back arrow can't wander into empty years forever.
  const minYear = allTx[0] ? yearOf(allTx[0].effectiveDate) : currentYear;
  // Newest first: a custom range is nearly always anchored near today.
  const monthOptions = monthRange(makeMonthKey(minYear, 1), currentMonth)
    .reverse()
    .map((month) => ({ value: month, label: monthLabel(month) }));

  const rows = categories
    .flatMap((category) => {
      const data = matrix.get(category.id);
      return data && data.ytdMinor !== 0 ? [{ category, data }] : [];
    })
    .filter((r) => categoryFilter == null || r.category.id === categoryFilter);

  const catName = (cid: string | null) => (cid ? categoryById.get(cid)?.name ?? "" : "");
  const deferredQuery = useDeferredValue(query);
  const q = deferredQuery.trim().toLocaleLowerCase("tr-TR");
  const sourceNameById = new Map(sources.map((source) => [source.id, source.name]));
  // Asking for all time is itself a request to see records, so it counts as a
  // filter. Without it, clearing the payment method back to "Tümü" emptied
  // the list even though the owner had just told the screen what to search.
  const searchActive =
    q.length > 0 || transactionType != null || categoryFilter != null || sourceFilter != null || searchScope === "all";
  const searchResults = searchActive
    ? filterTransactions(
        allTx.map((transaction) => {
          const mk = monthKeyOf(transaction.effectiveDate);
          return {
            ...transaction,
            searchText: [
              catName(transaction.categoryId),
              sourceNameById.get(transaction.paymentSourceId ?? "") ?? "",
              transaction.note ?? "",
              monthName(mk),
              String(yearOf(transaction.effectiveDate)),
              String(Math.round(transaction.amountTryMinor / 100)),
              (transaction.amountTryMinor / 100).toFixed(2).replace(".", ","),
            ].join(" "),
          };
        }),
        {
          query: deferredQuery,
          type: transactionType,
          categoryId: categoryFilter,
          paymentSourceId: sourceFilter,
          from: searchScope === "period" ? firstDayOf(startMonth) : null,
          to: searchScope === "period" ? lastDayOf(endMonth) : null,
        },
      )
    : [];
  // "Tüm zamanlar" takes the window out of the question, so the controls that
  // set it stop accepting input rather than sitting there implying otherwise.
  const allTimeSearch = searchScope === "all";
  const sortedResults = sortTransactions(searchResults, sortMode);
  // A period can match hundreds of rows, and a wall of them answers no question.
  // Five is what fits under the filters without scrolling; the rest are one tap
  // away and the sort decides which five those are.
  const visibleResults = showAllResults ? sortedResults : sortedResults.slice(0, RESULT_PREVIEW_COUNT);

  const trendRow = (selected ? rows.find((r) => r.category.id === selected) : null) ?? (categoryFilter ? rows[0] : null);
  const trendStartMonth = monthKeys[0];
  const trendEndMonth = monthKeys.at(-1);

  const periodDistribution = distributionForRange(txLike, firstDayOf(startMonth), lastDayOf(endMonth), today);
  const supportsTrend = width >= 720 && monthKeys.length >= 2 && !categoryFilter;
  useEffect(() => {
    if (!supportsTrend && chartType === "trend") setChartType("bars");
  }, [supportsTrend, chartType]);
  const {
    slices: pieSlices,
    supplementalSlices: pieSupplemental,
    totalMinor: pieTotalMinor,
  } = distributionDonutData(periodDistribution, colors, (id) => categoryById.get(id)?.name ?? tr.common.none);
  const barGroups = monthKeys.map((m) => {
    const label = shortMonthLabel(m);
    if (categoryFilter) return { label, values: [matrix.get(categoryFilter)?.monthly.get(m) ?? 0] };
    const distribution = distributionForRange(txLike, firstDayOf(m), lastDayOf(m), today);
    return { label, values: [distribution.incomeTotalMinor, distribution.expenseTotalMinor, distribution.transferTotalMinor] };
  });
  const barSeries = categoryFilter
    ? [{ label: catName(categoryFilter) || tr.tx.category, color: colors[0] }]
    : [
        { label: tr.cashflow.income, color: palette.positive },
        { label: tr.cashflow.expense, color: palette.negative },
        { label: tr.cashflow.transfer, color: palette.secondary },
      ];
  const netTrendPoints = barGroups.map((group) =>
    (group.values[0] ?? 0) - (group.values[1] ?? 0) - (group.values[2] ?? 0),
  );
  const maxAmountChars = rows.reduce((longest, { data }) => {
    const values = [...monthKeys.map((month) => data.monthly.get(month) ?? 0), data.ytdMinor];
    return Math.max(longest, ...values.filter((value) => value !== 0).map((value) => formatMinorCompact(value).length));
  }, 0);
  // The table already scrolls horizontally; size each numeric column for the
  // longest actual value so amounts remain on one line instead of wrapping.
  const analysisCellWidth = Math.min(240, Math.max(compact ? 120 : 128, Math.ceil(maxAmountChars * 7.5) + spacing.lg * 2));
  const activeBudgetRows = budgetProgress(budgets, txLike, endMonth, today)
    .filter((budget) => categoryById.has(budget.categoryId));

  // Everything above the virtualized result list (period/filters/search box).
  const searchHeader = (
    <View>
      <DataStateNotice status={dataStatus} retry={retryData} />
      <View style={{ flexDirection: compact ? "column" : "row", alignItems: "stretch", gap: compact ? 0 : spacing.lg }}>
      <Card style={compact ? undefined : { flex: 1 }}>
      <SectionHeader>{tr.analysis.viewWindow}</SectionHeader>
      {/* The slicer owns its own row. It used to share one with the year
          switcher, which was affordable at four segments and is not at six —
          the switcher took a third of the width and left "12 Ay" wrapping.
          Whatever the chosen period needs sits under it instead. */}
      <Segmented
        disabled={allTimeSearch}
        options={[
          { value: "1m", label: tr.analysis.period1m },
          { value: "3m", label: tr.analysis.period3m },
          { value: "6m", label: tr.analysis.period6m },
          { value: "12m", label: tr.analysis.period12m },
          { value: "year", label: tr.analysis.periodYear },
          { value: "custom", label: tr.analysis.periodCustom },
        ]}
        value={period}
        onChange={setPeriod}
      />
      {period === "year" ? (
        <Spread style={{ marginBottom: spacing.md }}>
          <IconButton icon={ChevronLeft} label={String(year - 1)} onPress={() => setYear(year - 1)} disabled={allTimeSearch || year <= minYear} />
          <Text style={[type.heading, { color: palette.text, minWidth: 48, textAlign: "center" }]}>{year}</Text>
          <IconButton icon={ChevronRight} label={String(year + 1)} onPress={() => setYear(year + 1)} disabled={allTimeSearch || year >= currentYear} />
        </Spread>
      ) : null}
      {period === "custom" ? (
        /* Two month lists side by side, not two steppers stacked. A stepper
           asks for one tap per month, so reaching last March from July is six
           of them twice over, and stacked they cost two thirds of the screen
           before any data shows. The lists start at the newest month because
           that is where a range usually begins. */
        <Row style={{ alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <Select
              label={tr.analysis.customStart}
              options={monthOptions}
              value={customStart}
              onChange={setCustomStart}
              disabled={allTimeSearch}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Select
              label={tr.analysis.customEnd}
              options={monthOptions}
              value={customEnd}
              onChange={setCustomEnd}
              disabled={allTimeSearch}
            />
          </View>
        </Row>
      ) : null}

      <Select
        label={tr.tx.category}
        options={[{ value: "", label: tr.analysis.allCategories }, ...categories.map((c) => ({ value: c.id, label: c.name, icon: categoryIcon(c) }))]}
        value={categoryFilter ?? ""}
        onChange={(v) => {
          setCategoryFilter(v === "" ? null : v);
          setSelected(null);
        }}
      />
      </Card>

      <Card style={compact ? undefined : { flex: 1 }}>
      <SectionHeader>{tr.analysis.findTransaction}</SectionHeader>
      <Field accessibilityLabel={tr.common.search} placeholder={tr.analysis.searchPlaceholder} value={query} onChangeText={setQuery} autoCapitalize="none" />
      <Segmented
        options={[
          { value: "all", label: tr.common.all },
          { value: "expense", label: tr.cashflow.expense },
          { value: "income", label: tr.cashflow.income },
          { value: "transfer", label: tr.cashflow.transfer },
        ]}
        value={transactionType ?? "all"}
        onChange={(value) => setTransactionType(value === "all" ? null : value)}
      />
      {compact ? (
        <View style={{ alignItems: "flex-start", marginBottom: showSearchDetails ? spacing.md : 0 }}>
          <Button
            icon={SlidersHorizontal}
            size="sm"
            variant="ghost"
            label={showSearchDetails ? tr.analysis.hideSearchFilters : tr.analysis.showSearchFilters}
            expanded={showSearchDetails}
            onPress={() => setShowSearchDetails(!showSearchDetails)}
          />
        </View>
      ) : null}
      {/* Both fields keep one line: the selected range used to be spelled out
          inside this control's own trigger, which wrapped to three lines in a
          half-width column and left it taller than the field beside it. The
          range is the same for the whole search, so it belongs in the hint
          below rather than inside a collapsed dropdown. */}
      {!compact || showSearchDetails ? (
      <>
      <Row style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Select
            label={tr.analysis.searchSource}
            options={[{ value: "", label: tr.common.all }, ...sources.map((source) => ({ value: source.id, label: source.name, icon: paymentSourceIcon(source.type) }))]}
            value={sourceFilter ?? ""}
            onChange={(value) => setSourceFilter(value || null)}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Select
            label={tr.analysis.searchPeriod}
            options={[
              { value: "period", label: tr.analysis.selectedPeriod },
              { value: "all", label: tr.analysis.allTime },
            ]}
            value={searchScope}
            onChange={setSearchScope}
          />
        </View>
      </Row>
      <Body muted style={{ marginTop: -spacing.sm, marginBottom: spacing.md, fontSize: 12 }}>
        {searchScope === "period" ? tr.analysis.selectedPeriodRange(searchPeriodLabel) : tr.analysis.allTimeHint}
      </Body>
      </>
      ) : null}
      {searchActive && sortedResults.length > 1 ? (
        <Select
          label={tr.analysis.sortLabel}
          options={[
            { value: "recent", label: tr.analysis.sortRecent },
            { value: "oldest", label: tr.analysis.sortOldest },
            { value: "highest", label: tr.analysis.sortHighest },
            { value: "lowest", label: tr.analysis.sortLowest },
          ]}
          value={sortMode}
          onChange={setSortMode}
        />
      ) : null}
      {searchActive && searchResults.length === 0 ? (
          <View style={{ gap: spacing.sm, paddingTop: spacing.sm }}>
            <Body muted>{tr.analysis.noResults}</Body>
            {searchScope === "period" ? (
              <Button
                label={tr.analysis.searchAllTime}
                variant="ghost"
                size="sm"
                onPress={() => {
                  setSearchScope("all");
                  setShowSearchDetails(true);
                }}
              />
            ) : null}
            <Button
              label={tr.analysis.clearSearch}
              variant="ghost"
              size="sm"
              onPress={() => {
                setQuery("");
                setTransactionType(null);
                setCategoryFilter(null);
                setSelected(null);
                setSourceFilter(null);
                setSearchScope("period");
              }}
            />
          </View>
      ) : null}
      </Card>
      </View>
      <MetricStrip
        style={{ marginBottom: spacing.lg }}
        items={[
          { label: tr.cashflow.income, value: <Amount minor={periodDistribution.incomeTotalMinor} colorized={false} color={palette.positiveText} style={{ textAlign: "left" }} /> },
          { label: tr.cashflow.expense, value: <Amount minor={-periodDistribution.expenseTotalMinor} colorized={false} color={palette.negativeText} style={{ textAlign: "left" }} /> },
          { label: tr.cashflow.transfer, value: <Amount minor={-periodDistribution.transferTotalMinor} colorized={false} color={palette.secondaryText} style={{ textAlign: "left" }} /> },
        ]}
      />
    </View>
  );

  // A broad filter can match every transaction, so results render inside the
  // screen's FlatList (real virtualization) with the card look split across
  // the first/last rows instead of a wrapping Card that mounts everything.
  const renderResult = ({ item: t, index }: { item: (typeof visibleResults)[number]; index: number }) => (
    <View
      style={[
        { backgroundColor: palette.surface, paddingHorizontal: spacing.lg },
        index === 0 && { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.sm },
        index === visibleResults.length - 1 && {
          borderBottomLeftRadius: radius.lg,
          borderBottomRightRadius: radius.lg,
          paddingBottom: spacing.sm,
          marginBottom: spacing.md,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityHint={tr.analysis.openTransaction}
        onPress={() => router.push({ pathname: "/transaction", params: { id: t.id } })}
      >
        <Spread style={{ paddingVertical: spacing.xs }}>
          <View style={{ flex: 1, paddingRight: spacing.sm }}>
            <Body>{catName(t.categoryId) || tr.common.none}</Body>
            <Body muted style={{ fontSize: 12 }}>
              {transactionDateText(t)}
              {t.paymentSourceId && sourceNameById.get(t.paymentSourceId) ? ` · ${sourceNameById.get(t.paymentSourceId)}` : ""}
              {t.note ? ` · ${t.note}` : ""}
            </Body>
            {t.amountTryMinor < 0 ? (
              <View style={{ marginTop: spacing.xs, alignItems: "flex-start" }}>
                <Badge text={tr.tx.reversalLabel(t.type)} tone={t.type === "income" ? "negative" : "positive"} />
              </View>
            ) : null}
          </View>
          <Amount
            minor={signedBalanceEffectOf(
              t.type,
              t.amountTryMinor,
              t.categoryId ? categoryById.get(t.categoryId)?.kind ?? null : null,
            )}
          />
        </Spread>
      </Pressable>
      {index < visibleResults.length - 1 ? <Divider /> : null}
    </View>
  );

  const analysisFooter = (
    <View>
      {/* Sits between the results and everything below them, so "show all"
          reads as belonging to the list it grows rather than to the cards
          after it. */}
      {searchActive && sortedResults.length > RESULT_PREVIEW_COUNT ? (
        <View style={{ alignItems: "center", marginTop: spacing.sm, marginBottom: spacing.md }}>
          <Button
            size="sm"
            variant="ghost"
            label={showAllResults ? tr.analysis.showFewerResults : tr.analysis.showAllResults(sortedResults.length)}
            onPress={() => setShowAllResults(!showAllResults)}
          />
        </View>
      ) : null}
      {activeBudgetRows.length === 0 ? (
        <Card>
          <ListRow
            icon={Target}
            title={tr.budgets.emptyAnalysisTitle}
            subtitle={tr.budgets.emptyAnalysisHint}
            chevron
            onPress={openBudgets}
          />
        </Card>
      ) : (
        /* `CardList` rather than bare rows in a `Card`: these are a list, and
           every other list in the app carries the rule between its rows. The
           heading is the list's own header, so its spacing comes from the same
           place as the rows' instead of a margin picked here. */
        <CardList
          items={activeBudgetRows}
          keyExtractor={(budget) => budget.id}
          header={
            <Spread style={{ marginBottom: spacing.sm }}>
              <Heading style={{ marginTop: 0, marginBottom: 0, flexShrink: 1 }}>
                {tr.budgets.analysisTitle(monthName(endMonth))}
              </Heading>
              <Button label={tr.common.edit} size="sm" variant="ghost" onPress={openBudgets} />
            </Spread>
          }
          renderItem={(budget) => (
            <ListRow
              title={categoryById.get(budget.categoryId)?.name ?? tr.common.none}
              /* The badge reads the same figures as the line above it, so it
                 belongs under them rather than in the row's action corner —
                 stacked on the right it sat diagonally away from the numbers
                 it qualifies. */
              subtitle={
                <View style={{ alignItems: "flex-start", gap: spacing.xs }}>
                  <Body muted style={{ fontSize: 12 }}>
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
      )}

      {rows.length > 0 || pieSlices.length > 0 || pieSupplemental.length > 0 ? (
        <Card>
          <View
            style={{
              flexDirection: narrow ? "column" : "row",
              alignItems: narrow ? "stretch" : "center",
              justifyContent: "space-between",
              gap: spacing.md,
              marginBottom: spacing.md,
            }}
          >
            <Heading style={{ marginTop: 0, marginBottom: 0, flex: narrow ? undefined : 1 }}>
              {chartType === "pie"
                ? tr.analysis.chartExpenseDist
                : chartType === "trend"
                  ? tr.analysis.chartNetTrendTitle
                  : categoryFilter ? catName(categoryFilter) : tr.analysis.monthlyFlows}
            </Heading>
            <View style={{ width: narrow ? "100%" : 168 }}>
              <Segmented
                noMargin
                options={[
                  { value: "pie", label: tr.analysis.chartPie },
                  { value: "bars", label: tr.analysis.chartBars },
                  ...(supportsTrend ? [{ value: "trend" as const, label: tr.analysis.chartTrend }] : []),
                ]}
                value={chartType}
                onChange={setChartType}
              />
            </View>
          </View>
          {chartType === "pie" ? (
            pieSlices.length > 0 || pieSupplemental.length > 0 ? (
              <Donut
                slices={pieSlices}
                supplementalSlices={pieSupplemental}
                totalMinor={pieTotalMinor}
                size={narrow ? 168 : 220}
              />
            ) : (
              <Body muted>{tr.analysis.noResults}</Body>
            )
          ) : chartType === "bars" ? (
            <Bars width={Math.min(width - spacing.lg * 4, 1040)} groups={barGroups} series={barSeries} />
          ) : (
            <Lines
              width={Math.min(width - spacing.lg * 4, 1040)}
              height={220}
              xLabels={monthKeys.map(shortMonthLabel)}
              series={[{
                label: tr.dashboard.netChange,
                color: colors[0],
                points: netTrendPoints,
              }]}
            />
          )}
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState icon={Inbox} title={tr.cashflow.emptyMonth} />
      ) : (
        <Card padded={false} style={{ height: Math.min(rows.length, 8) * 52 + 60 }}>
          <StickyTable
            cornerLabel={tr.tx.category}
            headWidth={compact ? 112 : 148}
            cellWidth={analysisCellWidth}
            currentColumnKey={currentMonth}
            focusColumnKey={currentMonth}
            columns={[...monthKeys.map((m) => ({ key: m, label: shortMonthLabel(m) })), { key: "__total", label: tr.common.total }]}
            rows={rows.map(({ category, data }) => ({
              key: category.id,
              label: `${categoryIcon(category)} ${category.name}`,
              onLabelPress: () => setSelected(selected === category.id ? null : category.id),
              rowHighlight: selected === category.id,
              cells: [
                ...monthKeys.map((m) => {
                  const v = data.monthly.get(m) ?? 0;
                  return (
                    <Text
                      key={m}
                      style={[type.amountSm, { textAlign: "right", paddingHorizontal: spacing.md, fontSize: compact ? 12 : 13, fontVariant: ["tabular-nums"], color: v === 0 ? palette.textSecondary : palette.text }]}
                    >
                      {v === 0 ? "" : formatMinorCompact(v)}
                    </Text>
                  );
                }),
                <Text key="__total" style={[type.amountSm, { textAlign: "right", paddingHorizontal: spacing.md, fontSize: compact ? 12 : 13, color: palette.text }]}>
                  {formatMinorCompact(data.ytdMinor)}
                </Text>,
              ],
            }))}
          />
        </Card>
      )}

      {/* One month is one point: there is no shape to read and nothing to
          compare it against, so the chart earns no space. */}
      {trendRow && trendStartMonth && trendEndMonth && monthKeys.length > 1 ? (
        <Card>
          <Heading style={{ marginTop: 0 }}>{tr.analysis.trendOf(trendRow.category.name, monthKeys.length)}</Heading>
          <Lines
            width={Math.min(width - spacing.lg * 4, 1040)}
            xLabels={monthKeys.map(shortMonthLabel)}
            series={[
              {
                label: trendRow.category.name,
                color: colors[0],
                points: monthlySeries(trendRow.data, trendStartMonth, trendEndMonth).map(
                  (p) => p.amountMinor,
                ),
              },
            ]}
          />
        </Card>
      ) : null}
    </View>
  );

  if (!dataReady) {
    return (
      <Screen width="wide">
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} width="wide">
      <FlatList
        data={searchActive ? visibleResults : []}
        keyExtractor={(t: (typeof visibleResults)[number]) => t.id}
        renderItem={renderResult}
        ListHeaderComponent={searchHeader}
        ListFooterComponent={analysisFooter}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustContentInsets={false}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}
