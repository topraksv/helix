/** Subscriptions: true monthly load (yearly amortized §3.1), active/passive
 *  groups, trial badges, next due dates; tap to edit, swipe-free management. */

import React, { useMemo } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { normalizedMonthlyLoadMinor } from "../../domain/analytics";
import { todayISO } from "../../domain/dates";
import { formatMinor } from "../../domain/money";
import { convertToTryMinor } from "../../domain/fx";
import { lookupRate } from "../../services/fx-fetch";
import { dateLabel, tr } from "../../i18n/tr";
import { useSubscriptions, useUserId } from "../../data/hooks";
import { softDelete, restoreRow } from "../../db/mutations";
import { scheduleSync } from "../../sync/engine";
import { Amount, Badge, Body, Button, Card, Divider, EmptyState, Heading, Row, Screen, Spread, Title } from "../../ui/components";
import { Logo } from "../../ui/logo";
import { useUndo } from "../../ui/undo";
import { spacing } from "../../ui/theme";

export default function SubscriptionsScreen() {
  const userId = useUserId();
  const subscriptions = useSubscriptions();
  const router = useRouter();
  const undo = useUndo();
  const today = todayISO();

  const { active, passive, monthlyLoadTry, yearlyTry } = useMemo(() => {
    const activeSubs = subscriptions.filter((s) => s.isActive);
    const toTry = (amountMinor: number, currency: string) => {
      if (currency === "TRY") return amountMinor;
      const rate = lookupRate(userId, currency);
      return rate ? convertToTryMinor(amountMinor, rate.rate.rateTry) : amountMinor;
    };
    const monthly = activeSubs.reduce(
      (sum, s) => sum + normalizedMonthlyLoadMinor(toTry(s.amountMinor, s.currency), s.intervalMonths),
      0,
    );
    return {
      active: activeSubs,
      passive: subscriptions.filter((s) => !s.isActive),
      monthlyLoadTry: monthly,
      yearlyTry: monthly * 12,
    };
  }, [subscriptions, userId]);

  const remove = async (id: string, name: string) => {
    const snapshot = await softDelete(userId, "subscriptions", id);
    scheduleSync(userId);
    if (snapshot) undo.show(`${name} — ${tr.common.deleted}`, () => void restoreRow(userId, "subscriptions", snapshot));
  };

  const renderSub = (s: (typeof subscriptions)[number]) => (
    <View key={s.id}>
      <Spread style={{ paddingVertical: spacing.sm }}>
        <Row style={{ flex: 1 }}>
          <Logo name={s.name} domain={s.websiteDomain} />
          <View style={{ flex: 1 }}>
            <Row gap={spacing.sm}>
              <Body>{s.name}</Body>
              {s.trialEndDate && s.trialEndDate >= today ? <Badge text={tr.subs.trialBadge} tone="warning" /> : null}
              {s.autoPay ? <Badge text="⚡" /> : null}
            </Row>
            <Body muted>
              {s.isActive ? tr.subs.nextDue(dateLabel(s.nextDueDate)) : tr.subs.canceled}
              {s.trialEndDate && s.trialEndDate >= today ? ` · ${tr.subs.trialEnds(dateLabel(s.trialEndDate))}` : ""}
            </Body>
          </View>
        </Row>
        <View style={{ alignItems: "flex-end" }}>
          <Amount minor={s.amountMinor} currency={s.currency} colorized={false} />
          {s.intervalMonths > 1 ? (
            <Body muted>{tr.subs.perMonth(formatMinor(normalizedMonthlyLoadMinor(s.amountMinor, s.intervalMonths), s.currency))}</Body>
          ) : null}
        </View>
      </Spread>
      <Row gap={spacing.sm} style={{ marginBottom: spacing.sm }}>
        <Button label={tr.common.edit} variant="ghost" onPress={() => router.push({ pathname: "/abonelik-form", params: { id: s.id } })} />
        <Button label={tr.common.delete} variant="ghost" onPress={() => void remove(s.id, s.name)} />
      </Row>
      <Divider />
    </View>
  );

  return (
    <Screen>
      <Title>{tr.subs.title}</Title>
      <Card>
        <Spread>
          <View>
            <Body muted>{tr.subs.monthlyLoad}</Body>
            <Amount minor={monthlyLoadTry} large colorized={false} />
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Body muted>{tr.subs.yearlyTotal}</Body>
            <Amount minor={yearlyTry} colorized={false} />
          </View>
        </Spread>
      </Card>

      <Button label={`+ ${tr.subs.add}`} onPress={() => router.push("/abonelik-form")} />
      <View style={{ height: spacing.md }} />

      {active.length === 0 && passive.length === 0 ? <EmptyState text={tr.cashflow.emptyMonth} /> : null}
      {active.length > 0 ? (
        <>
          <Heading>{tr.common.active}</Heading>
          <Card>{active.map(renderSub)}</Card>
        </>
      ) : null}
      {passive.length > 0 ? (
        <>
          <Heading>{tr.common.inactive}</Heading>
          <Card>{passive.map(renderSub)}</Card>
        </>
      ) : null}
    </Screen>
  );
}
