import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import PartyPopper from "lucide-react-native/icons/party-popper";
import {
  useAllTransactionsState,
  useCategoriesState,
  useCreditCardStatementsState,
  usePendingExpectedState,
  usePersonsState,
  useRecurringIncomesState,
  useSourcesState,
  useSubscriptionsState,
  useUserId,
  useTxLike,
} from "../data/hooks";
import { combineLiveStates } from "../data/live-state";
import { monthKeyOf, todayISO } from "../domain/dates";
import { buildUpcomingTimeline, type UpcomingTimelineItem } from "../domain/upcoming";
import { formatMinorCompact } from "../domain/money";
import { hasUnknownAmount, isVariableSubscriptionOccurrence } from "../domain/subscriptions";
import { setExpectedAmount } from "../data/repo";
import { dateLabel, monthLabel, shortMonthLabel, tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { devError } from "../services/logger";
import { useSyncStatus } from "../sync/status";
import { appAlert } from "../ui/dialog";
import { ExpectedAmountSheet } from "../ui/expected-amount-sheet";
import { useUndo } from "../ui/undo";
import { Amount, Badge, Body, Card, DataStateNotice, EmptyState, Eyebrow, ListRow, Row, Screen, SectionHeader } from "../ui/components";
import { font, iconSize, radius, spacing, type, useTheme } from "../ui/theme";

export default function UpcomingScreen() {
  const userId = useUserId();
  const router = useRouter();
  const { palette } = useTheme();
  const undo = useUndo();
  const sync = useSyncStatus();
  const transactionsState = useAllTransactionsState();
  const categoriesState = useCategoriesState();
  const personsState = usePersonsState();
  const expectedState = usePendingExpectedState();
  const subscriptionsState = useSubscriptionsState();
  const incomesState = useRecurringIncomesState();
  const sourcesState = useSourcesState();
  const statementsState = useCreditCardStatementsState();
  const { status, retry } = combineLiveStates([transactionsState, categoriesState, personsState, expectedState, subscriptionsState, incomesState, sourcesState, statementsState]);
  const categories = categoriesState.data;
  const txLike = useTxLike();
  const today = todayISO();
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  // Walks every transaction the account has, so it follows the data rather
  // than the render.
  const timeline = useMemo(() => buildUpcomingTimeline({
    expected: expectedState.data,
    transactions: txLike,
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
    today,
  }), [expectedState.data, txLike, subscriptionsState.data, incomesState.data, categories, categoryById, sourcesState.data, statementsState.data, today]);
  const grouped = useMemo(() => [...timeline.reduce((groups, item) => {
    const month = monthKeyOf(item.date);
    const current = groups.get(month) ?? [];
    current.push(item);
    groups.set(month, current);
    return groups;
  }, new Map<string, UpcomingTimelineItem[]>()).entries()], [timeline]);
  const subscriptionById = useMemo(() => new Map(subscriptionsState.data.map((subscription) => [subscription.id, subscription])), [subscriptionsState.data]);
  const [editingAmount, setEditingAmount] = useState<UpcomingTimelineItem | null>(null);

  const isVariableSubscription = (item: UpcomingTimelineItem) =>
    item.kind === "expected"
    && item.expectedId != null
    && isVariableSubscriptionOccurrence({ kind: item.sourceType, refId: item.refId }, subscriptionById);
  const amountUnknown = hasUnknownAmount;

  const openItem = (item: UpcomingTimelineItem) => {
    if (item.status === "late") return router.push("/reconciliation");
    if (isVariableSubscription(item)) return setEditingAmount(item);
    if (item.kind === "transaction") return router.push({ pathname: "/transaction", params: { id: item.refId } });
    if (item.sourceType === "subscription") return router.push({ pathname: "/subscription-form", params: { id: item.refId } });
    if (item.sourceType === "recurring_income") return router.push("/incomes");
    // A card statement asks "what is on this card?", and the answer is
    // Taksitler filtered to it. It used to fall through to the catch-all below
    // and open the payment-source list — the screen for ADDING a card — which
    // answers a question nobody on this row was asking.
    if (item.sourceType === "card_statement") {
      return router.push({ pathname: "/(tabs)/cash-flow/installments", params: { card: item.refId } });
    }
    return router.push("/payment-sources");
  };
  const sourceLabel = (item: UpcomingTimelineItem) => ({
    subscription: tr.subs.title,
    recurring_income: tr.dashboard.expectedIncome,
    scheduled_transaction: tr.dashboard.scheduledTx,
    card_statement: tr.dashboard.cardStatement,
  })[item.sourceType];

  const saveAmount = async (amountMinor: number) => {
    if (!editingAmount?.expectedId) return;
    await setExpectedAmount(userId, editingAmount.expectedId, amountMinor);
    scheduleSync(userId);
    undo.show(tr.subs.amountEntrySaved);
  };

  return (
    <Screen width="form">
      <DataStateNotice status={status} retry={retry} />
      {sync.state === "error" ? (
        <Card tone="warning">
          <Body accessibilityRole="alert" style={{ color: palette.warningText }}>{tr.upcoming.offline}</Body>
        </Card>
      ) : null}
      {editingAmount ? (
        <ExpectedAmountSheet
          currency={editingAmount.currency}
          currentMinor={editingAmount.amountMinor}
          isEstimated={editingAmount.amountIsEstimated === true}
          onSave={saveAmount}
          onClose={() => setEditingAmount(null)}
          onError={(error) => {
            devError("upcoming.amount", error);
            void appAlert(tr.errors.saveFailed);
          }}
        />
      ) : null}
      {status === "loading" || status === "error" ? null : grouped.length === 0 ? (
        <EmptyState icon={PartyPopper} title={tr.dashboard.noUpcoming} hint={tr.dashboard.upcomingHint} />
      ) : grouped.map(([month, items]) => (
        <View key={month}>
          <SectionHeader>{monthLabel(month)}</SectionHeader>
          {/* Every child is a pressable row, so the card gives up its own
              vertical padding and the rows carry it inside their pressables —
              otherwise the first and last row light a band that stops short of
              the card's edge. */}
          <Card rows>
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
                    <Eyebrow>{shortMonthLabel(monthKeyOf(item.date))}</Eyebrow>
                  </View>
                )}
                title={item.name ?? item.categoryName ?? tr.common.paymentFallback}
                subtitle={`${sourceLabel(item)} · ${dateLabel(item.date)}${item.amountIsEstimated ? ` · ${amountUnknown(item) ? tr.subs.unknownAmount : tr.subs.estimatedAmount}` : ""}`}
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
                    {item.amountIsEstimated && !amountUnknown(item) ? <Badge tone="warning" text={tr.subs.estimatedBadge} /> : null}
                    {amountUnknown(item) ? (
                      <Body muted style={[type.amountSm, { textAlign: "right" }]}>{tr.subs.unknownAmount}</Body>
                    ) : (
                      <Amount
                        minor={item.amountMinor}
                        currency={item.currency}
                        colorized={false}
                        color={item.status === "late" ? palette.errorText : palette.text}
                        accessibilityLabel={formatMinorCompact(item.amountMinor, item.currency)}
                        style={[type.amountSm, { textAlign: "right" }]}
                      />
                    )}
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
