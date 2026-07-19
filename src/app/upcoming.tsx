import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { ArrowDownLeft, CalendarClock, CreditCard, PartyPopper } from "lucide-react-native";
import {
  toTxLike,
  useAllTransactionsState,
  useCategoriesState,
  useCreditCardStatementsState,
  usePendingExpectedState,
  usePersonsState,
  useRecurringIncomesState,
  useSourcesState,
  useSubscriptionsState,
} from "../data/hooks";
import { combineLiveQueryStatus } from "../data/live-state";
import { monthKeyOf, todayISO } from "../domain/dates";
import { buildUpcomingTimeline, type UpcomingTimelineItem } from "../domain/upcoming";
import { formatMinor } from "../domain/money";
import { dateLabel, monthLabel, tr } from "../i18n/tr";
import { useSyncStatus } from "../sync/status";
import { Body, Card, DataStateNotice, EmptyState, ListRow, Screen, SectionHeader, StatusPill } from "../ui/components";
import { spacing, useTheme } from "../ui/theme";

export default function UpcomingScreen() {
  const router = useRouter();
  const { palette } = useTheme();
  const sync = useSyncStatus();
  const transactionsState = useAllTransactionsState();
  const categoriesState = useCategoriesState();
  const personsState = usePersonsState();
  const expectedState = usePendingExpectedState();
  const subscriptionsState = useSubscriptionsState();
  const incomesState = useRecurringIncomesState();
  const sourcesState = useSourcesState();
  const statementsState = useCreditCardStatementsState();
  const states = [transactionsState, categoriesState, personsState, expectedState, subscriptionsState, incomesState, sourcesState, statementsState];
  const status = combineLiveQueryStatus(states);
  const categories = categoriesState.data;
  const categoryById = new Map(categories.map((category) => [category.id, category.name]));
  const timeline = buildUpcomingTimeline({
    expected: expectedState.data,
    transactions: toTxLike(transactionsState.data, personsState.data, categories),
    expectedSources: [
      ...subscriptionsState.data.map((subscription) => ({
        id: subscription.id,
        name: subscription.name,
        sourceType: "subscription" as const,
        categoryName: subscription.categoryId ? categoryById.get(subscription.categoryId) ?? null : null,
      })),
      ...incomesState.data.map((income) => ({
        id: income.id,
        name: income.name,
        sourceType: "recurring_income" as const,
        categoryName: income.categoryId ? categoryById.get(income.categoryId) ?? null : null,
      })),
    ],
    categories: categories.map((category) => ({ id: category.id, name: category.name })),
    cards: sourcesState.data.filter((source) => source.type === "credit_card"),
    statements: statementsState.data,
    today: todayISO(),
  });
  const grouped = [...timeline.reduce((groups, item) => {
    const month = monthKeyOf(item.date);
    const current = groups.get(month) ?? [];
    current.push(item);
    groups.set(month, current);
    return groups;
  }, new Map<string, UpcomingTimelineItem[]>()).entries()];

  const retry = () => states.forEach((state) => state.retry());
  const openItem = (item: UpcomingTimelineItem) => {
    if (item.status === "late") return router.push("/reconciliation");
    if (item.kind === "transaction") return router.push({ pathname: "/transaction", params: { id: item.refId } });
    if (item.sourceType === "subscription") return router.push({ pathname: "/subscription-form", params: { id: item.refId } });
    if (item.sourceType === "recurring_income") return router.push("/(tabs)/settings/incomes", { withAnchor: true });
    return router.push("/(tabs)/settings/payment-sources", { withAnchor: true });
  };
  const sourceLabel = (item: UpcomingTimelineItem) => ({
    subscription: tr.subs.title,
    recurring_income: tr.dashboard.expectedIncome,
    scheduled_transaction: tr.dashboard.scheduledTx,
    card_statement: tr.dashboard.cardStatement,
  })[item.sourceType];

  return (
    <Screen>
      <Body muted style={{ marginBottom: spacing.md }}>{tr.upcoming.intro}</Body>
      <DataStateNotice status={status} retry={retry} />
      {sync.state === "error" ? (
        <Card style={{ borderColor: palette.warning }}>
          <Body accessibilityRole="alert" style={{ color: palette.warningText }}>{tr.upcoming.offline}</Body>
        </Card>
      ) : null}
      {status === "loading" || status === "error" ? null : grouped.length === 0 ? (
        <EmptyState icon={PartyPopper} title={tr.dashboard.noUpcoming} hint={tr.dashboard.upcomingHint} />
      ) : grouped.map(([month, items]) => (
        <View key={month}>
          <SectionHeader>{monthLabel(month)}</SectionHeader>
          <Card>
            {items.map((item) => (
              <ListRow
                key={item.key}
                icon={item.direction === "in" ? ArrowDownLeft : item.kind === "card_statement" ? CreditCard : CalendarClock}
                iconColor={item.direction === "in" ? palette.positive : item.status === "late" ? palette.negative : undefined}
                title={item.name ?? item.categoryName ?? tr.common.paymentFallback}
                subtitle={`${sourceLabel(item)} · ${dateLabel(item.date)} · ${formatMinor(item.amountMinor, item.currency)}`}
                chevron
                onPress={() => openItem(item)}
                right={item.status === "late" ? <StatusPill label={tr.dashboard.late} color={palette.negative} foreground={palette.negativeText} /> : undefined}
                stackRightOnNarrow
              />
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}
