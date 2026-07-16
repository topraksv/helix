/** Analysis: category × month matrix over a selectable window (3/6/12 months
 *  or a calendar year), a category filter, per-category cumulative trend and
 *  transaction search. */

import React, { useDeferredValue, useState } from "react";
import { Text, useWindowDimensions, View } from "react-native";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react-native";
import { categoryRangeMatrix, cumulativeSeries, distributionForRange } from "../../../domain/analytics";
import { addMonthsToKey, firstDayOf, lastDayOf, makeMonthKey, monthKeyOf, monthOf, monthRange, todayISO, yearOf } from "../../../domain/dates";
import { formatMinor } from "../../../domain/money";
import { signedBalanceEffectOf } from "../../../domain/transactions";
import { transactionDateText } from "../../../ui/transaction-date";
import { tr } from "../../../i18n/tr";
import { toTxLike, useAllTransactions, useCategories, usePersons } from "../../../data/hooks";
import { categoryIcon } from "../../../data/category-icons";
import { Amount, Badge, Body, Card, Divider, EmptyState, Field, Heading, IconButton, Row, Screen, Segmented, Select, Spread } from "../../../ui/components";
import { Bars, Donut, Lines, useSeriesColors } from "../../../ui/charts";
import { StickyTable } from "../../../ui/sticky-table";
import { spacing, type, useTheme } from "../../../ui/theme";

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
  const categories = useCategories();
  const persons = usePersons();
  const allTx = useAllTransactions();
  const { palette } = useTheme();
  const colors = useSeriesColors();
  const { width } = useWindowDimensions();
  const compact = width < 900;
  const narrow = width < 520;

  // Window: rolling N months ending now, or a calendar year (navigable).
  const [startMonth, endMonth] =
    period === "year"
      ? [makeMonthKey(year, 1), year === currentYear ? currentMonth : makeMonthKey(year, 12)]
      : [addMonthsToKey(currentMonth, -(Number(period.replace("m", "")) - 1)), currentMonth];
  const monthKeys = monthRange(startMonth, endMonth);

  // No manual useMemo: the React Compiler (enabled app-wide) memoizes these
  // and bails out when it finds hand-rolled memoization on unstable deps.
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
  const minYear = allTx.length > 0 ? yearOf(allTx[0].effectiveDate) : currentYear;

  const rows = categories
    .map((c) => ({ category: c, data: matrix.get(c.id) }))
    .filter((r) => r.data && r.data.ytdMinor !== 0)
    .filter((r) => categoryFilter == null || r.category.id === categoryFilter);

  // Simple but effective search: each transaction becomes one lowercased
  // haystack of category name, note, Turkish month name, year and amount
  // digits, so "market", "mart", "2025" or "1500" all filter sensibly.
  const catName = (cid: string | null) => (cid ? categoryById.get(cid)?.name ?? "" : "");
  const deferredQuery = useDeferredValue(query);
  const q = deferredQuery.trim().toLocaleLowerCase("tr-TR");
  const searchResults =
    q.length < 1
      ? []
      : allTx
          .filter((t) => {
            const mk = monthKeyOf(t.effectiveDate);
            const haystack = [
              catName(t.categoryId),
              t.note ?? "",
              tr.months[monthOf(mk) - 1],
              String(yearOf(t.effectiveDate)),
              String(Math.round(t.amountTryMinor / 100)),
              (t.amountTryMinor / 100).toFixed(2).replace(".", ","),
            ]
              .join(" ")
              .toLocaleLowerCase("tr-TR");
            return haystack.includes(q);
          })
          .slice(-100)
          .reverse();

  const trendRow = (selected ? rows.find((r) => r.category.id === selected) : null) ?? (categoryFilter ? rows[0] : null);

  // Chart data: pie = expense-category shares over the window; bars = monthly
  // income vs expense, or the filtered category's month-by-month values.
  // Transaction type is authoritative for income/expense totals. Keep legacy
  // rows whose category kind is stale in the distribution instead of silently
  // dropping real spending; only the category-detail matrix needs kind parity.
  const periodDistribution = distributionForRange(txLike, firstDayOf(startMonth), lastDayOf(endMonth), today);
  const expenseRows = [...periodDistribution.expenseByCategory.entries()]
    .map(([categoryId, valueMinor]) => ({
      label: categoryById.get(categoryId)?.name ?? tr.common.none,
      valueMinor,
    }))
    .concat(
      periodDistribution.uncategorizedExpenseMinor !== 0
        ? [{ label: tr.common.none, valueMinor: periodDistribution.uncategorizedExpenseMinor }]
        : [],
    )
    .sort((a, b) => b.valueMinor - a.valueMinor);
  const positiveExpenseRows = expenseRows.filter((row) => row.valueMinor > 0);
  const refundRows = expenseRows.filter((row) => row.valueMinor < 0);
  const pieSlices = [
    ...positiveExpenseRows.slice(0, 7).map((row, i) => ({ ...row, color: colors[i % colors.length] })),
    ...(() => {
      const rest = positiveExpenseRows.slice(7).reduce((sum, row) => sum + row.valueMinor, 0);
      return rest > 0 ? [{ label: tr.common.other, valueMinor: rest, color: colors[7] }] : [];
    })(),
    ...(periodDistribution.transferTotalMinor > 0
      ? [{ label: tr.dashboard.investmentAside, valueMinor: periodDistribution.transferTotalMinor, color: colors[4] }]
      : []),
  ];
  const pieSupplemental = [
    ...refundRows.map((row) => ({
      label: tr.dashboard.refundAside(row.label),
      valueMinor: row.valueMinor,
      color: palette.positive,
    })),
    ...(periodDistribution.transferTotalMinor < 0
      ? [{
          label: tr.dashboard.investmentRefundAside,
          valueMinor: periodDistribution.transferTotalMinor,
          color: palette.positive,
        }]
      : []),
  ];
  const barGroups = monthKeys.map((m) => {
    const label = tr.months[monthOf(m) - 1].slice(0, 3);
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
    const values = [...monthKeys.map((month) => data!.monthly.get(month) ?? 0), data!.ytdMinor];
    return Math.max(longest, ...values.filter((value) => value !== 0).map((value) => formatMinor(value).length));
  }, 0);
  // The table already scrolls horizontally; size each numeric column for the
  // longest actual value so amounts remain on one line instead of wrapping.
  const analysisCellWidth = Math.min(240, Math.max(compact ? 120 : 128, Math.ceil(maxAmountChars * 7.5) + spacing.lg * 2));

  return (
    <Screen>
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

      <Field placeholder={tr.analysis.searchPlaceholder} value={query} onChangeText={setQuery} autoCapitalize="none" />
      {q.length >= 1 ? (
        <Card>
          {searchResults.length === 0 ? (
            <Body muted style={{ paddingVertical: spacing.sm }}>{tr.analysis.noResults}</Body>
          ) : (
            searchResults.map((t, index) => (
              <View key={t.id}>
                <Spread style={{ paddingVertical: spacing.xs }}>
                  <View style={{ flex: 1, paddingRight: spacing.sm }}>
                    <Body>{catName(t.categoryId) || tr.common.none}</Body>
                    <Body muted style={{ fontSize: 12 }}>
                      {transactionDateText(t)}
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
                {index < searchResults.length - 1 ? <Divider /> : null}
              </View>
            ))
          )}
        </Card>
      ) : null}

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
                totalMinor={periodDistribution.expenseTotalMinor + periodDistribution.transferTotalMinor}
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
            columns={[...monthKeys.map((m) => ({ key: m, label: tr.months[monthOf(m) - 1].slice(0, 3) })), { key: "__total", label: tr.common.total }]}
            rows={rows.map(({ category, data }) => ({
              key: category.id,
              label: `${categoryIcon(category)} ${category.name}`,
              onLabelPress: () => setSelected(selected === category.id ? null : category.id),
              rowHighlight: selected === category.id,
              cells: [
                ...monthKeys.map((m) => {
                  const v = data!.monthly.get(m) ?? 0;
                  return (
                    <Text
                      key={m}
                      style={[type.amountSm, { textAlign: "right", paddingHorizontal: spacing.md, fontSize: compact ? 12 : 13, fontVariant: ["tabular-nums"], color: v === 0 ? palette.textMuted : palette.text }]}
                    >
                      {v === 0 ? "" : formatMinor(v)}
                    </Text>
                  );
                }),
                <Text key="__total" style={[type.amountSm, { textAlign: "right", paddingHorizontal: spacing.md, fontSize: compact ? 12 : 13, color: palette.text }]}>
                  {formatMinor(data!.ytdMinor)}
                </Text>,
              ],
            }))}
          />
        </Card>
      )}

      {trendRow ? (
        <Card>
          <Heading style={{ marginTop: 0 }}>{tr.analysis.trendOf(trendRow.category.name)}</Heading>
          <Lines
            width={Math.min(width - spacing.lg * 4, 640)}
            xLabels={monthKeys.map((m) => tr.months[monthOf(m) - 1].slice(0, 3))}
            series={[
              {
                label: trendRow.category.name,
                color: colors[0],
                points: cumulativeSeries(trendRow.data!, monthKeys[0], monthKeys[monthKeys.length - 1]).map(
                  (p) => p.cumulativeMinor,
                ),
              },
            ]}
          />
        </Card>
      ) : null}
    </Screen>
  );
}
