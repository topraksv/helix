/** Subscriptions: true monthly load (yearly amortized §3.1), active/passive
 *  groups, trial badges, next due dates; tap to edit, swipe-free management. */

import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Plus, RefreshCw, Repeat } from "lucide-react-native";
import { normalizedMonthlyLoadMinor, subscriptionLoadTry } from "../../domain/analytics";
import { todayISO } from "../../domain/dates";
import { formatMinor } from "../../domain/money";
import { lookupRate, useFxRates } from "../../services/fx-fetch";
import { shortDateLabel, tr } from "../../i18n/tr";
import { usePersons, useSubscriptions, useUserId } from "../../data/hooks";
import { deleteSubscriptionWithExpected, restoreDeletedRule } from "../../data/repo";
import { scheduleSync } from "../../sync/engine";
import { Amount, Body, Button, Card, CardList, EmptyState, Screen, SectionHeader, Spread } from "../../ui/components";
import { RuleRow, type RuleBadge } from "../../ui/rule-row";
import { Logo } from "../../ui/logo";
import { useUndo } from "../../ui/undo";
import { spacing } from "../../ui/theme";

export default function SubscriptionsScreen() {
  const userId = useUserId();
  const subscriptions = useSubscriptions();
  const persons = usePersons();
  const router = useRouter();
  const undo = useUndo();
  const today = todayISO();
  // Re-render when FX rates land after a cold start so foreign-currency totals
  // settle on the real TRY value instead of the raw amount.
  useFxRates();

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
    const snapshot = await deleteSubscriptionWithExpected(userId, id);
    scheduleSync(userId);
    if (snapshot) {
      undo.show(`${name} · ${tr.common.deleted}`, () => {
        void restoreDeletedRule(userId, snapshot).then(() => scheduleSync(userId));
      }, "warning");
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
      : [{ text: tr.subs.canceled, tone: "negative" as const }];
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
      <Card>
        <Spread>
          <View>
            <Body muted>{personalLoad.missingRates > 0 ? tr.subs.knownMonthlyLoad : tr.subs.monthlyLoad}</Body>
            <Amount minor={personalLoad.totalMinor} large colorized={false} />
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Body muted>{tr.subs.yearlyTotal}</Body>
            <Amount minor={personalLoad.totalMinor * 12} colorized={false} />
          </View>
        </Spread>
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
