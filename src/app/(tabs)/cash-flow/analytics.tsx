/** Analysis: category × month matrix over a selectable window (3/6/12 months
 *  or a calendar year), a category filter, per-category cumulative trend and
 *  transaction search. */

import React, { useState } from "react";
import { Text, useWindowDimensions, View } from "react-native";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react-native";
import { categoryRangeMatrix, cumulativeSeries } from "../../../domain/analytics";
import { addMonthsToKey, makeMonthKey, monthKeyOf, monthOf, monthRange, todayISO, yearOf } from "../../../domain/dates";
import { formatMinor } from "../../../domain/money";
import { dateLabel, tr } from "../../../i18n/tr";
import { toTxLike, useAllTransactions, useCategories, usePersons } from "../../../data/hooks";
import { categoryIcon } from "../../../data/category-icons";
import { Amount, Body, Card, Divider, EmptyState, Field, Heading, IconButton, Row, Screen, Segmented, Select, Spread } from "../../../ui/components";
import { Lines, useSeriesColors } from "../../../ui/charts";
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
  const [query, setQuery] = useState("");
  const categories = useCategories();
  const persons = usePersons();
  const allTx = useAllTransactions();
  const { palette } = useTheme();
  const colors = useSeriesColors();
  const { width } = useWindowDimensions();

  // Window: rolling N months ending now, or a calendar year (navigable).
  const [startMonth, endMonth] =
    period === "year"
      ? [makeMonthKey(year, 1), year === currentYear ? currentMonth : makeMonthKey(year, 12)]
      : [addMonthsToKey(currentMonth, -(Number(period.replace("m", "")) - 1)), currentMonth];
  const monthKeys = monthRange(startMonth, endMonth);

  // No manual useMemo: the React Compiler (enabled app-wide) memoizes these
  // and bails out when it finds hand-rolled memoization on unstable deps.
  const txLike = toTxLike(allTx, persons);
  const matrix = categoryRangeMatrix(txLike, startMonth, endMonth, today);

  const rows = categories
    .map((c) => ({ category: c, data: matrix.get(c.id) }))
    .filter((r) => r.data && r.data.ytdMinor !== 0)
    .filter((r) => categoryFilter == null || r.category.id === categoryFilter);

  // Simple but effective search: each transaction becomes one lowercased
  // haystack of category name, note, Turkish month name, year and amount
  // digits, so "market", "mart", "2025" or "1500" all filter sensibly.
  const catName = (cid: string | null) => (cid ? categories.find((c) => c.id === cid)?.name ?? "" : "");
  const q = query.trim().toLocaleLowerCase("tr-TR");
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

  return (
    <Screen>
      {/* Period slicer + (year mode) year switcher */}
      <Spread style={{ marginBottom: spacing.sm, gap: spacing.md }}>
        <View style={{ flex: 1, maxWidth: 380 }}>
          <Segmented
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
            <IconButton icon={ChevronLeft} label={String(year - 1)} onPress={() => setYear(year - 1)} />
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
            searchResults.map((t) => (
              <View key={t.id}>
                <Spread style={{ paddingVertical: spacing.xs }}>
                  <View style={{ flex: 1, paddingRight: spacing.sm }}>
                    <Body numberOfLines={1}>{catName(t.categoryId) || tr.common.none}</Body>
                    <Body muted style={{ fontSize: 12 }} numberOfLines={1}>
                      {dateLabel(t.effectiveDate)}
                      {t.note ? ` · ${t.note}` : ""}
                    </Body>
                  </View>
                  <Amount minor={t.type === "income" ? t.amountTryMinor : -t.amountTryMinor} />
                </Spread>
                <Divider />
              </View>
            ))
          )}
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState icon={Inbox} title={tr.cashflow.emptyMonth} />
      ) : (
        <Card padded={false} style={{ height: Math.min(rows.length, 8) * 52 + 60 }}>
          <StickyTable
            cornerLabel={tr.tx.category}
            headWidth={150}
            cellWidth={96}
            currentColumnKey={currentMonth}
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
                      style={[type.small, { flex: 1, textAlign: "right", paddingHorizontal: spacing.sm, fontVariant: ["tabular-nums"], color: v === 0 ? palette.textMuted : palette.text }]}
                    >
                      {v === 0 ? "—" : formatMinor(v)}
                    </Text>
                  );
                }),
                <Text key="__total" style={[type.amount, { flex: 1, textAlign: "right", paddingHorizontal: spacing.sm, color: palette.text }]}>
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
