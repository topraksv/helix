/**
 * Item breakdown: tap a category (or computed column) in Mali Tablo to see its
 * value in every month of the year at a glance. Read-only summary — tapping a
 * month row jumps into that month's detail where the transactions are managed.
 */

import React, { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Inbox } from "lucide-react-native";
import { creditCardSplit } from "../../../domain/analytics";
import { evaluateComputedColumn, parseDefinition } from "../../../domain/computed-columns";
import { makeMonthKey, monthKeyOf, todayISO } from "../../../domain/dates";
import { formatMinor } from "../../../domain/money";
import {
  toTxLike,
  useAllTransactions,
  useComputedColumns,
  useLedger,
  usePersons,
  useSources,
} from "../../../data/hooks";
import { monthLabel, tr } from "../../../i18n/tr";
import { Amount, Card, EmptyState, Screen } from "../../../ui/components";
import { spacing, type, useTheme } from "../../../ui/theme";

export default function ItemBreakdownScreen() {
  const { col, label, year: yearParam, kind } = useLocalSearchParams<{ col: string; label: string; year: string; kind: string }>();
  const year = Number(yearParam);
  const router = useRouter();
  const { palette } = useTheme();
  const bundle = useLedger(year);
  const computed = useComputedColumns();
  const sources = useSources();
  const persons = usePersons();
  const allTx = useAllTransactions();
  const today = todayISO();
  const currentMonth = monthKeyOf(today);

  const creditCardIds = useMemo(
    () => new Set(sources.filter((src) => src.type === "credit_card").map((src) => src.id)),
    [sources],
  );
  const txLike = useMemo(() => toTxLike(allTx, persons), [allTx, persons]);

  // Value of this column for a given month: a category reads its bucket; a
  // computed column is evaluated the same way the matrix does (with the
  // credit-card split available to cc_split definitions).
  const rows = useMemo(() => {
    const dataByMonth = new Map((bundle?.yearMonths ?? []).map((m) => [m.month, m]));
    const compDef = kind === "computed" ? computed.find((c) => c.id === col) : null;
    return Array.from({ length: 12 }, (_, i) => {
      const month = makeMonthKey(year, i + 1);
      const m = dataByMonth.get(month) ?? null;
      let value: number | null = 0;
      if (!m) value = null;
      else if (kind === "computed") {
        if (!compDef) value = null;
        else {
          const cc = creditCardSplit(txLike, creditCardIds, month, today);
          try {
            value = evaluateComputedColumn(parseDefinition(JSON.parse(compDef.definition)), {
              month,
              byCategory: m.byCategory,
              incomeMinor: m.incomeMinor,
              expenseMinor: m.expenseMinor,
              ccSingleMinor: cc.singleMinor,
              ccInstallmentMinor: cc.installmentMinor,
            });
          } catch {
            value = null;
          }
        }
      } else {
        value = m.byCategory.get(col) ?? 0;
      }
      return { month, value };
    });
  }, [bundle?.yearMonths, computed, col, kind, year, txLike, creditCardIds, today]);

  const total = rows.reduce((sum, r) => sum + (r.value ?? 0), 0);

  return (
    <Screen>
      <Stack.Screen options={{ title: label ?? tr.cashflow.monthDetail }} />
      {!bundle ? (
        <EmptyState icon={Inbox} title={tr.cashflow.emptyMonth} />
      ) : (
        <Card padded={false}>
          <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderColor: palette.border, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={[type.label, { color: palette.textMuted }]}>{tr.cashflow.yearTotal(year)}</Text>
            <Amount minor={total} />
          </View>
          {rows.map((r, i) => {
            const isCurrent = r.month === currentMonth;
            return (
              <Pressable
                key={r.month}
                accessibilityRole="button"
                onPress={() => router.push(`/cash-flow/${r.month}`)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.md,
                  borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                  borderColor: palette.border,
                  backgroundColor: isCurrent ? palette.primarySoft + "55" : pressed ? palette.surfaceAlt : "transparent",
                })}
              >
                <Text style={[type.body, { color: isCurrent ? palette.primary : palette.text, fontFamily: isCurrent ? "Inter_700Bold" : "Inter_500Medium" }]}>
                  {monthLabel(r.month)}
                </Text>
                {r.value == null ? (
                  <Text style={[type.amountSm, { color: palette.textMuted }]}>—</Text>
                ) : (
                  <Text style={[type.amountSm, { color: r.value < 0 ? palette.negative : r.value === 0 ? palette.textMuted : palette.text }]}>
                    {r.value === 0 ? "—" : formatMinor(r.value)}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}
