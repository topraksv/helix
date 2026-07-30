/** Subscriptions: one due-date overview, then active/passive rule lists. */

import React from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { CalendarDays, Plus, RefreshCw, Repeat } from "lucide-react-native";
import { normalizedMonthlyLoadMinor } from "../../domain/analytics";
import { addDaysISO, todayISO, type ISODate } from "../../domain/dates";
import { formatMinor } from "../../domain/money";
import { shortDateLabel, tr } from "../../i18n/tr";
import { daysBetween, usePersonsState, useSubscriptionsState, useUserId } from "../../data/hooks";
import { combineLiveQueryStatus } from "../../data/live-state";
import { deleteSubscriptionWithExpected, restoreDeletedRule } from "../../data/repo";
import { scheduleSync } from "../../sync/engine";
import { Amount, Button, Card, CardList, DataStateNotice, EmptyState, FadeIn, PanelHeader, Screen, SectionHeader, Spread } from "../../ui/components";
import { RuleRow, type RuleBadge } from "../../ui/rule-row";
import { Logo } from "../../ui/logo";
import { useUndo } from "../../ui/undo";
import { font, radius, spacing, type, useTheme } from "../../ui/theme";
import { appAlert } from "../../ui/dialog";

function SubscriptionScheduleOverview({
  active,
  today,
}: {
  active: ReturnType<typeof useSubscriptionsState>["data"];
  today: ISODate;
}) {
  const { palette } = useTheme();
  const horizonEnd = addDaysISO(today, 31);
  const upcoming = active
    .filter((subscription) => subscription.nextDueDate <= horizonEnd)
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
  const markerDates = [...new Set(upcoming.map((subscription) => subscription.nextDueDate))].slice(0, 7);
  const monthlyTryMinor = active
    .filter((subscription) => subscription.currency === "TRY")
    .reduce(
      (total, subscription) =>
        total + normalizedMonthlyLoadMinor(subscription.amountMinor, subscription.intervalMonths),
      0,
    );
  const autoPayCount = active.filter((subscription) => subscription.autoPay).length;
  const next = upcoming[0] ?? null;

  return (
    <Card>
      <PanelHeader
        icon={CalendarDays}
        title={tr.subs.scheduleOverview}
        description={next ? tr.subs.nextOverview(next.name, shortDateLabel(next.nextDueDate)) : tr.subs.noDueSoon}
        right={monthlyTryMinor > 0 ? (
          <View style={{ alignItems: "flex-end", paddingLeft: spacing.sm }}>
            <Text style={[type.small, { color: palette.textSecondary, fontSize: 10 }]}>{tr.subs.tryMonthlyLoad}</Text>
            <Amount minor={monthlyTryMinor} colorized={false} style={{ fontSize: 13 }} />
          </View>
        ) : undefined}
      />

      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={tr.subs.scheduleOverviewA11y(active.length, upcoming.length, autoPayCount)}
        style={{ height: 56, justifyContent: "center", marginHorizontal: spacing.xs }}
      >
        <View style={{ height: 3, borderRadius: 2, backgroundColor: palette.surfaceStrong, marginHorizontal: 11 }} />
        {markerDates.map((date, index) => {
          const days = Math.max(0, Math.min(31, daysBetween(today, date)));
          return (
            <FadeIn
              key={date}
              style={{
                position: "absolute",
                left: `${(days / 31) * 100}%`,
                top: index % 2 === 0 ? 2 : 28,
                transform: [{ translateX: -11 }],
              }}
            >
              <View
                style={{
                  width: 22,
                  height: 24,
                  borderRadius: 6,
                  backgroundColor: palette.surfaceAlt,
                  borderTopWidth: 5,
                  borderTopColor: palette.primary,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={[type.small, { color: palette.textStrong, fontFamily: font.bold, fontSize: 10 }]}>
                  {Number(date.slice(8, 10))}
                </Text>
              </View>
            </FadeIn>
          );
        })}
      </View>
      <Spread>
        <Text style={[type.small, { color: palette.textSecondary }]}>{tr.subs.today}</Text>
        <Text style={[type.small, { color: palette.textSecondary }]}>{tr.subs.next31Days}</Text>
      </Spread>
      <View style={{ flexDirection: "row", marginTop: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: palette.surfaceAlt }}>
        {[
          [active.length, tr.subs.activeCount],
          [upcoming.length, tr.subs.dueSoonCount],
          [autoPayCount, tr.subs.autoPayCount],
        ].map(([value, label]) => (
          <View key={String(label)} style={{ flex: 1, alignItems: "center" }}>
            <Text style={[type.heading, { color: palette.textStrong, fontFamily: font.bold }]}>{value}</Text>
            <Text style={[type.small, { color: palette.textSecondary, fontSize: 10 }]}>{label}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

export default function SubscriptionsScreen() {
  const userId = useUserId();
  const subscriptionsState = useSubscriptionsState();
  const personsState = usePersonsState();
  const subscriptions = subscriptionsState.data;
  const persons = personsState.data;
  const router = useRouter();
  const undo = useUndo();
  const today = todayISO();
  const liveStates = [subscriptionsState, personsState];
  const dataStatus = combineLiveQueryStatus(liveStates);
  const dataReady = liveStates.every((state) => state.updatedAt != null);
  const retryData = () => {
    subscriptionsState.retry();
    personsState.retry();
  };

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
    const badges: RuleBadge[] = s.isActive
      ? [
          { text: tr.subs.nextDue(shortDateLabel(s.nextDueDate)) },
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
        currency={s.currency}
        amountNote={
          s.intervalMonths > 1
            ? tr.subs.perMonth(formatMinor(normalizedMonthlyLoadMinor(s.amountMinor, s.intervalMonths), s.currency))
            : undefined
        }
        onPress={openEdit}
        onEdit={openEdit}
        onDelete={() => void remove(s.id, s.name)}
      />
    );
  };

  return (
    <Screen title={tr.subs.title}>
      <DataStateNotice status={dataStatus} retry={retryData} />
      {active.length > 0 ? (
        <SubscriptionScheduleOverview active={active} today={today} />
      ) : null}
      <Button icon={Plus} label={tr.subs.add} onPress={() => router.push("/subscription-form")} />
      <View style={{ height: spacing.lg }} />
      {active.length === 0 && watched.length === 0 && passive.length === 0 ? (
        <EmptyState icon={RefreshCw} title={tr.subs.emptyTitle} hint={tr.subs.emptyHint} />
      ) : null}
      {active.length > 0 ? (
        <>
          <SectionHeader>{tr.common.active}</SectionHeader>
          <CardList items={active} keyExtractor={(subscription) => subscription.id} renderItem={renderSub} />
        </>
      ) : null}
      {watched.length > 0 ? (
        <>
          <SectionHeader>{tr.subs.watchedSection}</SectionHeader>
          <CardList items={watched} keyExtractor={(subscription) => subscription.id} renderItem={renderSub} />
        </>
      ) : null}
      {passive.length > 0 ? (
        <>
          <SectionHeader>{tr.common.inactive}</SectionHeader>
          <CardList items={passive} keyExtractor={(subscription) => subscription.id} renderItem={renderSub} />
        </>
      ) : null}
    </Screen>
  );
}
