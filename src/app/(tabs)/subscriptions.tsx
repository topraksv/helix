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
import { Amount, Button, Card, CardList, DataStateNotice, EmptyState, PanelHeader, Screen, SectionHeader, Spread } from "../../ui/components";
import { RuleRow, type RuleBadge } from "../../ui/rule-row";
import { Logo } from "../../ui/logo";
import { useUndo } from "../../ui/undo";
import { spacing, type, useTheme } from "../../ui/theme";
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
  const horizonEnd = addDaysISO(today, 31);
  const upcoming = active
    .filter((subscription) => subscription.nextDueDate <= horizonEnd)
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
  const weeklyDensity = [0, 0, 0, 0, 0];
  for (const subscription of upcoming) {
    const days = Math.max(0, Math.min(31, daysBetween(today, subscription.nextDueDate)));
    const index = Math.min(4, Math.floor(days / 7));
    weeklyDensity[index] = (weeklyDensity[index] ?? 0) + 1;
  }
  const peakDensity = Math.max(1, ...weeklyDensity);
  const monthlyTryMinor = active
    .filter((subscription) => subscription.currency === "TRY")
    .reduce(
      (total, subscription) =>
        total + normalizedMonthlyLoadMinor(subscription.amountMinor, subscription.intervalMonths),
      0,
    );
  const autoPayCount = active.filter((subscription) => subscription.autoPay).length;
  const manualCount = active.length - autoPayCount;

  return (
    <Card style={{ marginBottom: spacing.lg }}>
      <PanelHeader
        icon={CalendarDays}
        title={tr.subs.scheduleOverview}
        description={tr.subs.scheduleOverviewHint}
        right={(
          <View style={{ alignItems: "flex-end", paddingLeft: spacing.sm }}>
            <Text style={[type.small, { color: palette.textSecondary, fontSize: 10 }]}>{tr.subs.tryMonthlyLoad}</Text>
            <Amount minor={monthlyTryMinor} colorized={false} style={{ fontSize: 13 }} />
          </View>
        )}
      />
      <View
        testID="subscription-cycle-summary"
        accessible
        accessibilityRole="image"
        accessibilityLabel={tr.subs.scheduleOverviewA11y(active.length, upcoming.length, autoPayCount, weeklyDensity)}
      >
        <View
          style={{ height: 92, flexDirection: "row", alignItems: "flex-end", gap: spacing.sm }}
        >
          {weeklyDensity.map((count, index) => (
            <View
              key={index}
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "flex-end",
                gap: spacing.xs,
              }}
            >
              {count > 0 ? (
                <Text style={[type.small, { color: palette.textStrong, fontSize: 10 }]}>{count}</Text>
              ) : null}
              <View
                style={{
                  width: "100%",
                  maxWidth: 64,
                  height: count === 0 ? 4 : Math.max(14, (count / peakDensity) * 58),
                  backgroundColor: count === 0 ? palette.surfaceStrong : palette.primary,
                  borderRadius: 7,
                }}
              />
              <Text style={[type.small, { color: palette.textSecondary, fontSize: 10 }]}>
                {tr.subs.dayWindow(Math.min(31, (index + 1) * 7))}
              </Text>
            </View>
          ))}
        </View>
        <Spread style={{ marginTop: spacing.sm, gap: spacing.md }}>
          <Text style={[type.small, { color: palette.textSecondary }]}>{tr.subs.dueSummary(upcoming.length)}</Text>
          <Text style={[type.small, { color: palette.textSecondary, textAlign: "right" }]}>
            {tr.subs.automaticCoverage(autoPayCount, manualCount)}
          </Text>
        </Spread>
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
    <Screen
      title={tr.subs.title}
      maxWidth={1080}
      right={<Button icon={Plus} size="sm" label={tr.subs.add} onPress={() => router.push("/subscription-form")} />}
    >
      <DataStateNotice status={dataStatus} retry={retryData} />
      {active.length > 0 ? (
        <SubscriptionScheduleOverview active={active} today={today} />
      ) : null}
      {active.length === 0 && watched.length === 0 && passive.length === 0 ? (
        <EmptyState icon={RefreshCw} title={tr.subs.emptyTitle} hint={tr.subs.emptyHint} />
      ) : null}
      <WorkspaceGrid testID="subscription-groups">
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
