/** Item breakdown: one column's value in every month of the year; a row opens that month's detail. */

import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { creditCardSplitsByMonth } from "../../../domain/analytics";
import { evaluateMonthColumn, parseDefinition } from "../../../domain/computed-columns";
import { makeMonthKey, monthKeyOf, todayISO } from "../../../domain/dates";
import { isValidItemParams, singleParam, type ItemKind } from "../../../domain/route-params";
import { formatMinorCompact } from "../../../domain/money";
import {
  useCategoriesState,
  useComputedColumnsState,
  useLedgerState,
  useTxLike,
  useSourcesState,
} from "../../../data/hooks";
import { combineLiveStates } from "../../../data/live-state";
import { monthLabel, tr } from "../../../i18n/tr";
import { Amount, Card, DataGateScreen, DataStateNotice, Screen } from "../../../ui/components";
import { interactionSurface } from "../../../ui/interaction";
import { controlSize, font, spacing, type, useTheme } from "../../../ui/theme";

function MonthValueBar({
  value,
  maxMagnitude,
}: {
  value: number | null;
  maxMagnitude: number;
}) {
  const { palette } = useTheme();
  const ratio = value == null ? 0 : Math.min(1, Math.abs(value) / maxMagnitude);
  return (
    <View
      testID="month-value-bar"
      accessible={false}
      style={{
        width: "100%",
        minWidth: 32,
        height: 6,
        borderRadius: 3,
        backgroundColor: palette.surfaceAlt,
        overflow: "hidden",
      }}
    >
      {ratio > 0 ? (
        <View
          style={{
            width: `${ratio * 100}%` as `${number}%`,
            height: "100%",
            borderRadius: 3,
            backgroundColor: value! < 0 ? palette.negative : palette.primary,
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * `col`, `year` and `kind` are hostile input — the route is directly
 * addressable and Expo Router yields `string[]` for a repeated query key.
 * Validate before ANY of them reaches a query or a month-key derivation, and
 * recover to the table the way every other hostile deep link does.
 */
export default function ItemBreakdownScreen() {
  const { col, label, year: yearParam, kind } = useLocalSearchParams<{ col: string; label: string; year: string; kind: string }>();
  const params = isValidItemParams(col, yearParam, kind);
  if (!params) return <Redirect href="/(tabs)/cash-flow" />;
  return <ItemBreakdown col={params.col} year={params.year} kind={params.kind} label={singleParam(label)} />;
}

function ItemBreakdown({
  col,
  year,
  kind,
  label,
}: {
  col: string;
  year: number;
  kind: ItemKind;
  label: string | null;
}) {
  const router = useRouter();
  const { palette } = useTheme();
  const ledgerState = useLedgerState(year);
  const computedState = useComputedColumnsState();
  const sourcesState = useSourcesState();
  const categoriesState = useCategoriesState();
  const bundle = ledgerState.data;
  const computed = computedState.data;
  const sources = sourcesState.data;
  const categories = categoriesState.data;
  const today = todayISO();
  const currentMonth = monthKeyOf(today);
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([ledgerState, computedState, sourcesState, categoriesState]);

  const creditCardIds = useMemo(
    () => new Set(sources.filter((src) => src.type === "credit_card").map((src) => src.id)),
    [sources],
  );
  const txLike = useTxLike();

  const dataByMonth = new Map((bundle?.yearMonths ?? []).map((month) => [month.month, month]));
  // One batched creditCardSplit for all twelve months; per-row calls rescan the ledger twelve times.
  const cardSplits = useMemo(
    () => creditCardSplitsByMonth(txLike, creditCardIds, today),
    [txLike, creditCardIds, today],
  );
  const compDef = kind === "computed" ? computed.find((column) => column.id === col) : null;
  const liveCategoryIds = new Set(categories.map((category) => category.id));
  const rows = Array.from({ length: 12 }, (_, index) => {
    const month = makeMonthKey(year, index + 1);
    const ledgerMonth = dataByMonth.get(month) ?? null;
    let value: number | null = 0;
    if (!ledgerMonth) value = null;
    else if (kind === "computed") {
      if (!compDef) value = null;
      else {
        try {
          value = evaluateMonthColumn(parseDefinition(JSON.parse(compDef.definition)), ledgerMonth, cardSplits.get(month));
        } catch {
          value = null;
        }
      }
    } else if (kind === "uncategorized") {
      let uncategorized = ledgerMonth.uncategorizedMinor;
      ledgerMonth.byCategory.forEach((amount, categoryId) => {
        if (!liveCategoryIds.has(categoryId)) uncategorized += amount;
      });
      value = uncategorized;
    } else {
      value = ledgerMonth.byCategory.get(col) ?? 0;
    }
    return { month, value };
  });

  const total = rows.reduce((sum, r) => sum + (r.value ?? 0), 0);
  const maxMagnitude = Math.max(1, ...rows.map((row) => Math.abs(row.value ?? 0)));

  if (!dataReady) {
    return (
      <DataGateScreen status={dataStatus} retry={retryData}>
        <Stack.Screen options={{ title: label ?? tr.cashflow.monthDetail }} />
      </DataGateScreen>
    );
  }

  return (
    <Screen width="form">
      <Stack.Screen options={{ title: label ?? tr.cashflow.monthDetail }} />
      <DataStateNotice status={dataStatus} retry={retryData} />
      {bundle == null ? null : (
        <Card padded={false}>
          <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderColor: palette.border, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={[type.label, { color: palette.textSecondary }]}>{tr.cashflow.yearTotal(year)}</Text>
            <Amount minor={total} style={{ maxWidth: "100%" }} />
          </View>
          {rows.map((r, i) => {
            const isCurrent = r.month === currentMonth;
            return (
              <Pressable
                key={r.month}
                accessibilityRole="button"
                accessibilityLabel={`${monthLabel(r.month)} · ${r.value == null ? tr.common.none : formatMinorCompact(r.value)}`}
                onPress={() => router.push(`/cash-flow/${r.month}`)}
                style={(state) => ({
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  minWidth: 0,
                  // The row sets its own min height; the last row has no border to supply it.
                  minHeight: controlSize.minimumTarget,
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.md,
                  borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                  borderColor: palette.border,
                  ...interactionSurface(palette, state, { base: isCurrent ? palette.primarySoft + "55" : "transparent" }),
                })}
              >
                {/* Fixed label column so twelve bars share an origin and can be compared. */}
                <Text style={[type.body, { width: 116, paddingRight: spacing.sm, flexShrink: 0, color: isCurrent ? palette.primaryText : palette.text, fontFamily: isCurrent ? font.bold : font.medium }]}>
                  {monthLabel(r.month)}
                </Text>
                <View style={{ flex: 1, minWidth: 32, marginHorizontal: spacing.sm }}>
                  <MonthValueBar value={r.value} maxMagnitude={maxMagnitude} />
                </View>
                {r.value == null || r.value === 0 ? (
                  <Text style={[type.amountSm, { color: palette.textSecondary }]}>—</Text>
                ) : (
                  <View style={{ minWidth: 0, maxWidth: 132, flexShrink: 1, alignItems: "flex-end" }}>
                    <Amount
                      testID="month-value-amount"
                      minor={r.value}
                      colorized={false}
                      color={r.value < 0 ? palette.negativeText : palette.text}
                      style={{ maxWidth: "100%", fontSize: type.amount.fontSize }}
                    />
                  </View>
                )}
              </Pressable>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}
