import React from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, PartyPopper } from "lucide-react-native";
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
import { formatMinorCompact } from "../domain/money";
import { dateLabel, monthLabel, shortMonthLabel, tr } from "../i18n/tr";
import { useSyncStatus } from "../sync/status";
import { Amount, Badge, Body, Card, DataStateNotice, EmptyState, ListRow, Row, Screen, SectionHeader } from "../ui/components";
import { font, iconSize, radius, spacing, type, useTheme } from "../ui/theme";

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
    if (item.sourceType === "recurring_income") return router.push("/incomes");
    return router.push("/payment-sources");
  };
  const sourceLabel = (item: UpcomingTimelineItem) => ({
    subscription: tr.subs.title,
    recurring_income: tr.dashboard.expectedIncome,
    scheduled_transaction: tr.dashboard.scheduledTx,
    card_statement: tr.dashboard.cardStatement,
  })[item.sourceType];

  return (
    <Screen width="form">
      <DataStateNotice status={status} retry={retry} />
      {sync.state === "error" ? (
        <Card tone="warning">
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
                onPress={() => openItem(item)}
                leading={(
                  <View
                    accessible={false}
                    style={{
                      width: 42,
                      height: 42,
                      flexShrink: 0,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: radius.sm,
                      backgroundColor: item.status === "late"
                        ? palette.error + "14"
                        : item.direction === "in"
                          ? palette.positive + "14"
                          : palette.surfaceAlt,
                    }}
                  >
                    <Text style={[type.label, { color: item.status === "late" ? palette.errorText : palette.textStrong, fontFamily: font.semibold }]}>
                      {Number(item.date.slice(8, 10))}
                    </Text>
                    <Text style={[type.small, { color: palette.textSecondary, fontFamily: font.semibold, fontSize: type.micro.fontSize, textTransform: "uppercase" }]}>
                      {shortMonthLabel(monthKeyOf(item.date))}
                    </Text>
                  </View>
                )}
                title={item.name ?? item.categoryName ?? tr.common.paymentFallback}
                subtitle={`${sourceLabel(item)} · ${dateLabel(item.date)}`}
                /* The amount is a column, not the tail of a sentence. Buried in
                   the subtitle it left the middle of every row empty while the
                   figures it should be scanned against stayed unaligned. Same
                   string, same value — read down instead of across. */
                /* One line, in the order the eye needs it: the state that
                   qualifies the figure, the figure, then the way in. The
                   amount reads last because it is what you scan down the
                   column, and it takes the warning colour when it is late so
                   the state is not carried by a chip alone. */
                right={(
                  <Row gap={spacing.sm}>
                    {item.status === "late" ? <Badge tone="error" text={tr.dashboard.late} /> : null}
                    <Amount
                      minor={item.amountMinor}
                      currency={item.currency}
                      colorized={false}
                      color={item.status === "late" ? palette.errorText : palette.text}
                      accessibilityLabel={formatMinorCompact(item.amountMinor, item.currency)}
                      style={[type.amountSm, { textAlign: "right" }]}
                    />
                    <ChevronRight accessible={false} size={iconSize.control} color={palette.textSecondary} />
                  </Row>
                )}
              />
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}
