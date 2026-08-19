/** Subscriptions: one due-date overview, then active/passive rule lists. */

import React from "react";
import { Text, View } from "react-native";
import { useContentWidth } from "../../ui/viewport";
import { useRouter } from "expo-router";
import Activity from "lucide-react-native/icons/activity";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import MousePointerClick from "lucide-react-native/icons/mouse-pointer-click";
import Plus from "lucide-react-native/icons/plus";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import Repeat from "lucide-react-native/icons/repeat";
import TrendingDown from "lucide-react-native/icons/trending-down";
import TrendingUp from "lucide-react-native/icons/trending-up";
import Wallet from "lucide-react-native/icons/wallet";
import Zap from "lucide-react-native/icons/zap";
import { normalizedMonthlyLoadMinor } from "../../domain/analytics";
import { subscriptionCostSummary } from "../../domain/subscriptions";
import { addDaysISO, daysBetweenISO, todayISO, type ISODate } from "../../domain/dates";
import { formatMinorCompact } from "../../domain/money";
import { shortDateLabel, tr } from "../../i18n/tr";
import { useAllTransactionsState, usePersonsState, usePriceHistoryState, useSubscriptionsState, useUserId } from "../../data/hooks";
import { combineLiveStates } from "../../data/live-state";
import { deleteSubscriptionWithExpected, restoreDeletedRule } from "../../data/repo";
import { scheduleSync } from "../../sync/engine";
import { Button, Card, CardList, DataStateNotice, EmptyState, FadeIn, MetricStrip, PanelHeader, Screen, SectionHeader } from "../../ui/components";
import { RuleRow, type RuleBadge } from "../../ui/rule-row";
import { Logo } from "../../ui/logo";
import { useUndo } from "../../ui/undo";
import { circle, radius, spacing, type, useTheme } from "../../ui/theme";
import { appAlert } from "../../ui/dialog";
import { WorkspaceGrid } from "../../ui/workspace-layout";

