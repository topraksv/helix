/**
 * Cash-flow home. One dataset, two presentations (user requirement):
 * - narrow (phone): month cards with key totals
 * - wide (desktop web): Excel-like matrix — rows=months, columns=categories
 *   (is_column) + derived (KK Taksit, Ay Başı, Güncel Bakiye) + computed.
 */

import React, { useMemo, useState } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { creditCardSplit } from "../../../domain/analytics";
import { evaluateComputedColumn, parseDefinition } from "../../../domain/computed-columns";
import { todayISO, yearOf } from "../../../domain/dates";
import { formatMinor } from "../../../domain/money";
import { monthLabel, tr } from "../../../i18n/tr";
import { useCategories, useComputedColumns, useLedger, usePersons, useSources, useAllTransactions, toTxLike } from "../../../data/hooks";
import { Amount, Body, Button, Card, EmptyState, Heading, Row, Screen, Spread, Title } from "../../../ui/components";
import { radius, spacing, type, useTheme } from "../../../ui/theme";

export default function CashflowScreen() {
  const currentYear = yearOf(todayISO());
  const [year, setYear] = useState(currentYear);
  const bundle = useLedger(year);
  const categories = useCategories();
  const computed = useComputedColumns();
  const sources = useSources();
  const persons = usePersons();
  const allTx = useAllTransactions();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const router = useRouter();
  const { palette } = useTheme();

  const creditCardIds = useMemo(
    () => new Set(sources.filter((s) => s.type === "credit_card").map((s) => s.id)),
    [sources],
  );
  const txLike = useMemo(() => toTxLike(allTx, persons), [allTx, persons]);
  const columnCategories = categories.filter((c) => c.isColumn);

  return (
    <Screen padded={false} scroll={false}>
      <View style={{ flex: 1, padding: spacing.lg }}>
        <Spread style={{ marginBottom: spacing.md }}>
          <Title>{tr.cashflow.title}</Title>
          <Row gap={spacing.sm}>
            <Button label="◀" variant="secondary" onPress={() => setYear(year - 1)} />
            <Heading>{year}</Heading>
            <Button label="▶" variant="secondary" onPress={() => setYear(year + 1)} disabled={year >= currentYear + 1} />
          </Row>
        </Spread>

        <Row gap={spacing.sm} style={{ marginBottom: spacing.md, flexWrap: "wrap" }}>
          <Button label={`+ ${tr.cashflow.addTransaction}`} onPress={() => router.push("/islem")} />
          <Button label={tr.cashflow.installments} variant="secondary" onPress={() => router.push("/nakit-akisi/taksitler")} />
          <Button label={tr.cashflow.analysis} variant="secondary" onPress={() => router.push("/nakit-akisi/analiz")} />
          <Button label={tr.cashflow.bulkEntry} variant="secondary" onPress={() => router.push("/toplu-giris")} />
        </Row>

        {!bundle || bundle.yearMonths.length === 0 ? (
          <EmptyState text={tr.cashflow.emptyMonth} />
        ) : wide ? (
          <MatrixTable
            bundle={bundle}
            columnCategories={columnCategories}
            computedColumns={computed}
            creditCardIds={creditCardIds}
            txLike={txLike}
          />
        ) : (
          <ScrollView>
            {bundle.yearMonths.map((m) => (
              <Card key={m.month} onPress={() => router.push(`/nakit-akisi/${m.month}`)}>
                <Spread>
                  <Heading style={{ marginVertical: 0 }}>{monthLabel(m.month)}</Heading>
                  <Amount minor={m.closingMinor} />
                </Spread>
                <Row gap={spacing.lg} style={{ marginTop: spacing.sm }}>
                  <View>
                    <Text style={[type.small, { color: palette.textMuted }]}>{tr.cashflow.income}</Text>
                    <Text style={[type.amount, { color: palette.positive }]}>{formatMinor(m.incomeMinor)}</Text>
                  </View>
                  <View>
                    <Text style={[type.small, { color: palette.textMuted }]}>{tr.cashflow.expense}</Text>
                    <Text style={[type.amount, { color: palette.negative }]}>{formatMinor(m.expenseMinor)}</Text>
                  </View>
                  {m.transferMinor !== 0 ? (
                    <View>
                      <Text style={[type.small, { color: palette.textMuted }]}>{tr.cashflow.transfer}</Text>
                      <Text style={[type.amount, { color: palette.text }]}>{formatMinor(m.transferMinor)}</Text>
                    </View>
                  ) : null}
                </Row>
              </Card>
            ))}
          </ScrollView>
        )}
      </View>
    </Screen>
  );
}

