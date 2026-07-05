/** YTD analysis (user's Excel habit): category × month matrix with
 *  cumulative totals, per-category trend, and transaction search. */

import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { categoryMonthMatrix, cumulativeSeries } from "../../../domain/analytics";
import { makeMonthKey, monthOf, todayISO, yearOf } from "../../../domain/dates";
import { formatMinor } from "../../../domain/money";
import { dateLabel, tr } from "../../../i18n/tr";
import { toTxLike, useAllTransactions, useCategories, usePersons } from "../../../data/hooks";
import { Amount, Body, Button, Card, Divider, EmptyState, Field, Heading, Row, Screen, Spread } from "../../../ui/components";
import { Lines, useSeriesColors } from "../../../ui/charts";
import { spacing, type, useTheme } from "../../../ui/theme";

export default function AnalysisScreen() {
  const today = todayISO();
  const currentYear = yearOf(today);
  const [year, setYear] = useState(currentYear);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const categories = useCategories();
  const persons = usePersons();
  const allTx = useAllTransactions();
  const { palette } = useTheme();
  const colors = useSeriesColors();
  const { width } = useWindowDimensions();

  const txLike = useMemo(() => toTxLike(allTx, persons), [allTx, persons]);
  const matrix = useMemo(() => categoryMonthMatrix(txLike, year, today), [txLike, year, today]);
  const monthsUpTo = year === currentYear ? monthOf(today) : 12;
  const monthKeys = Array.from({ length: monthsUpTo }, (_, i) => makeMonthKey(year, i + 1));

  const rows = categories
    .map((c) => ({ category: c, data: matrix.get(c.id) }))
    .filter((r) => r.data && r.data.ytdMinor !== 0);

  const searchResults = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr-TR");
    if (q.length < 2) return [];
    return allTx
      .filter(
        (t) =>
          (t.note ?? "").toLocaleLowerCase("tr-TR").includes(q) ||
          formatMinor(t.amountTryMinor).includes(q) ||
          t.effectiveDate.includes(q),
      )
      .slice(-50)
      .reverse();
  }, [allTx, query]);

  const selectedRow = selected ? rows.find((r) => r.category.id === selected) : null;

  return (
    <Screen>
      <Spread style={{ marginBottom: spacing.md }}>
        <Heading style={{ marginVertical: 0 }}>{tr.analysis.ytd}</Heading>
        <Row gap={spacing.sm}>
          <Button label="◀" variant="secondary" onPress={() => setYear(year - 1)} />
          <Heading style={{ marginVertical: 0 }}>{year}</Heading>
          <Button label="▶" variant="secondary" onPress={() => setYear(year + 1)} disabled={year >= currentYear} />
        </Row>
      </Spread>

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

      <Body muted style={{ marginBottom: spacing.sm }}>{tr.analysis.matrixHint}</Body>
      {rows.length === 0 ? (
        <EmptyState text={tr.cashflow.emptyMonth} />
      ) : (
        <Card style={{ padding: 0 }}>
          <ScrollView horizontal>
            <View>
              <Row gap={0} style={{ borderBottomWidth: 1, borderColor: palette.border }}>
                <View style={{ width: 150, padding: spacing.md }}>
                  <Text style={[type.label, { color: palette.textMuted }]}>{tr.tx.category}</Text>
                </View>
                {monthKeys.map((m) => (
                  <View key={m} style={{ width: 96, padding: spacing.md }}>
                    <Text style={[type.label, { color: palette.textMuted, textAlign: "right" }]}>
                      {tr.months[monthOf(m) - 1].slice(0, 3)}
                    </Text>
                  </View>
                ))}
                <View style={{ width: 110, padding: spacing.md }}>
                  <Text style={[type.label, { color: palette.text, textAlign: "right" }]}>{tr.analysis.ytd}</Text>
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
                        {category.icon ? `${category.icon} ` : ""}
                        {category.name}
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

      {selectedRow ? (
        <Card>
          <Heading style={{ marginTop: 0 }}>{tr.analysis.trendOf(selectedRow.category.name)}</Heading>
          <Lines
            width={Math.min(width - spacing.lg * 4, 640)}
            xLabels={monthKeys.map((m) => tr.months[monthOf(m) - 1].slice(0, 3))}
            series={[
              {
                label: selectedRow.category.name,
                color: colors[0],
                points: cumulativeSeries(selectedRow.data!, monthKeys[0], monthKeys[monthKeys.length - 1]).map(
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