function SubscriptionScheduleOverview({
  active,
  today,
}: {
  active: ReturnType<typeof useSubscriptionsState>["data"];
  today: ISODate;
}) {
  const { palette } = useTheme();
  const compact = useContentWidth() < 560;
  const horizonDays = 31;
  const horizonEnd = addDaysISO(today, horizonDays - 1);
  const upcoming = active
    .filter((subscription) => subscription.nextDueDate <= horizonEnd)
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
  const scheduleStops = [...upcoming.reduce((groups, subscription) => {
    const current = groups.get(subscription.nextDueDate) ?? [];
    current.push(subscription);
    groups.set(subscription.nextDueDate, current);
    return groups;
  }, new Map<ISODate, typeof active>()).entries()].map(([date, payments]) => ({ date, payments }));
  const visibleStops = scheduleStops.slice(0, 3);
  const autoPayCount = active.filter((subscription) => subscription.autoPay).length;
  const manualCount = active.length - autoPayCount;
  const nextStop = scheduleStops[0] ?? null;
  const nextDate = nextStop?.date ?? null;
  const nextPayments = nextStop?.payments ?? [];
  const nextCurrencies = new Set(nextPayments.map((subscription) => subscription.currency));
  const nextAmount = nextCurrencies.size === 1 && nextPayments.length > 0
    ? formatMinorCompact(
        nextPayments.reduce((total, subscription) => total + subscription.amountMinor, 0),
        nextPayments[0]!.currency,
      )
    : null;
  const nextDayOffset = nextDate == null ? null : Math.max(0, daysBetweenISO(today, nextDate));
  const nextLabel = nextPayments.length === 1
    ? nextPayments[0]!.name
    : tr.subs.sameDayPayments(nextPayments.length);

  const stopAmount = (payments: typeof active) => {
    const currencies = new Set(payments.map((payment) => payment.currency));
    if (currencies.size !== 1 || payments.length === 0) return null;
    return formatMinorCompact(
      payments.reduce((total, payment) => total + payment.amountMinor, 0),
      payments[0]!.currency,
    );
  };

  return (
    <Card
      style={{
        marginBottom: spacing.lg,
        borderColor: palette.primary + "70",
        borderTopWidth: 3,
        borderTopColor: palette.primary,
      }}
    >
      {/* When, not how much. The monthly figure used to sit here too, computed
          a second time and from a different set of rules than the cost card
          below — two answers to one question, a scroll apart. */}
      <PanelHeader
        icon={CalendarClock}
        title={tr.subs.scheduleOverview}
        description={tr.subs.scheduleOverviewHint}
      />
      <View
        testID="subscription-cycle-summary"
        accessible
        accessibilityRole="image"
        accessibilityLabel={tr.subs.scheduleOverviewA11y(
          active.length,
          upcoming.length,
          autoPayCount,
          manualCount,
        )}
      >
        <View
        style={{
            backgroundColor: palette.surface,
            borderWidth: 1,
            borderColor: palette.primary + "35",
            borderRadius: radius.lg,
            padding: spacing.md,
          }}
        >
          <View
            style={{
              flexDirection: compact ? "column" : "row",
              alignItems: compact ? "stretch" : "center",
              gap: spacing.lg,
            }}
          >
            <FadeIn style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.small, { color: palette.textSecondary }]}>{tr.subs.nextCharge}</Text>
              {nextDate == null ? (
                <Text style={[type.heading, { color: palette.textSecondary, marginTop: spacing.xs }]}>{tr.subs.noUpcoming}</Text>
              ) : (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.md,
                    marginTop: spacing.xs,
                  }}
                >
                  <View
                    accessible={false}
                    style={{
                      width: 54,
                      height: 54,
                      borderRadius: radius.full,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: palette.primarySoft,
                      borderWidth: 1,
                      borderColor: palette.primary + "70",
                    }}
                  >
                    <Text style={[type.amountSm, { color: palette.primaryText, fontSize: nextDayOffset === 0 ? 12 : nextDayOffset === 1 ? 11 : 18 }]}>
                      {nextDayOffset === 0 ? tr.subs.todayShort : nextDayOffset === 1 ? tr.subs.tomorrowShort : nextDayOffset}
                    </Text>
                    {nextDayOffset != null && nextDayOffset > 1 ? (
                      <Text style={[type.small, { color: palette.primaryText, fontSize: type.micro.fontSize }]}>{tr.subs.daysShort}</Text>
                    ) : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.heading, { color: palette.textStrong }]}>{nextLabel}</Text>
                    <Text style={[type.small, { color: palette.textSecondary, marginTop: 2 }]}>
                      {shortDateLabel(nextDate)}{nextAmount ? ` · ${nextAmount}` : ""}
                    </Text>
                  </View>
                </View>
              )}
            </FadeIn>

            <View
              style={{
                minWidth: compact ? 0 : 210,
                flexDirection: "row",
                gap: spacing.sm,
              }}
            >
              <View style={{ flex: 1, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: palette.primarySoft, borderLeftWidth: 3, borderLeftColor: palette.primary }}>
                <Text style={[type.amountSm, { color: palette.textStrong }]}>{upcoming.length}</Text>
                <Text style={[type.small, { color: palette.textSecondary }]}>{tr.subs.next31Days}</Text>
              </View>
              <View style={{ flex: 1, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: palette.secondarySoft, borderLeftWidth: 3, borderLeftColor: palette.secondary }}>
                <Text style={[type.amountSm, { color: palette.textStrong }]}>{autoPayCount}/{active.length}</Text>
                <Text style={[type.small, { color: palette.textSecondary }]}>{tr.subs.automaticShort}</Text>
              </View>
            </View>
          </View>

          {visibleStops.length > 0 ? (
            <View style={{ marginTop: spacing.lg }}>
              <Text style={[type.small, { color: palette.textSecondary, marginBottom: spacing.sm }]}>{tr.subs.paymentPath}</Text>
              <View accessible={false} style={{ flexDirection: "row", alignItems: "flex-start" }}>
                {visibleStops.map((stop, index) => (
                  <FadeIn key={stop.date} delay={index * 90} style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ height: 18, flexDirection: "row", alignItems: "center" }}>
                      <View style={{ flex: 1, height: 2, backgroundColor: index === 0 ? "transparent" : palette.primary + "55" }} />
                      <View style={{ width: 12, height: 12, borderRadius: circle(12), borderWidth: 3, borderColor: palette.primary, backgroundColor: palette.surface }} />
                      <View style={{ flex: 1, height: 2, backgroundColor: index === visibleStops.length - 1 ? "transparent" : palette.primary + "55" }} />
                    </View>
                    <View style={{ paddingHorizontal: spacing.xs, alignItems: "center" }}>
                      <Text style={[type.label, { color: palette.textStrong, textAlign: "center" }]}>{shortDateLabel(stop.date)}</Text>
                      {/* The three stops sit at equal distances because three
                          labels need equal room, so the line cannot be read as
                          a time axis — 8 days and 5 days were drawn the same
                          length. The interval is stated instead of implied. */}
                      <Text style={[type.small, { color: palette.textSecondary, textAlign: "center", marginTop: 1, fontSize: type.caption.fontSize }]}>
                        {tr.dashboard.inDays(Math.max(0, daysBetweenISO(today, stop.date)))}
                      </Text>
                      {index > 0 ? (
                        <Text
                          style={[type.small, { color: palette.textSecondary, textAlign: "center", marginTop: 2 }]}
                        >
                          {stop.payments.length === 1 ? stop.payments[0]!.name : tr.subs.sameDayPayments(stop.payments.length)}
                        </Text>
                      ) : null}
                      {stopAmount(stop.payments) ? (
                        <Text style={[type.amountSm, { color: palette.text, fontSize: type.caption.fontSize, textAlign: "center", marginTop: 2 }]}>{stopAmount(stop.payments)}</Text>
                      ) : null}
                    </View>
                  </FadeIn>
                ))}
              </View>
            </View>
          ) : null}

          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.lg }}>
            <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
              <Zap accessible={false} size={14} color={palette.primaryText} strokeWidth={2.3} />
              <Text style={[type.small, { color: palette.text }]}>{tr.subs.automaticCount(autoPayCount)}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: spacing.xs }}>
              <MousePointerClick accessible={false} size={14} color={palette.secondaryText} strokeWidth={2.3} />
              <Text style={[type.small, { color: palette.textSecondary, textAlign: "right" }]}>{tr.subs.manualCount(manualCount)}</Text>
            </View>
          </View>
        </View>
      </View>
    </Card>
  );
}


