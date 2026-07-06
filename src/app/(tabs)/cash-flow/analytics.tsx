/** Analysis: category × month matrix over a selectable window (3/6/12 months
 *  or a calendar year), a category filter, per-category cumulative trend and
 *  transaction search. */

import React, { useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react-native";
import { categoryRangeMatrix, cumulativeSeries } from "../../../domain/analytics";
import { addMonthsToKey, makeMonthKey, monthKeyOf, monthOf, monthRange, todayISO, yearOf } from "../../../domain/dates";
import { formatMinor } from "../../../domain/money";
import { dateLabel, tr } from "../../../i18n/tr";
import { toTxLike, useAllTransactions, useCategories, usePersons } from "../../../data/hooks";
import { categoryIcon } from "../../../data/category-icons";
import { Amount, Body, Card, Divider, EmptyState, Field, Heading, IconButton, Row, Screen, Segmented, Select, Spread } from "../../../ui/components";
import { Lines, useSeriesColors } from "../../../ui/charts";
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

  const q = query.trim().toLocaleLowerCase("tr-TR");
  const searchResults =
    q.length < 2
      ? []
      : allTx
          .filter(
            (t) =>
              (t.note ?? "").toLocaleLowerCase("tr-TR").includes(q) ||
              formatMinor(t.amountTryMinor).includes(q) ||
              t.effectiveDate.includes(q),
          )
          .slice(-50)
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

      <Field placeholder={`${tr.common.search}…`} value={query} onChangeText={setQuery} />
      {searchResults.length > 0 ? (
        <Card>
          {searchResults.map((t) => (
            <View key={t.id}>
              <Spread style={{ paddingVertical: spacing.xs }}>
                <Body>
                  {dateLabel(t.effectiveDate)}
                  {t.note ? ` · ${t.note}` : ""}
                </Body>
                <Amount minor={t.type === "income" ? t.amountTryMinor : -t.amountTryMinor} />
              </Spread>
              <Divider />
            </View>
          ))}
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState icon={Inbox} title={tr.cashflow.emptyMonth} />
      ) : (
        <Card padded={false}>
          <ScrollView horizontal>
            <View>
              <Row gap={0} style={{ borderBottomWidth: 1, borderColor: palette.border }}>
                <View style={{ width: 150, padding: spacing.md }}>
                  <Text style={[type.label, { color: palette.textMuted }]}>{tr.tx.category}</Text>
                </View>
                {monthKeys.map((m) => (
                  <View key={m} style={{ width: 96, padding: spacing.md }}>
                    <Text style={[type.label, { color: m === currentMonth ? palette.primary : palette.textMuted, textAlign: "right" }]}>
                      {tr.months[monthOf(m) - 1].slice(0, 3)}
                    </Text>
                  </View>
                ))}
                <View style={{ width: 110, padding: spacing.md }}>
                  <Text style={[type.label, { color: palette.text, textAlign: "right" }]}>{tr.common.total}</Text>
                </View>
              </Row>
              {rows.map(({ category, data }) => (
                <Pressable
                  key={category.id}
                  onPress={() => setSelected(selected === category.id ? null : category.id)}
                  accessibilityRole="button"
                >
                  <Row
                    gap={0}
                    style={{
                      borderBottomWidth: 1,
                      borderColor: palette.border,
                      backgroundColor: selected === category.id ? palette.surfaceAlt : "transparent",
                    }}
                  >
                    <View style={{ width: 150, padding: spacing.md }}>
                      <Text style={[type.label, { color: palette.primary }]} numberOfLines={1}>
                        {categoryIcon(category)} {category.name}
                      </Text>
                    </View>
                    {monthKeys.map((m) => {
                      const v = data!.monthly.get(m) ?? 0;
                      return (
                        <View key={m} style={{ width: 96, padding: spacing.md }}>
                          <Text
                            style={[
                              type.small,
                              { textAlign: "right", fontVariant: ["tabular-nums"], color: v === 0 ? palette.textMuted : palette.text },
                            ]}
                          >
                            {v === 0 ? "—" : formatMinor(v)}
                          </Text>
                        </View>
                      );
                    })}
                    <View style={{ width: 110, padding: spacing.md }}>
                      <Text style={[type.amount, { textAlign: "right", color: palette.text }]}>{formatMinor(data!.ytdMinor)}</Text>
                    </View>
                  </Row>
                </Pressable>
              ))}
            </View>
          </ScrollView>
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
