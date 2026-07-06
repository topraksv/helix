/** Dashboard: catch-up banner, actual vs projected balance (§2.7),
 *  upcoming/late expected items with confirm, distribution, trend. */

import React from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { ArrowDownLeft, ArrowUpRight, CalendarClock, ChevronRight, History, PartyPopper, Plus, TrendingDown, TrendingUp } from "lucide-react-native";
import { distributionForRange, fixedVsVariable } from "../../domain/analytics";
import { projectedBalance } from "../../domain/balance";
import { firstDayOf, lastDayOf, monthKeyOf, monthOf, todayISO, yearOf } from "../../domain/dates";
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
  useRecurringIncomes,
  useSubscriptions,
  useUserId,
} from "../../data/hooks";
import { confirmExpected, revertExpected } from "../../data/repo";
import { scheduleSync } from "../../sync/engine";
import { Badge, Body, Button, Card, EmptyState, Heading, HeroCard, ListRow, Row, Screen, SectionHeader } from "../../ui/components";
import { Donut, Lines, SplitBar, useSeriesColors } from "../../ui/charts";
import { useUndo } from "../../ui/undo";
import { radius, spacing, type, useTheme } from "../../ui/theme";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return tr.dashboard.greetingNight;
  if (hour < 12) return tr.dashboard.greetingMorning;
  if (hour < 18) return tr.dashboard.greetingDay;
  return tr.dashboard.greetingEvening;
}

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
  const { palette } = useTheme();

  // No manual useMemo here: the React Compiler (enabled app-wide) memoizes
  // these derivations automatically and bails out when useMemo is hand-rolled.
  const txLike = toTxLike(allTx, persons);
  const selfPersonId = persons.find((p) => p.isSelf)?.id;

  const pendingItems = expected.filter((e) => e.status === "pending" || e.status === "late");
  const upcoming = pendingItems
    .filter((e) => e.status === "pending" && e.dueDate >= today && daysBetween(today, e.dueDate) <= 14)
    .slice(0, 8);
  const late = pendingItems.filter((e) => e.status === "late" || (e.status === "pending" && e.dueDate < today));

  // Future pending transactions + unpaid expected items (installment tx are
  // already pending transactions, so expected covers only subs/incomes → no double count).
  const projected = bundle
    ? projectedBalance(
        bundle.actualBalanceMinor,
        [
          ...txLike
            .filter((t) => t.personIsSelf && t.status === "pending" && t.effectiveDate > today)
            .map((t) => ({ direction: (t.type === "income" ? "in" : "out") as "in" | "out", amountTryMinor: t.amountTryMinor, date: t.effectiveDate })),
          ...pendingItems
            .filter((e) => e.currency === "TRY" && e.dueDate >= today)
            .map((e) => ({ direction: e.direction, amountTryMinor: e.amountMinor, date: e.dueDate })),
        ],
        lastDayOf(month),
      )
    : null;

  const dist = distributionForRange(txLike, firstDayOf(month), lastDayOf(month), today);
  const fv = fixedVsVariable(txLike, firstDayOf(month), lastDayOf(month), today);

  const donutEntries = [...dist.expenseByCategory.entries()]
    .map(([id, v]) => ({ label: categories.find((c) => c.id === id)?.name ?? tr.common.none, valueMinor: v }))
    .sort((a, b) => b.valueMinor - a.valueMinor);
  const donutRest = donutEntries.slice(7).reduce((sum, e) => sum + e.valueMinor, 0);
  const donutSlices = [
    ...donutEntries.slice(0, 7).map((e, i) => ({ ...e, color: colors[i % colors.length] })),
    ...(donutRest > 0 ? [{ label: tr.common.other, valueMinor: donutRest, color: colors[7] }] : []),
  ];

  const trendMonths = bundle ? bundle.ledger.filter((m) => yearOf(m.month) === year && m.month <= month) : [];
  const trend =
    trendMonths.length >= 2
      ? {
          labels: trendMonths.map((m) => tr.months[monthOf(m.month) - 1].slice(0, 3)),
          series: [
            { label: tr.cashflow.income, color: colors[1], points: trendMonths.map((m) => m.incomeMinor) },
            { label: tr.cashflow.expense, color: colors[5], points: trendMonths.map((m) => m.expenseMinor) },
            { label: "Net", color: colors[0], points: trendMonths.map((m) => m.closingMinor) },
          ],
        }
      : null;

  const nameOf = (e: (typeof expected)[number]) =>
    subscriptions.find((s) => s.id === e.refId)?.name ?? incomes.find((i) => i.id === e.refId)?.name ?? tr.common.paymentFallback;

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

  const projectedDelta = bundle && projected != null ? projected - bundle.actualBalanceMinor : null;

  return (
    <Screen title={greeting()} subtitle={dateLabel(today)}>
      {/* Catch-up banner */}
      {lastEntry.at != null && lastEntry.daysAgo != null && lastEntry.daysAgo >= 1 ? (
        <Pressable onPress={() => router.push("/reconciliation")} accessibilityRole="button">
          <Card style={{ backgroundColor: palette.warning + "14", borderWidth: 0 }}>
            <Row>
              <History size={20} color={palette.warning} />
              <View style={{ flex: 1 }}>
                <Body>{tr.dashboard.lastEntry(dateLabel(lastEntry.at), tr.dashboard.daysAgo(lastEntry.daysAgo))}</Body>
                <Body muted>{tr.dashboard.catchUp}</Body>
              </View>
              <ChevronRight size={18} color={palette.textMuted} />
            </Row>
          </Card>
        </Pressable>
      ) : null}

      {/* Hero balance */}
      {bundle ? (
        <HeroCard>
          <Text style={[type.label, { color: "rgba(255,255,255,0.75)", textTransform: "uppercase", letterSpacing: 1, fontSize: 11 }]}>
            {tr.dashboard.actualBalance}
          </Text>
          <Text style={[type.amountLg, { color: "#FFFFFF", fontSize: 38, marginTop: spacing.xs }]}>
            {formatMinor(bundle.actualBalanceMinor)}
          </Text>
          {projected != null && projectedDelta != null ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                marginTop: spacing.md,
                backgroundColor: "rgba(255,255,255,0.14)",
                alignSelf: "flex-start",
                borderRadius: radius.full,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs + 2,
              }}
            >
              {projectedDelta >= 0 ? (
                <TrendingUp size={14} color="#FFFFFF" />
              ) : (
                <TrendingDown size={14} color="#FFFFFF" />
              )}
              <Text style={[type.amountSm, { color: "#FFFFFF" }]}>
                {tr.dashboard.projectedBalance} · {formatMinor(projected)}
              </Text>
            </View>
          ) : null}
        </HeroCard>
      ) : null}

      {/* Quick actions */}
      <Row style={{ marginBottom: spacing.lg }}>
        <View style={{ flex: 1 }}>
          <Button icon={Plus} label={tr.cashflow.addTransaction} onPress={() => router.push("/transaction")} />
        </View>
        <View style={{ flex: 1 }}>
          <Button icon={History} label={tr.catchup.title} variant="secondary" onPress={() => router.push("/reconciliation")} />
        </View>
      </Row>

      {/* Upcoming payments */}
      <SectionHeader>{tr.dashboard.upcoming}</SectionHeader>
      {(late.length > 0 || upcoming.length > 0) && selfPersonId ? (
        <Card>
          {late.map((e) => (
            <ListRow
              key={e.id}
              icon={e.direction === "in" ? ArrowDownLeft : ArrowUpRight}
              iconColor={palette.negative}
              title={nameOf(e)}
              subtitle={`${dateLabel(e.dueDate)} · ${formatMinor(e.amountMinor, e.currency)}`}
              right={
                <Row gap={spacing.sm}>
                  <Badge text={tr.dashboard.late} tone="negative" />
                  <Button size="sm" label={e.direction === "in" ? tr.dashboard.received : tr.dashboard.markPaid} variant="secondary" onPress={() => void confirm(e)} />
                </Row>
              }
            />
          ))}
          {upcoming.map((e) => (
            <ListRow
              key={e.id}
              icon={e.direction === "in" ? ArrowDownLeft : CalendarClock}
              iconColor={e.direction === "in" ? palette.positive : undefined}
              title={nameOf(e)}
              subtitle={`${tr.dashboard.inDays(daysBetween(today, e.dueDate))} · ${dateLabel(e.dueDate)} · ${formatMinor(e.amountMinor, e.currency)}`}
              right={
                e.dueDate <= today ? (
                  <Button size="sm" label={e.direction === "in" ? tr.dashboard.received : tr.dashboard.markPaid} variant="secondary" onPress={() => void confirm(e)} />
                ) : undefined
              }
            />
          ))}
        </Card>
      ) : (
        <Card>
          <EmptyState icon={PartyPopper} title={tr.dashboard.noUpcoming} />
        </Card>
      )}

      {/* Expense distribution */}
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

      {/* Fixed vs variable */}
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

      {/* Yearly trend */}
      {trend ? (
        <Card>
          <Heading style={{ marginTop: 0 }}>{tr.dashboard.trend}</Heading>
          <Lines width={Math.min(width - spacing.lg * 4, 640)} xLabels={trend.labels} series={trend.series} />
        </Card>
      ) : null}
    </Screen>
  );
}
