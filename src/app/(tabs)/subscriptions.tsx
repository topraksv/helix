/** Subscriptions: true monthly load (yearly amortized §3.1), active/passive
 *  groups, trial badges, next due dates; tap to edit, swipe-free management. */

import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Pencil, Plus, RefreshCw, Repeat, Trash2 } from "lucide-react-native";
import { normalizedMonthlyLoadMinor, subscriptionLoadTry } from "../../domain/analytics";
import { todayISO } from "../../domain/dates";
import { formatMinor } from "../../domain/money";
import { lookupRate, useFxRates } from "../../services/fx-fetch";
import { dateLabel, tr } from "../../i18n/tr";
import { usePersons, useSubscriptions, useUserId } from "../../data/hooks";
import { deleteSubscriptionWithExpected, restoreDeletedRule } from "../../data/repo";
import { scheduleSync } from "../../sync/engine";
import { Amount, Body, Button, Card, EmptyState, IconButton, ListRow, Row, Screen, SectionHeader, Spread } from "../../ui/components";
import { Logo } from "../../ui/logo";
import { useUndo } from "../../ui/undo";
import { spacing, useTheme } from "../../ui/theme";

export default function SubscriptionsScreen() {
  const userId = useUserId();
  const subscriptions = useSubscriptions();
  const persons = usePersons();
  const router = useRouter();
  const undo = useUndo();
  const today = todayISO();
  const { palette } = useTheme();
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
    return (
      <ListRow
        key={s.id}
        leading={<Logo name={s.name} domain={s.websiteDomain} size={40} />}
        title={s.name}
        subtitle={
          (s.isActive ? tr.subs.nextDue(dateLabel(s.nextDueDate)) : tr.subs.canceled) +
          (inTrial ? ` · ${tr.subs.trialEnds(dateLabel(s.trialEndDate!))}` : "")
        }
        onPress={() => router.push({ pathname: "/subscription-form", params: { id: s.id } })}
        right={
          // alignItems:center (Row default) keeps the edit/delete controls
          // vertically centred against the price column and the whole row.
          <Row gap={spacing.sm}>
            {/* At most two lines (amount + /ay); the trial tag lives in the
                subtitle so it never grows this column or crowds the amount. */}
            <View style={{ alignItems: "flex-end", justifyContent: "center", gap: 2 }}>
              <Row gap={spacing.xs}>
                {s.autoPay ? <Repeat size={13} color={palette.primary} /> : null}
                <Amount minor={s.amountMinor} currency={s.currency} colorized={false} />
              </Row>
              {s.intervalMonths > 1 ? (
                <Body muted style={{ fontSize: 12 }}>
                  {tr.subs.perMonth(formatMinor(normalizedMonthlyLoadMinor(s.amountMinor, s.intervalMonths), s.currency))}
                </Body>
              ) : null}
            </View>
            <IconButton icon={Pencil} size={32} label={tr.common.edit} onPress={() => router.push({ pathname: "/subscription-form", params: { id: s.id } })} />
            <IconButton icon={Trash2} size={32} tone="danger" label={tr.common.delete} haptic="none" onPress={() => void remove(s.id, s.name)} />
          </Row>
        }
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
          <Card>{active.map(renderSub)}</Card>
        </>
      ) : null}
      {watched.length > 0 ? (
        <>
          <SectionHeader>{tr.subs.watchedSection}</SectionHeader>
          <Card>{watched.map(renderSub)}</Card>
        </>
      ) : null}
      {passive.length > 0 ? (
        <>
          <SectionHeader>{tr.common.inactive}</SectionHeader>
          <Card>{passive.map(renderSub)}</Card>
        </>
      ) : null}
    </Screen>
  );
}
