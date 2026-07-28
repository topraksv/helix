/** Subscriptions: true monthly load (yearly amortized §3.1), active/passive
 *  groups, trial badges, next due dates; tap to edit, swipe-free management. */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Plus, RefreshCw, Repeat } from "lucide-react-native";
import { normalizedMonthlyLoadMinor, subscriptionLoadTry } from "../../domain/analytics";
import { todayISO } from "../../domain/dates";
import { formatMinor } from "../../domain/money";
import { lookupRate, useFxRates } from "../../services/fx-fetch";
import { shortDateLabel, tr } from "../../i18n/tr";
import { usePersonsState, useSubscriptionsState, useUserId } from "../../data/hooks";
import { combineLiveQueryStatus } from "../../data/live-state";
import { deleteSubscriptionWithExpected, restoreDeletedRule } from "../../data/repo";
import { scheduleSync } from "../../sync/engine";
import { Amount, Body, Button, Card, CardList, DataStateNotice, EmptyState, Screen, SectionHeader, Spread } from "../../ui/components";
import { RuleRow, type RuleBadge } from "../../ui/rule-row";
import { Logo } from "../../ui/logo";
import { useUndo } from "../../ui/undo";
import { font, radius, spacing, type, useTheme } from "../../ui/theme";
import { appAlert } from "../../ui/dialog";

function SubscriptionOrbit({ count }: { count: number }) {
  const { palette } = useTheme();
  return (
    <View
      accessible={false}
      style={{
        width: 82,
        height: 82,
        flexShrink: 0,
        borderRadius: radius.lg,
        backgroundColor: palette.surfaceAlt,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View style={{ position: "absolute", width: 60, height: 60, borderRadius: 30, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.tertiary + "90" }} />
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index / 12) * Math.PI * 2 - Math.PI / 2;
        return (
          <View
            key={index}
            style={{
              position: "absolute",
              width: index < Math.min(count, 12) ? 5 : 3,
              height: index < Math.min(count, 12) ? 5 : 3,
              borderRadius: 3,
              backgroundColor: index < Math.min(count, 12) ? palette.primary : palette.border,
              left: 39 + Math.cos(angle) * 29,
              top: 39 + Math.sin(angle) * 29,
            }}
          />
        );
      })}
      <View style={{ width: 38, height: 38, borderRadius: 14, backgroundColor: palette.primarySoft, alignItems: "center", justifyContent: "center" }}>
        <Repeat accessible={false} size={19} color={palette.primary} />
      </View>
    </View>
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
  const { palette } = useTheme();
  const today = todayISO();
  // Re-render when FX rates land after a cold start so foreign-currency totals
  // settle on the real TRY value instead of the raw amount.
  useFxRates();
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
  const load = (rows: typeof activeSubs) => subscriptionLoadTry(
    rows,
    (currency) => lookupRate(userId, currency)?.rate.rateTry ?? null,
  );
  const personalLoad = load(active);
  const watchedLoad = load(watched);

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
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <SubscriptionOrbit count={active.length} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Body muted>{personalLoad.missingRates > 0 ? tr.subs.knownMonthlyLoad : tr.subs.monthlyLoad}</Body>
            <Amount minor={personalLoad.totalMinor} large colorized={false} />
            <Text style={[type.small, { color: palette.primaryText, fontFamily: font.semibold, marginTop: spacing.xs }]}>
              {tr.subs.activeCount(active.length)}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Body muted>{tr.subs.yearlyTotal}</Body>
            <Amount minor={personalLoad.totalMinor * 12} colorized={false} />
          </View>
        </View>
      </Card>
      {personalLoad.missingRates > 0 ? <Body muted>{tr.subs.fxExcluded(personalLoad.missingRates)}</Body> : null}

      {watched.length > 0 ? (
        <Card>
          <Spread>
            <View>
              <Body muted>{tr.subs.watchedMonthlyLoad}</Body>
              <Amount minor={watchedLoad.totalMinor} large colorized={false} />
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Body muted>{tr.subs.watchedYearlyTotal}</Body>
              <Amount minor={watchedLoad.totalMinor * 12} colorized={false} />
            </View>
          </Spread>
          <Body muted style={{ marginTop: spacing.sm }}>{tr.subs.watchedBalanceHint}</Body>
          {watchedLoad.missingRates > 0 ? <Body muted style={{ marginTop: spacing.xs }}>{tr.subs.fxExcluded(watchedLoad.missingRates)}</Body> : null}
        </Card>
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
