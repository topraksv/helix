/** Dashboard: catch-up banner, actual vs projected balance (§2.7),
 *  upcoming/late expected items with confirm, distribution, trend. */

import React, { useMemo } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { distributionForRange, fixedVsVariable } from "../../domain/analytics";
import { projectedBalance } from "../../domain/balance";
import { firstDayOf, lastDayOf, makeMonthKey, monthKeyOf, monthOf, todayISO, yearOf } from "../../domain/dates";
import { formatMinor } from "../../domain/money";
import { dateLabel, monthLabel, tr } from "../../i18n/tr";
import {
  daysBetween,
  toTxLike,
  useAllTransactions,
  useCategories,
  useLastEntryInfo,
  useLedger,
  usePendingExpected,
  usePersons,
  useUserId,
} from "../../data/hooks";
import { confirmExpected, revertExpected } from "../../data/repo";
import { useRecurringIncomes, useSubscriptions } from "../../data/hooks";
import { scheduleSync } from "../../sync/engine";
import { Amount, Badge, Body, Button, Card, Divider, EmptyState, Heading, Row, Screen, Spread, Title } from "../../ui/components";
import { Donut, Lines, SplitBar, useSeriesColors } from "../../ui/charts";
import { useUndo } from "../../ui/undo";
import { spacing } from "../../ui/theme";