function MatrixTable({
  bundle,
  columnCategories,
  computedColumns,
  creditCardIds,
  txLike,
}: {
  bundle: NonNullable<ReturnType<typeof useLedger>>;
  columnCategories: ReturnType<typeof useCategories>;
  computedColumns: ReturnType<typeof useComputedColumns>;
  creditCardIds: Set<string>;
  txLike: ReturnType<typeof toTxLike>;
}) {
  const { palette } = useTheme();
  const router = useRouter();
  const today = todayISO();
  const CELL: object = { width: 132, paddingVertical: spacing.md, paddingHorizontal: spacing.sm };
  const header = [
    tr.installments.title.split(" ")[0], // "Taksitler" → KK Taksit derived
    ...columnCategories.map((c) => c.name),
    ...computedColumns.map((c) => c.name),
    tr.cashflow.opening,
    tr.cashflow.closing,
  ];

  return (
    <ScrollView>
      <ScrollView horizontal>
        <View>
          <Row gap={0} style={{ borderBottomWidth: 1, borderColor: palette.border }}>
            <View style={[CELL, { width: 110 }]}>
              <Text style={[type.label, { color: palette.textMuted }]}>{tr.cashflow.year}</Text>
            </View>
            {header.map((h, i) => (
              <View key={`${h}-${i}`} style={CELL}>
                <Text style={[type.label, { color: palette.textMuted }]} numberOfLines={2}>
                  {i === 0 ? "KK Taksit" : h}
                </Text>
              </View>
            ))}
          </Row>
          {bundle.yearMonths.map((m) => {
            const cc = creditCardSplit(txLike, creditCardIds, m.month, today);
            const aggregates = {
              month: m.month,
              byCategory: m.byCategory,
              incomeMinor: m.incomeMinor,
              expenseMinor: m.expenseMinor,
              ccSingleMinor: cc.singleMinor,
              ccInstallmentMinor: cc.installmentMinor,
            };
            const cells: number[] = [
              cc.installmentMinor,
              ...columnCategories.map((c) => m.byCategory.get(c.id) ?? 0),
              ...computedColumns.map((c) => {
                try {
                  return evaluateComputedColumn(parseDefinition(JSON.parse(c.definition)), aggregates);
                } catch {
                  return 0;
                }
              }),
              m.openingMinor,
              m.closingMinor,
            ];
            return (
              <Row
                key={m.month}
                gap={0}
                style={{ borderBottomWidth: 1, borderColor: palette.border, backgroundColor: palette.surface }}
              >
                <View style={[CELL, { width: 110 }]}>
                  <Link href={`/nakit-akisi/${m.month}`} asChild>
                    <Text style={[type.label, { color: palette.primary }]} onPress={() => router.push(`/nakit-akisi/${m.month}`)}>
                      {monthLabel(m.month)}
                    </Text>
                  </Link>
                </View>
                {cells.map((v, i) => (
                  <View key={i} style={CELL}>
                    <Text
                      style={[
                        type.amount,
                        { color: v < 0 ? palette.negative : v === 0 ? palette.textMuted : palette.text, textAlign: "right" },
                      ]}
                    >
                      {v === 0 ? "—" : formatMinor(v)}
                    </Text>
                  </View>
                ))}
              </Row>
            );
          })}
        </View>
      </ScrollView>
    </ScrollView>
  );
}