/**
 * What the active rules cost, and what their prices have done.
 *
 * Deliberately small, and deliberately built on what is already stored: the
 * monthly figure is the one the schedule card already showed, the annual one
 * restates it, and the changes come from `price_history` rows that
 * `upsertSubscription` has been writing since the table existed with no
 * surface ever reading them. No new store, no new chart engine.
 *
 * Direction is carried by a glyph AND by a word, never by the colour alone.
 */
function SubscriptionCostSummary({
  subscriptions,
  priceHistory,
  today,
}: {
  subscriptions: ReturnType<typeof useSubscriptionsState>["data"];
  priceHistory: ReturnType<typeof usePriceHistoryState>["data"];
  today: ISODate;
}) {
  const { palette } = useTheme();
  const summary = React.useMemo(
    () => subscriptionCostSummary(
      subscriptions.map((subscription) => ({
        id: subscription.id,
        name: subscription.name,
        amountMinor: subscription.amountMinor,
        currency: subscription.currency,
        intervalMonths: subscription.intervalMonths,
        nextDueDate: subscription.nextDueDate,
        isActive: subscription.isActive,
      })),
      priceHistory.map((row) => ({
        subscriptionId: row.subscriptionId,
        amountMinor: row.amountMinor,
        currency: row.currency,
        effectiveFrom: row.effectiveFrom,
      })),
      today,
      normalizedMonthlyLoadMinor,
    ),
    [subscriptions, priceHistory, today],
  );

  return (
    <Card testID="subscription-cost-summary" style={{ marginBottom: spacing.lg }}>
      <PanelHeader icon={Wallet} title={tr.subs.costSummary} description={tr.subs.costSummaryHint} />
      {/* The app's shared rail for a row of labelled figures, rather than two
          hand-tinted boxes that were this screen's alone. One source, one
          place: this card is the only thing that says what the rules cost. */}
      <MetricStrip
        testID="subscription-cost-figures"
        items={[
          { label: tr.subs.monthlyCost, minor: summary.monthlyTryMinor },
          { label: tr.subs.annualCost, minor: summary.annualTryMinor },
        ]}
      />
      {summary.excludedCurrencyCount > 0 ? (
        <Text style={[type.small, { color: palette.textSecondary, marginTop: spacing.sm }]}>
          {tr.subs.costExcluded(summary.excludedCurrencyCount)}
        </Text>
      ) : null}
      {summary.nextRenewal ? (
        <Text style={[type.small, { color: palette.textSecondary, marginTop: spacing.sm }]}>
          {tr.subs.upcomingRenewal(
            summary.nextRenewal.name,
            shortDateLabel(summary.nextRenewal.dueDate),
            formatMinorCompact(summary.nextRenewal.amountMinor, summary.nextRenewal.currency),
          )}
        </Text>
      ) : null}

      <SectionHeader>{tr.subs.recentPriceChanges}</SectionHeader>
      {summary.recentChanges.length === 0 ? (
        <Text style={[type.small, { color: palette.textSecondary }]}>{tr.subs.noPriceChanges}</Text>
      ) : (
        summary.recentChanges.map((change) => {
          const rose = change.toMinor > change.fromMinor;
          const Glyph = rose ? TrendingUp : TrendingDown;
          const ink = rose ? palette.negativeText : palette.positiveText;
          return (
            <View
              key={`${change.subscriptionId}:${change.changedOn}`}
              accessible
              accessibilityLabel={tr.subs.priceChangeRow(
                change.name,
                formatMinorCompact(change.fromMinor, change.currency),
                formatMinorCompact(change.toMinor, change.currency),
                rose ? tr.subs.priceRose : tr.subs.priceFell,
                shortDateLabel(change.changedOn),
              )}
              style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs }}
            >
              <Glyph accessible={false} size={14} color={ink} strokeWidth={2.3} />
              <Text style={[type.small, { flex: 1, minWidth: 0, color: palette.text }]}>{change.name}</Text>
              <Text style={[type.small, { color: palette.textSecondary }]}>
                {formatMinorCompact(change.fromMinor, change.currency)} → {formatMinorCompact(change.toMinor, change.currency)}
              </Text>
              <Text style={[type.small, { color: palette.textSecondary, fontSize: type.micro.fontSize }]}>
                {shortDateLabel(change.changedOn)}
              </Text>
            </View>
          );
        })
      )}
    </Card>
  );
}

