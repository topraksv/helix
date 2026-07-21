/** Analysis: category × month matrix over a selectable window (3/6/12 months
 *  or a calendar year), a category filter, per-category cumulative trend and
 *  transaction search. */

import React, { useDeferredValue, useState } from "react";
import { FlatList, Pressable, Text, useWindowDimensions, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { ChevronLeft, ChevronRight, Inbox, Target } from "lucide-react-native";
import { categoryRangeMatrix, cumulativeSeries, distributionForRange } from "../../../domain/analytics";
import { addMonthsToKey, firstDayOf, lastDayOf, makeMonthKey, monthKeyOf, monthRange, todayISO, yearOf } from "../../../domain/dates";
import { formatMinorCompact } from "../../../domain/money";
import { signedBalanceEffectOf } from "../../../domain/transactions";
import { filterTransactions } from "../../../domain/transaction-search";
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
import { categoryIcon } from "../../../data/category-icons";
import { Amount, Badge, Body, Button, Card, DataStateNotice, Divider, EmptyState, Field, Heading, IconButton, ListRow, Row, Screen, Segmented, Select, Spread } from "../../../ui/components";
import { Bars, Donut, Lines, distributionDonutData, useSeriesColors } from "../../../ui/charts";
import { StickyTable } from "../../../ui/sticky-table";
import { HeaderBackButton } from "../../../ui/header-back";
import { resolveBackTarget } from "../../../ui/navigation";
import { radius, spacing, type, useTheme } from "../../../ui/theme";

type Period = "3m" | "6m" | "12m" | "year";

export default function AnalysisScreen() {
  const today = todayISO();
  const currentYear = yearOf(today);
  const currentMonth = monthKeyOf(today);
  const [period, setPeriod] = useState<Period>("year");
  const [year, setYear] = useState(currentYear);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [chartType, setChartType] = useState<"pie" | "bars">("pie");
  const [query, setQuery] = useState("");
  const [transactionType, setTransactionType] = useState<"expense" | "income" | "transfer" | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [searchScope, setSearchScope] = useState<"period" | "all">("period");
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
  // Analysis is reachable from the Financial Table (same stack) and from
  // Summary (another tab). Only the pusher knows which, so it says so.
  const { from } = useLocalSearchParams<{ from?: string }>();
  const back = resolveBackTarget<Href>(from, { summary: "/(tabs)" }, "/(tabs)/cash-flow");
  const colors = useSeriesColors();
  const { width } = useWindowDimensions();
  const compact = width < 900;
  const narrow = width < 520;
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
  const searchActive = q.length > 0 || transactionType != null || categoryFilter != null || sourceFilter != null;
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

  const trendRow = (selected ? rows.find((r) => r.category.id === selected) : null) ?? (categoryFilter ? rows[0] : null);
  const trendStartMonth = monthKeys[0];
  const trendEndMonth = monthKeys.at(-1);

  const periodDistribution = distributionForRange(txLike, firstDayOf(startMonth), lastDayOf(endMonth), today);
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
        { label: tr.cashflow.income, color: colors[1] },
        { label: tr.cashflow.expense, color: colors[5] },
        { label: tr.cashflow.transfer, color: colors[4] },
      ];
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
      {/* Period slicer + (year mode) year switcher — one aligned axis */}
      <Spread style={{ marginBottom: spacing.md, gap: spacing.md }}>
        <View style={{ flex: 1, maxWidth: 380 }}>
          <Segmented
            noMargin
            options={[
              { value: "3m", label: tr.analysis.period3m },
              { value: "6m", label: tr.analysis.period6m },
              { value: "12m", label: tr.analysis.period12m },
              { value: "year", label: tr.analysis.periodYear },
            ]}
            value={period}
            onChange={setPeriod}
          />
        </View>
        {period === "year" ? (
          <Row gap={spacing.sm}>
            <IconButton icon={ChevronLeft} label={String(year - 1)} onPress={() => setYear(year - 1)} disabled={year <= minYear} />
            <Text style={[type.heading, { color: palette.text, minWidth: 48, textAlign: "center" }]}>{year}</Text>
            <IconButton icon={ChevronRight} label={String(year + 1)} onPress={() => setYear(year + 1)} disabled={year >= currentYear} />
          </Row>
        ) : null}
      </Spread>

      <Select
        label={tr.tx.category}
        options={[{ value: "", label: tr.analysis.allCategories }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
        value={categoryFilter ?? ""}
        onChange={(v) => {
          setCategoryFilter(v === "" ? null : v);
          setSelected(null);
        }}
      />

      <Heading>{tr.analysis.findTransaction}</Heading>
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
      <Row style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Select
            label={tr.analysis.searchSource}
            options={[{ value: "", label: tr.common.all }, ...sources.map((source) => ({ value: source.id, label: source.name }))]}
            value={sourceFilter ?? ""}
            onChange={(value) => {
              const next = value || null;
              setSourceFilter(next);
              if (!next) setSearchScope("period");
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Select
            label={tr.analysis.searchPeriod}
            options={[
              {
                value: "period",
                label: sourceFilter == null
                  ? tr.analysis.searchPeriodDisabled
                  : tr.analysis.selectedPeriod(searchPeriodLabel),
              },
              { value: "all", label: tr.analysis.allTime },
            ]}
            value={searchScope}
            onChange={setSearchScope}
            disabled={sourceFilter == null}
          />
        </View>
      </Row>
      {sourceFilter == null ? (
        <Body muted style={{ marginTop: -spacing.sm, marginBottom: spacing.md, fontSize: 12 }}>
          {tr.analysis.searchPeriodRequiresSource}
        </Body>
      ) : null}
      {searchActive && searchResults.length === 0 ? (
        <Card>
          <View style={{ gap: spacing.sm }}>
            <Body muted>{tr.analysis.noResults}</Body>
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
        </Card>
      ) : null}
    </View>
  );

  // A broad filter can match every transaction, so results render inside the
  // screen's FlatList (real virtualization) with the card look split across
  // the first/last rows instead of a wrapping Card that mounts everything.
  const renderResult = ({ item: t, index }: { item: (typeof searchResults)[number]; index: number }) => (
    <View
      style={[
        { backgroundColor: palette.surface, paddingHorizontal: spacing.lg },
        index === 0 && { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.sm },
        index === searchResults.length - 1 && {
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
              <View style={{ marginTop: spacing.xs }}>
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
      {index < searchResults.length - 1 ? <Divider /> : null}
    </View>
  );

  const analysisFooter = (
    <View>
      <Card>
        {activeBudgetRows.length === 0 ? (
          <ListRow
            icon={Target}
            title={tr.budgets.emptyAnalysisTitle}
            subtitle={tr.budgets.emptyAnalysisHint}
            chevron
            onPress={() => router.push({ pathname: "/(tabs)/settings/budgets", params: { from: "analysis" } } as never, { withAnchor: true })}
          />
        ) : (
          <>
            <Spread style={{ marginBottom: spacing.sm }}>
              <Heading style={{ marginTop: 0, marginBottom: 0 }}>{tr.budgets.analysisTitle(monthName(endMonth))}</Heading>
              <Button label={tr.common.edit} size="sm" variant="ghost" onPress={() => router.push({ pathname: "/(tabs)/settings/budgets", params: { from: "analysis" } } as never, { withAnchor: true })} />
            </Spread>
            {activeBudgetRows.map((budget) => (
              <ListRow
                key={budget.id}
                title={categoryById.get(budget.categoryId)?.name ?? tr.common.none}
                subtitle={tr.budgets.progress(formatMinorCompact(budget.spentMinor), formatMinorCompact(budget.amountMinor))}
                right={
                  <Badge
                    text={budget.remainingMinor < 0 ? tr.budgets.over(formatMinorCompact(-budget.remainingMinor)) : tr.budgets.remaining(formatMinorCompact(budget.remainingMinor))}
                    tone={budget.remainingMinor < 0 ? "negative" : budget.ratio >= 0.8 ? "warning" : "positive"}
                  />
                }
                stackRightOnNarrow
              />
            ))}
          </>
        )}
      </Card>

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
                : categoryFilter ? catName(categoryFilter) : tr.analysis.monthlyFlows}
            </Heading>
            <View style={{ width: narrow ? "100%" : 168 }}>
              <Segmented
                noMargin
                options={[
                  { value: "pie", label: tr.analysis.chartPie },
                  { value: "bars", label: tr.analysis.chartBars },
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
              />
            ) : (
              <Body muted>{tr.analysis.noResults}</Body>
            )
          ) : (
            <Bars width={Math.min(width - spacing.lg * 4, 640)} groups={barGroups} series={barSeries} />
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

      {trendRow && trendStartMonth && trendEndMonth ? (
        <Card>
          <Heading style={{ marginTop: 0 }}>{tr.analysis.trendOf(trendRow.category.name)}</Heading>
          <Lines
            width={Math.min(width - spacing.lg * 4, 640)}
            xLabels={monthKeys.map(shortMonthLabel)}
            series={[
              {
                label: trendRow.category.name,
                color: colors[0],
                points: cumulativeSeries(trendRow.data, trendStartMonth, trendEndMonth).map(
                  (p) => p.cumulativeMinor,
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
      <Screen>
        <Stack.Screen options={{ headerLeft: () => <HeaderBackButton fallback={back.href} exact={back.exact} /> }} />
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerLeft: () => <HeaderBackButton fallback={back.href} exact={back.exact} /> }} />
      <FlatList
        data={searchActive ? searchResults : []}
        keyExtractor={(t: (typeof searchResults)[number]) => t.id}
        renderItem={renderResult}
        ListHeaderComponent={searchHeader}
        ListFooterComponent={analysisFooter}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}
