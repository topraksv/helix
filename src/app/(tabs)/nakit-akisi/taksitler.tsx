/** Installments & loans: per-card grouping, n/m progress, this-month total
 *  obligation (spec §3.2), watch-only section for payer-other plans (§2.8). */

import React, { useMemo } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { planProgress, type GeneratedInstallment } from "../../../domain/installments";
import { firstDayOf, lastDayOf, monthKeyOf, todayISO } from "../../../domain/dates";
import { fixedVsVariable } from "../../../domain/analytics";
import { formatMinor } from "../../../domain/money";
import { monthLabel, tr } from "../../../i18n/tr";
import {
  toTxLike,
  useAllTransactions,
  usePersons,
  usePlans,
  useSources,
} from "../../../data/hooks";
import { Amount, Badge, Body, Button, Card, Divider, EmptyState, Heading, Row, Screen, Spread } from "../../../ui/components";
import { spacing } from "../../../ui/theme";

export default function InstallmentsScreen() {
  const plans = usePlans();
  const sources = useSources();
  const persons = usePersons();
  const allTx = useAllTransactions();
  const router = useRouter();
  const today = todayISO();
  const month = monthKeyOf(today);

  const selfIds = useMemo(() => new Set(persons.filter((p) => p.isSelf).map((p) => p.id)), [persons]);
  const sourceName = useMemo(() => new Map(sources.map((s) => [s.id, s.name])), [sources]);
  const personName = useMemo(() => new Map(persons.map((p) => [p.id, p.name])), [persons]);

  const itemsByPlan = useMemo(() => {
    const map = new Map<string, GeneratedInstallment[]>();
    for (const t of allTx) {
      if (!t.installmentPlanId || t.installmentNo == null) continue;
      const list = map.get(t.installmentPlanId) ?? [];
      list.push({
        installmentNo: t.installmentNo,
        month: monthKeyOf(t.effectiveDate),
        amountMinor: t.amountTryMinor,
        effectiveDate: t.effectiveDate,
        status: t.status,
      });
      map.set(t.installmentPlanId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.installmentNo - b.installmentNo);
    return map;
  }, [allTx]);

  const txLike = useMemo(() => toTxLike(allTx, persons), [allTx, persons]);
  const monthTotals = useMemo(() => {
    const upcoming = txLike.filter(
      (t) =>
        t.personIsSelf &&
        t.type === "expense" &&
        t.effectiveDate >= firstDayOf(month) &&
        t.effectiveDate <= lastDayOf(month),
    );
    const realizedOrPlanned = upcoming.reduce((sum, t) => sum + t.amountTryMinor, 0);
    const fv = fixedVsVariable(txLike, firstDayOf(month), lastDayOf(month), lastDayOf(month));
    return { total: realizedOrPlanned, fixed: fv.fixedMinor, variable: fv.variableMinor };
  }, [txLike, month]);

  const selfPlans = plans.filter((p) => selfIds.has(p.personId));
  const otherPlans = plans.filter((p) => !selfIds.has(p.personId));

  const renderPlan = (plan: (typeof plans)[number]) => {
    const items = itemsByPlan.get(plan.id) ?? [];
    if (items.length === 0) return null;
    const progress = planProgress(items);
    const finished = progress.remaining === 0;
    return (
      <View key={plan.id}>
        <Spread style={{ paddingVertical: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Body>
              {plan.title}
              {plan.kind === "loan" ? `  ·  ${tr.installments.loan}` : ""}
            </Body>
            <Body muted>
              {sourceName.get(plan.paymentSourceId ?? "") ?? tr.common.none} · {tr.installments.progress(progress.paid, progress.total)}
              {finished ? ` · ${tr.installments.finished}` : ` · ${tr.installments.remaining(progress.remaining, formatMinor(progress.monthlyMinor))}`}
            </Body>
            <Body muted>{tr.installments.endsAt(monthLabel(progress.endMonth))}</Body>
          </View>
          {finished ? <Badge text="✓" tone="positive" /> : <Amount minor={progress.remainingMinor} colorized={false} />}
        </Spread>
        <Divider />
      </View>
    );
  };

  return (
    <Screen>
      <Card>
        <Heading style={{ marginVertical: 0 }}>{tr.installments.thisMonthTotal}</Heading>
        <Amount minor={monthTotals.total} large colorized={false} />
        <Row gap={spacing.lg} style={{ marginTop: spacing.sm }}>
          <Body muted>
            {tr.dashboard.fixed}: {formatMinor(monthTotals.fixed)}
          </Body>
          <Body muted>
            {tr.dashboard.variable}: {formatMinor(monthTotals.variable)}
          </Body>
        </Row>
      </Card>

      <Button label={`+ ${tr.installments.newPlan}`} onPress={() => router.push("/taksit-yeni")} />
      <View style={{ height: spacing.md }} />

      {selfPlans.length === 0 && otherPlans.length === 0 ? <EmptyState text={tr.cashflow.emptyMonth} /> : null}

      {selfPlans.length > 0 ? <Card>{selfPlans.map(renderPlan)}</Card> : null}

      {otherPlans.length > 0 ? (
        <>
          <Heading>{tr.installments.othersSection}</Heading>
          <Card>
            {otherPlans.map((p) => (
              <View key={p.id}>
                <Row gap={spacing.sm}>
                  <Badge text={`${tr.installments.watchOnly}: ${personName.get(p.personId) ?? ""}`} tone="warning" />
                </Row>
                {renderPlan(p)}
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
