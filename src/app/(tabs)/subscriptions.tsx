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
import { subscriptionCostSummary, variableAmountBand } from "../../domain/subscriptions";
import { addDaysISO, daysBetweenISO, todayISO, type ISODate } from "../../domain/dates";
import { formatMinorCompact } from "../../domain/money";
import { shortDateLabel, tr } from "../../i18n/tr";
import { useAllTransactionsState, usePersonsState, usePriceHistoryState, useSubscriptionsState, useUserId } from "../../data/hooks";
import { combineLiveStates } from "../../data/live-state";
import { deleteSubscriptionWithExpected, restoreDeletedRule } from "../../data/repo";
import { scheduleSync } from "../../sync/engine";
import { Button, Card, CardList, DataGateScreen, DataStateNotice, EmptyState, FadeIn, MetricStrip, PanelHeader, Screen, SectionHeader } from "../../ui/components";
import { RuleRow, type RuleBadge } from "../../ui/rule-row";
import { Logo } from "../../ui/logo";
import { useUndo } from "../../ui/undo";
import { useScreenVisit } from "../../ui/motion-primitives";
import { circle, font, radius, spacing, type, useTheme } from "../../ui/theme";
import { appAlert } from "../../ui/dialog";
import { WorkspaceGrid } from "../../ui/workspace-layout";

function SubscriptionScheduleOverview({
  active,
  priceHistory,
  today,
}: {
  active: ReturnType<typeof useSubscriptionsState>["data"];
  priceHistory: ReturnType<typeof usePriceHistoryState>["data"];
  today: ISODate;
}) {
  const { palette } = useTheme();
  const visit = useScreenVisit();
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
  // A variable rule stores 0 until its invoice is entered. Summing that zero
  // into a stop printed "₺0,00" beside a bill that is simply not known yet —
  // the one thing `occurrenceAmountText` exists to prevent, bypassed because
  // this card sums rules rather than occurrences. When history has samples the
  // band is shown instead, which is more than either previous answer gave.
  const historyBySubscription = React.useMemo(() => {
    const grouped = new Map<string, typeof priceHistory>();
    for (const row of priceHistory) {
      const bucket = grouped.get(row.subscriptionId);
      if (bucket) bucket.push(row);
      else grouped.set(row.subscriptionId, [row]);
    }
    return grouped;
  }, [priceHistory]);

  const stopAmountText = React.useCallback((payments: typeof active): string | null => {
    const currencies = new Set(payments.map((payment) => payment.currency));
    if (currencies.size !== 1 || payments.length === 0) return null;
    const currency = payments[0]!.currency;
    const unknown = payments.filter((payment) => payment.amountMode === "variable" && payment.amountMinor === 0);
    const known = payments.reduce((total, payment) => total + payment.amountMinor, 0);
    if (unknown.length === 0) return formatMinorCompact(known, currency);
    if (unknown.length === payments.length && payments.length === 1) {
      const band = variableAmountBand(historyBySubscription.get(payments[0]!.id) ?? [], currency);
      if (!band) return tr.subs.unknownAmount;
      return band.minMinor === band.maxMinor
        ? tr.subs.expectedAround(formatMinorCompact(band.minMinor, currency))
        : tr.subs.expectedBand(formatMinorCompact(band.minMinor, currency), formatMinorCompact(band.maxMinor, currency));
    }
    // Mixed stop: what is known is a floor, and saying so beats both a wrong
    // total and no figure at all.
    return tr.subs.atLeastAmount(formatMinorCompact(known, currency));
  }, [historyBySubscription]);

  const nextAmount = stopAmountText(nextPayments);
  const nextDayOffset = nextDate == null ? null : Math.max(0, daysBetweenISO(today, nextDate));
  const nextLabel = nextPayments.length === 1
    ? nextPayments[0]!.name
    : tr.subs.sameDayPayments(nextPayments.length);

  const stopAmount = stopAmountText;

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
                    {/* One size, whatever the disc says. It used to pick
                        between 18, 12 and 11 depending on whether the answer
                        was a number, "Bugün" or "Yarın" — three type sizes for
                        one control, none of them on the scale, and an 11pt
                        word lost inside a 54pt circle. A word is a word: it
                        takes the label role, a figure takes the figure role,
                        and both fill the same disc. */}
                    {nextDayOffset === 0 || nextDayOffset === 1 ? (
                      <Text style={[type.label, { color: palette.primaryText, fontFamily: font.semibold, textAlign: "center" }]}>
                        {nextDayOffset === 0 ? tr.subs.todayShort : tr.subs.tomorrowShort}
                      </Text>
                    ) : (
                      <Text style={[type.heading, { color: palette.primaryText, fontVariant: ["tabular-nums"] }]}>
                        {nextDayOffset}
                      </Text>
                    )}
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
                <Text style={[type.heading, { color: palette.textStrong, fontVariant: ["tabular-nums"] }]}>{upcoming.length}</Text>
                <Text style={[type.small, { color: palette.textSecondary }]}>{tr.subs.next31Days}</Text>
              </View>
              <View style={{ flex: 1, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: palette.secondarySoft, borderLeftWidth: 3, borderLeftColor: palette.secondary }}>
                <Text style={[type.heading, { color: palette.textStrong, fontVariant: ["tabular-nums"] }]}>{autoPayCount}/{active.length}</Text>
                <Text style={[type.small, { color: palette.textSecondary }]}>{tr.subs.automaticShort}</Text>
              </View>
            </View>
          </View>

          {visibleStops.length > 0 ? (
            <View style={{ marginTop: spacing.lg }}>
              <Text style={[type.small, { color: palette.textSecondary, marginBottom: spacing.sm }]}>{tr.subs.paymentPath}</Text>
              <View accessible={false} style={{ flexDirection: "row", alignItems: "flex-start" }}>
                {/* `replayToken={visit}` replays these on return, like the
                    charts beside them. `FadeIn` is mount-only by default and
                    must stay that way — making every one of them visit-aware
                    would re-animate whole screens on every glance back, which
                    is the reload feeling `useCountUp` was just cured of. Only
                    the stops opt in, because they are this card's one piece of
                    motion and the thing the eye came back for. */}
                {visibleStops.map((stop, index) => (
                  <FadeIn key={stop.date} replayToken={visit} delay={index * 90} style={{ flex: 1, minWidth: 0 }}>
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
        amountMode: subscription.amountMode,
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
      {/* A variable bill with no invoice yet enters this total as zero. The
          total said ₺1.853,23 with an electricity bill inside it and nothing
          on screen admitted the omission — the same reason foreign-currency
          rules are declared one line above. */}
      {summary.unknownAmountCount > 0 ? (
        <Text style={[type.small, { color: palette.textSecondary, marginTop: spacing.sm }]}>
          {tr.subs.costUnknownExcluded(summary.unknownAmountCount)}
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
    return <DataGateScreen status={dataStatus} retry={retryData} title={tr.subs.title} />;
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
          <SubscriptionScheduleOverview active={active} priceHistory={priceHistoryState.data} today={today} />
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