export default function DashboardScreen() {
  const userId = useUserId();
  const today = todayISO();
  const year = yearOf(today);
  const month = monthKeyOf(today);
  const bundle = useLedger(year);
  const categories = useCategories();
  const persons = usePersons();
  const allTx = useAllTransactions();
  const expected = usePendingExpected();
  const subscriptions = useSubscriptions();
  const incomes = useRecurringIncomes();
  const lastEntry = useLastEntryInfo();
  const router = useRouter();
  const colors = useSeriesColors();
  const undo = useUndo();
  const { width } = useWindowDimensions();

  const txLike = useMemo(() => toTxLike(allTx, persons), [allTx, persons]);
  const selfPersonId = persons.find((p) => p.isSelf)?.id;
  const selfIds = useMemo(() => new Set(persons.filter((p) => p.isSelf).map((p) => p.id)), [persons]);

  const pendingItems = expected.filter((e) => e.status === "pending" || e.status === "late");
  const upcoming = pendingItems
    .filter((e) => e.status === "pending" && e.dueDate >= today && daysBetween(today, e.dueDate) <= 14)
    .slice(0, 8);
  const late = pendingItems.filter((e) => e.status === "late" || (e.status === "pending" && e.dueDate < today));

  const projected = useMemo(() => {
    if (!bundle) return null;
    const horizon = lastDayOf(month);
    // Future pending transactions + unpaid expected items (installment tx are
    // already pending transactions, so expected covers only subs/incomes → no double count).
    const flows = [
      ...txLike
        .filter((t) => t.personIsSelf && t.status === "pending" && t.effectiveDate > today)
        .map((t) => ({ direction: (t.type === "income" ? "in" : "out") as "in" | "out", amountTryMinor: t.amountTryMinor, date: t.effectiveDate })),
      ...pendingItems
        .filter((e) => e.currency === "TRY" && e.dueDate >= today)
        .map((e) => ({ direction: e.direction, amountTryMinor: e.amountMinor, date: e.dueDate })),
    ];
    return projectedBalance(bundle.actualBalanceMinor, flows, horizon);
  }, [bundle, txLike, pendingItems, today, month]);

  const dist = useMemo(() => distributionForRange(txLike, firstDayOf(month), lastDayOf(month), today), [txLike, month, today]);
  const fv = useMemo(() => fixedVsVariable(txLike, firstDayOf(month), lastDayOf(month), today), [txLike, month, today]);

  const donutSlices = useMemo(() => {
    const entries = [...dist.expenseByCategory.entries()]
      .map(([id, v]) => ({ label: categories.find((c) => c.id === id)?.name ?? tr.common.none, valueMinor: v }))
      .sort((a, b) => b.valueMinor - a.valueMinor);
    const top = entries.slice(0, 7);
    const rest = entries.slice(7).reduce((sum, e) => sum + e.valueMinor, 0);
    const slices = top.map((e, i) => ({ ...e, color: colors[i % colors.length] }));
    if (rest > 0) slices.push({ label: "Diğer", valueMinor: rest, color: colors[7] });
    return slices;
  }, [dist, categories, colors]);

  const trend = useMemo(() => {
    if (!bundle) return null;
    const months = bundle.ledger.filter((m) => yearOf(m.month) === year && m.month <= month);
    if (months.length < 2) return null;
    return {
      labels: months.map((m) => tr.months[monthOf(m.month) - 1].slice(0, 3)),
      series: [
        { label: tr.cashflow.income, color: colors[1], points: months.map((m) => m.incomeMinor) },
        { label: tr.cashflow.expense, color: colors[5], points: months.map((m) => m.expenseMinor) },
        { label: "Net", color: colors[0], points: months.map((m) => m.closingMinor) },
      ],
    };
  }, [bundle, year, month, colors]);

  const nameOf = (e: (typeof expected)[number]) =>
    subscriptions.find((s) => s.id === e.refId)?.name ?? incomes.find((i) => i.id === e.refId)?.name ?? "Ödeme";

  const confirm = async (e: (typeof expected)[number]) => {
    if (!selfPersonId) return;
    const sub = subscriptions.find((s) => s.id === e.refId);
    const income = incomes.find((i) => i.id === e.refId);
    await confirmExpected(userId, e.id, {
      personId: sub?.personId ?? income?.personId ?? selfPersonId,
      categoryId: sub?.categoryId ?? income?.categoryId ?? null,
    });
    scheduleSync(userId);
    undo.show(`${nameOf(e)} ✓`, () => void revertExpected(userId, e.id));
  };

  return (
    <Screen>
      <Title>{tr.tabs.dashboard}</Title>

      {lastEntry.at != null && lastEntry.daysAgo != null && lastEntry.daysAgo >= 1 ? (
        <Pressable onPress={() => router.push("/mutabakat")} accessibilityRole="button">
          <Card style={{ borderLeftWidth: 3, borderLeftColor: colors[2] }}>
            <Body>{tr.dashboard.lastEntry(dateLabel(lastEntry.at), tr.dashboard.daysAgo(lastEntry.daysAgo))}</Body>
            <Body muted>{tr.dashboard.catchUp} →</Body>
          </Card>
        </Pressable>
      ) : null}

      {bundle ? (
        <Card>
          <Spread>
            <View>
              <Body muted>{tr.dashboard.actualBalance}</Body>
              <Amount minor={bundle.actualBalanceMinor} large />
            </View>
            {projected != null ? (
              <View style={{ alignItems: "flex-end" }}>
                <Body muted>{tr.dashboard.projectedBalance}</Body>
                <Amount minor={projected} />
                <Body muted>({monthLabel(month)})</Body>
              </View>
            ) : null}
          </Spread>
        </Card>
      ) : null}

      {(late.length > 0 || upcoming.length > 0) && selfPersonId ? (
        <Card>
          <Heading style={{ marginTop: 0 }}>{tr.dashboard.upcoming}</Heading>
          {late.map((e) => (
            <View key={e.id}>
              <Spread style={{ paddingVertical: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Row gap={spacing.sm}>
                    <Badge text={tr.dashboard.late} tone="negative" />
                    <Body>{nameOf(e)}</Body>
                  </Row>
                  <Body muted>{dateLabel(e.dueDate)} · {formatMinor(e.amountMinor, e.currency)}</Body>
                </View>
                <Button label={e.direction === "in" ? tr.dashboard.received : tr.dashboard.markPaid} variant="secondary" onPress={() => void confirm(e)} />
              </Spread>
              <Divider />
            </View>
          ))}
          {upcoming.map((e) => (
            <View key={e.id}>
              <Spread style={{ paddingVertical: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Body>
                    {e.direction === "in" ? "↓ " : ""}
                    {nameOf(e)}
                  </Body>
                  <Body muted>
                    {tr.dashboard.inDays(daysBetween(today, e.dueDate))} · {dateLabel(e.dueDate)} · {formatMinor(e.amountMinor, e.currency)}
                  </Body>
                </View>
                {e.dueDate <= today ? (
                  <Button label={e.direction === "in" ? tr.dashboard.received : tr.dashboard.markPaid} variant="secondary" onPress={() => void confirm(e)} />
                ) : null}
              </Spread>
              <Divider />
            </View>
          ))}
        </Card>
      ) : (
        <Card>
          <Body muted>{tr.dashboard.noUpcoming}</Body>
        </Card>
      )}

      {donutSlices.length > 0 ? (
        <Card>
          <Heading style={{ marginTop: 0 }}>
            {tr.dashboard.distribution} · {monthLabel(month)}
          </Heading>
          <Donut slices={donutSlices} />
          {dist.transferTotalMinor > 0 ? (
            <Body muted style={{ marginTop: spacing.sm }}>
              {tr.dashboard.investmentAside}: {formatMinor(dist.transferTotalMinor)}
            </Body>
          ) : null}
        </Card>
      ) : null}

      {fv.fixedMinor + fv.variableMinor > 0 ? (
        <Card>
          <Heading style={{ marginTop: 0 }}>{tr.dashboard.fixedVsVariable}</Heading>
          <SplitBar
            parts={[
              { label: tr.dashboard.fixed, valueMinor: fv.fixedMinor, color: colors[0] },
              { label: tr.dashboard.variable, valueMinor: fv.variableMinor, color: colors[2] },
            ]}
          />
        </Card>
      ) : null}

      {trend ? (
        <Card>
          <Heading style={{ marginTop: 0 }}>{tr.dashboard.trend}</Heading>
          <Lines width={Math.min(width - spacing.lg * 4, 640)} xLabels={trend.labels} series={trend.series} />
        </Card>
      ) : null}
    </Screen>
  );
}