export default function SubscriptionsScreen() {
  const userId = useUserId();
  const subscriptionsState = useSubscriptionsState();
  const personsState = usePersonsState();
  const transactionsState = useAllTransactionsState();
  const priceHistoryState = usePriceHistoryState();
  const subscriptions = subscriptionsState.data;
  const persons = personsState.data;
  const router = useRouter();
  const undo = useUndo();
  const today = todayISO();
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([subscriptionsState, personsState, transactionsState]);

  // The date of the last realized charge per rule, so "Sıradaki: 20 Ağu"
  // cannot be read as "nothing has been paid yet" when auto-pay already
  // settled this cycle and only advanced the rule to the next one.
  //
  // Memoized: this walks the whole transaction table, and the screen
  // re-renders on every filter, undo and live-query tick.
  const lastChargeBySubscription = React.useMemo(() => {
    const latest = new Map<string, ISODate>();
    for (const transaction of transactionsState.data) {
      if (!transaction.subscriptionId || transaction.status !== "realized") continue;
      const current = latest.get(transaction.subscriptionId);
      if (!current || transaction.effectiveDate > current) {
        latest.set(transaction.subscriptionId, transaction.effectiveDate);
      }
    }
    return latest;
  }, [transactionsState.data]);

  if (!dataReady) {
    return (
      <Screen title={tr.subs.title}>
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  const activeSubs = subscriptions.filter((s) => s.isActive);
  const selfIds = new Set(persons.filter((person) => person.isSelf).map((person) => person.id));
  const active = activeSubs.filter((subscription) => selfIds.has(subscription.personId));
  const watched = activeSubs.filter((subscription) => !selfIds.has(subscription.personId));
  const passive = subscriptions.filter((s) => !s.isActive);

  const remove = async (id: string, name: string) => {
    try {
      const snapshot = await deleteSubscriptionWithExpected(userId, id);
      scheduleSync(userId);
      if (snapshot) {
        undo.show(`${name} · ${tr.common.deleted}`, () => {
          return restoreDeletedRule(userId, snapshot).then(() => scheduleSync(userId));
        }, "warning");
      }
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
  };

  const renderSub = (s: (typeof subscriptions)[number]) => {
    const inTrial = s.trialEndDate != null && s.trialEndDate >= today;
    const lastCharge = lastChargeBySubscription.get(s.id);
    const amountUnknown = s.amountMode === "variable" && s.amountMinor === 0;
    const badges: RuleBadge[] = s.isActive
      ? [
          { text: tr.subs.nextDue(shortDateLabel(s.nextDueDate)) },
          ...(lastCharge ? [{ text: tr.subs.lastCharged(shortDateLabel(lastCharge)), tone: "muted" as const }] : []),
          ...(s.amountMode === "variable" ? [{ text: tr.subs.variableAmountBadge, tone: "warning" as const, icon: Activity }] : []),
          ...(inTrial ? [{ text: tr.subs.trialEnds(shortDateLabel(s.trialEndDate!)), tone: "warning" as const }] : []),
          ...(s.autoPay ? [{ text: tr.subs.autoPay, tone: "primary" as const, icon: Repeat }] : []),
        ]
      : [{ text: tr.subs.canceled, tone: "error" as const }];
    const openEdit = () => router.push({ pathname: "/subscription-form", params: { id: s.id } });
    return (
      <RuleRow
        key={s.id}
        leading={<Logo name={s.name} domain={s.websiteDomain} size={40} />}
        title={s.name}
        badges={badges}
        amountMinor={s.amountMinor}
        amountUnknown={amountUnknown}
        currency={s.currency}
        amountNote={
          !amountUnknown && s.intervalMonths > 1
            ? tr.subs.perMonth(formatMinorCompact(normalizedMonthlyLoadMinor(s.amountMinor, s.intervalMonths), s.currency))
            : undefined
        }
        onPress={openEdit}
        onEdit={openEdit}
        onDelete={() => void remove(s.id, s.name)}
      />
    );
  };

  return (
    <Screen
      title={tr.subs.title}
      // Every primary tab shares one measure, so moving between them does not
      // move the page. The rows do not stretch to fill it — the groups pair
      // into columns at desktop width instead.
      width="workspace"
      right={<Button icon={Plus} size="sm" label={tr.subs.add} onPress={() => router.push("/subscription-form")} />}
    >
      <DataStateNotice status={dataStatus} retry={retryData} />
      {active.length > 0 ? (
        <>
          <SubscriptionScheduleOverview active={active} today={today} />
          <SubscriptionCostSummary
            subscriptions={subscriptions}
            priceHistory={priceHistoryState.data}
            today={today}
          />
        </>
      ) : null}
      {active.length === 0 && watched.length === 0 && passive.length === 0 ? (
        <EmptyState icon={RefreshCw} title={tr.subs.emptyTitle} hint={tr.subs.emptyHint} />
      ) : null}
      <WorkspaceGrid
        testID="subscription-groups"
        breakpoint={900}
        masses={[active.length, watched.length, passive.length]}
      >
        {active.length > 0 ? (
          <View>
            <SectionHeader>{tr.common.active}</SectionHeader>
            <CardList items={active} keyExtractor={(subscription) => subscription.id} renderItem={renderSub} />
          </View>
        ) : null}
        {watched.length > 0 ? (
          <View>
            <SectionHeader>{tr.subs.watchedSection}</SectionHeader>
            <CardList items={watched} keyExtractor={(subscription) => subscription.id} renderItem={renderSub} />
          </View>
        ) : null}
        {passive.length > 0 ? (
          <View>
            <SectionHeader>{tr.common.inactive}</SectionHeader>
            <CardList items={passive} keyExtractor={(subscription) => subscription.id} renderItem={renderSub} />
          </View>
        ) : null}
      </WorkspaceGrid>
    </Screen>
  );
}
