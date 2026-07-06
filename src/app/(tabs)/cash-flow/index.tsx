/**
 * Cash-flow home. One dataset, two presentations (user requirement):
 * - narrow (phone): month cards with key totals
 * - wide (desktop web): Excel-like matrix — rows=months, columns=categories
 *   (is_column) + derived (KK Taksit, Ay Başı, Güncel Bakiye) + computed.
 */

import React, { useMemo, useState } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { ArrowDownRight, ArrowUpRight, CalendarPlus, ChartNoAxesColumn, ChevronLeft, ChevronRight, CreditCard, Inbox, Plus } from "lucide-react-native";
import { creditCardSplit } from "../../../domain/analytics";
import { evaluateComputedColumn, parseDefinition } from "../../../domain/computed-columns";
import { todayISO, yearOf } from "../../../domain/dates";
import { formatMinor } from "../../../domain/money";
import { monthLabel, tr } from "../../../i18n/tr";
import { useCategories, useComputedColumns, useLedger, usePersons, useSources, useAllTransactions, toTxLike } from "../../../data/hooks";
import { Amount, Button, Card, EmptyState, IconButton, Row, Screen, Spread } from "../../../ui/components";
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

  const yearSwitcher = (
    <Row gap={spacing.sm}>
      <IconButton icon={ChevronLeft} label={String(year - 1)} onPress={() => setYear(year - 1)} />
      <Text style={[type.heading, { color: palette.text, minWidth: 48, textAlign: "center" }]}>{year}</Text>
      <IconButton icon={ChevronRight} label={String(year + 1)} onPress={() => setYear(year + 1)} disabled={year >= currentYear + 1} />
    </Row>
  );

  return (
    <Screen title={tr.cashflow.title} right={yearSwitcher} maxWidth={wide ? 1100 : 760} scroll={false} padded>
      <Row gap={spacing.sm} style={{ marginBottom: spacing.lg, flexWrap: "wrap" }}>
        <Button icon={Plus} label={tr.cashflow.addTransaction} onPress={() => router.push("/transaction")} />
        <Button icon={CreditCard} size="sm" label={tr.cashflow.installments} variant="secondary" onPress={() => router.push("/cash-flow/installments")} />
        <Button icon={ChartNoAxesColumn} size="sm" label={tr.cashflow.analysis} variant="secondary" onPress={() => router.push("/cash-flow/analytics")} />
        <Button icon={CalendarPlus} size="sm" label={tr.cashflow.bulkEntry} variant="secondary" onPress={() => router.push("/bulk-entry")} />
      </Row>

      {!bundle || bundle.yearMonths.length === 0 ? (
        <EmptyState icon={Inbox} title={tr.cashflow.emptyMonth} hint={tr.cashflow.emptyYearHint} />
      ) : wide ? (
        <MatrixTable
          bundle={bundle}
          columnCategories={columnCategories}
          computedColumns={computed}
          creditCardIds={creditCardIds}
          txLike={txLike}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {bundle.yearMonths.map((m) => (
            <Card key={m.month} onPress={() => router.push(`/cash-flow/${m.month}`)}>
              <Spread>
                <Text style={[type.heading, { color: palette.text }]}>{monthLabel(m.month)}</Text>
                <Amount minor={m.closingMinor} />
              </Spread>
              <Row gap={spacing.lg} style={{ marginTop: spacing.md }}>
                <Row gap={spacing.xs}>
                  <ArrowUpRight size={14} color={palette.positive} />
                  <Text style={[type.amountSm, { color: palette.positive }]}>{formatMinor(m.incomeMinor)}</Text>
                </Row>
                <Row gap={spacing.xs}>
                  <ArrowDownRight size={14} color={palette.negative} />
                  <Text style={[type.amountSm, { color: palette.negative }]}>{formatMinor(m.expenseMinor)}</Text>
                </Row>
                {m.transferMinor !== 0 ? (
                  <Text style={[type.amountSm, { color: palette.textMuted }]}>
                    {tr.cashflow.transfer}: {formatMinor(m.transferMinor)}
                  </Text>
                ) : null}
              </Row>
            </Card>
          ))}
        </ScrollView>
      )}
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
  const CELL: object = { width: 128, paddingVertical: spacing.md, paddingHorizontal: spacing.sm };
  const header = ["KK Taksit", ...columnCategories.map((c) => c.name), ...computedColumns.map((c) => c.name), tr.cashflow.opening, tr.cashflow.closing];

  return (
    <Card padded={false} style={{ flex: 1 }}>
      <ScrollView>
        <ScrollView horizontal>
          <View>
            <Row gap={0} style={{ borderBottomWidth: 1, borderColor: palette.border, backgroundColor: palette.surfaceAlt }}>
              <View style={[CELL, { width: 116 }]}>
                <Text style={[type.label, { color: palette.textMuted }]}>{tr.cashflow.year}</Text>
              </View>
              {header.map((h, i) => (
                <View key={`${h}-${i}`} style={CELL}>
                  <Text style={[type.label, { color: palette.textMuted, textAlign: "right" }]} numberOfLines={2}>
                    {h}
                  </Text>
                </View>
              ))}
            </Row>
            {bundle.yearMonths.map((m, rowIndex) => {
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
                  style={{
                    borderBottomWidth: rowIndex === bundle.yearMonths.length - 1 ? 0 : 1,
                    borderColor: palette.border,
                    backgroundColor: rowIndex % 2 === 1 ? palette.surfaceAlt + "66" : "transparent",
                  }}
                >
                  <View style={[CELL, { width: 116 }]}>
                    <Text
                      style={[type.label, { color: palette.primary, fontFamily: "Inter_600SemiBold", borderRadius: radius.sm }]}
                      onPress={() => router.push(`/cash-flow/${m.month}`)}
                      accessibilityRole="link"
                    >
                      {monthLabel(m.month)}
                    </Text>
                  </View>
                  {cells.map((v, i) => (
                    <View key={i} style={CELL}>
                      <Text
                        style={[
                          type.amountSm,
                          { fontSize: 13, color: v < 0 ? palette.negative : v === 0 ? palette.textMuted : palette.text, textAlign: "right" },
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
    </Card>
  );
}
