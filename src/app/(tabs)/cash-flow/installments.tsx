/** Installments & loans, viewed one MONTH at a time: step through months and
 *  filter by card to see exactly which installments fall due that month. A plan
 *  that has no payment in the selected month (finished, or not yet started) is
 *  hidden — each month shows only its own live installments (spec §3.2, §2.8). */

import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, CreditCard, Plus } from "lucide-react-native";
import { installmentDisplayTitle, planProgress, type GeneratedInstallment } from "../../../domain/installments";
import { monthKeyOf, todayISO } from "../../../domain/dates";
import { monthLabel, tr } from "../../../i18n/tr";
import {
  usePersons,
  usePlans,
  useSources,
  useAllTransactions,
} from "../../../data/hooks";
import { Amount, Badge, Body, Button, Card, CardList, ChipPicker, EmptyState, MonthStepper, Row, Screen, SectionHeader, Spread } from "../../../ui/components";
import { spacing, useTheme } from "../../../ui/theme";

export default function InstallmentsScreen() {
  const plans = usePlans();
  const sources = useSources();
  const persons = usePersons();
  const allTx = useAllTransactions();
  const router = useRouter();
  const { palette } = useTheme();
  const [viewMonth, setViewMonth] = useState(monthKeyOf(todayISO()));
  const [cardFilter, setCardFilter] = useState<string | null>(null);

  const selfIds = new Set(persons.filter((p) => p.isSelf).map((p) => p.id));
  const sourceName = new Map(sources.map((s) => [s.id, s.name]));
  const personName = new Map(persons.map((p) => [p.id, p.name]));
  const noteByPlan = new Map<string, string>();
  for (const tx of allTx) {
    if (tx.installmentPlanId && tx.note && !noteByPlan.has(tx.installmentPlanId)) noteByPlan.set(tx.installmentPlanId, tx.note);
  }

  const itemsByPlan = new Map<string, GeneratedInstallment[]>();
  for (const t of allTx) {
    if (!t.installmentPlanId || t.installmentNo == null) continue;
    const list = itemsByPlan.get(t.installmentPlanId) ?? [];
    list.push({
      installmentNo: t.installmentNo,
      month: monthKeyOf(t.effectiveDate),
      amountMinor: t.amountTryMinor,
      effectiveDate: t.effectiveDate,
      status: t.status,
    });
    itemsByPlan.set(t.installmentPlanId, list);
  }
  for (const list of itemsByPlan.values()) list.sort((a, b) => a.installmentNo - b.installmentNo);

  // The one installment (if any) a plan pays in the viewed month.
  const itemInMonth = (planId: string) => itemsByPlan.get(planId)?.find((it) => it.month === viewMonth);

  // Cards that actually carry an installment this month — the filter never
  // offers a card with nothing to show. (Plain derivation; the React Compiler
  // memoizes it — a manual useMemo over the itemInMonth closure would bail out.)
  const cardIdsThisMonth = new Set<string>();
  for (const p of plans) {
    if (p.paymentSourceId && itemInMonth(p.id)) cardIdsThisMonth.add(p.paymentSourceId);
  }
  const cardOptions = [
    { value: "" as string, label: tr.installments.allCards },
    ...[...cardIdsThisMonth].map((id) => ({ value: id, label: sourceName.get(id) ?? tr.installments.noSource })),
  ];

  const matchesCard = (p: (typeof plans)[number]) => cardFilter == null || p.paymentSourceId === cardFilter;
  const activeThisMonth = (p: (typeof plans)[number]) => itemInMonth(p.id) != null && matchesCard(p);
  const selfPlans = plans.filter((p) => selfIds.has(p.personId) && activeThisMonth(p));
  const otherPlans = plans.filter((p) => !selfIds.has(p.personId) && activeThisMonth(p));

  // Header total = what this month's shown installments actually cost.
  const monthObligationMinor = selfPlans.reduce((sum, p) => sum + (itemInMonth(p.id)?.amountMinor ?? 0), 0);
  const watchedObligationMinor = otherPlans.reduce((sum, p) => sum + (itemInMonth(p.id)?.amountMinor ?? 0), 0);

  const renderPlan = (plan: (typeof plans)[number], watchedBy?: string) => {
    const items = itemsByPlan.get(plan.id) ?? [];
    const progress = planProgress(items);
    const finished = progress.remaining === 0;
    const thisMonth = itemInMonth(plan.id);
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: "/installment-new", params: { id: plan.id } })}
        style={({ pressed }) => [pressed && { opacity: 0.6 }]}
      >
        <Spread style={{ paddingVertical: spacing.sm, alignItems: "flex-start" }}>
          <View style={{ flex: 1, paddingRight: spacing.sm }}>
            <Body style={{ fontFamily: "Inter_500Medium" }}>
              {installmentDisplayTitle(plan.title, noteByPlan.get(plan.id), tr.installments.plan)}
            </Body>
            <Body muted style={{ marginTop: 2 }}>{sourceName.get(plan.paymentSourceId ?? "") ?? tr.installments.noSource}</Body>
            <Row gap={spacing.xs} style={{ flexWrap: "wrap", marginTop: spacing.xs }}>
              {plan.kind === "loan" ? <Badge text={tr.installments.loan} /> : null}
              {thisMonth ? <Badge text={tr.installments.thisMonthInstallment(thisMonth.installmentNo, progress.total)} tone="primary" /> : null}
              <Badge text={tr.installments.progress(progress.paid, progress.total)} tone={finished ? "positive" : "muted"} />
              {watchedBy ? <Badge text={`${tr.installments.watchOnly}: ${watchedBy}`} tone="warning" /> : null}
            </Row>
            {/* progress track */}
            <View style={{ height: 6, borderRadius: 3, backgroundColor: palette.surfaceAlt, marginTop: spacing.sm, overflow: "hidden" }}>
              <View
                style={{
                  height: 6,
                  borderRadius: 3,
                  width: `${Math.round((progress.paid / Math.max(progress.total, 1)) * 100)}%`,
                  backgroundColor: finished ? palette.positive : palette.primary,
                }}
              />
            </View>
          </View>
          <Row gap={spacing.xs} style={{ flexShrink: 0, paddingTop: 1 }}>
            {thisMonth ? <Amount minor={thisMonth.amountMinor} colorized={false} /> : null}
            <ChevronRight size={16} color={palette.textMuted} />
          </Row>
        </Spread>
      </Pressable>
    );
  };

  const nothingThisMonth = selfPlans.length === 0 && otherPlans.length === 0;

  return (
    <Screen>
      <MonthStepper value={viewMonth} onChange={setViewMonth} />

      <Card>
        <Body muted>{tr.installments.thisMonthTotal} · {monthLabel(viewMonth)}</Body>
        <Amount minor={monthObligationMinor} large colorized={false} />
      </Card>

      {cardOptions.length > 1 ? (
        <ChipPicker options={cardOptions} value={cardFilter ?? ""} onChange={(v) => setCardFilter(v === "" ? null : v)} />
      ) : null}

      <Button icon={Plus} label={tr.installments.newPlan} onPress={() => router.push("/installment-new")} />
      <View style={{ height: spacing.lg }} />

      {plans.length === 0 ? (
        <EmptyState icon={CreditCard} title={tr.installments.emptyTitle} hint={tr.installments.emptyHint} />
      ) : nothingThisMonth ? (
        <EmptyState icon={CreditCard} title={tr.installments.noneThisMonth} hint={tr.installments.noneThisMonthHint} />
      ) : null}

      <CardList items={selfPlans} keyExtractor={(p) => p.id} renderItem={(p) => renderPlan(p)} />

      {otherPlans.length > 0 ? (
        <>
          <SectionHeader>{tr.installments.othersSection}</SectionHeader>
          <Card>
            <Body muted>{tr.installments.watchedMonthTotal} · {monthLabel(viewMonth)}</Body>
            <Amount minor={watchedObligationMinor} large colorized={false} />
            <Body muted style={{ marginTop: spacing.xs }}>{tr.installments.watchedBalanceHint}</Body>
          </Card>
          <CardList items={otherPlans} keyExtractor={(p) => p.id} renderItem={(p) => renderPlan(p, personName.get(p.personId) ?? "")} />
        </>
      ) : null}
    </Screen>
  );
}
