/** Installments & loans, viewed one MONTH at a time: step through months and
 *  filter by card to see exactly which installments fall due that month. A plan
 *  that has no payment in the selected month (finished, or not yet started) is
 *  hidden — each month shows only its own live installments (spec §3.2, §2.8). */

import React, { useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, CreditCard, Landmark, Plus } from "lucide-react-native";
import { installmentDisplayTitle, planProgress, type GeneratedInstallment } from "../../../domain/installments";
import { monthKeyOf, todayISO } from "../../../domain/dates";
import { formatMinor } from "../../../domain/money";
import { monthLabel, tr } from "../../../i18n/tr";
import {
  usePersonsState,
  usePlansState,
  useSourcesState,
  useAllTransactionsState,
} from "../../../data/hooks";
import { combineLiveQueryStatus } from "../../../data/live-state";
import { paymentSourceIcon } from "../../../data/category-icons";
import { Amount, Badge, Body, Button, Card, CardList, DataStateNotice, EmptyState, MonthStepper, Screen, SectionHeader, Select } from "../../../ui/components";
import { font, radius, spacing, type, useTheme } from "../../../ui/theme";
import { WorkspaceSplit } from "../../../ui/workspace-layout";

export default function InstallmentsScreen() {
  const plansState = usePlansState();
  const sourcesState = useSourcesState();
  const personsState = usePersonsState();
  const transactionsState = useAllTransactionsState();
  const plans = plansState.data;
  const sources = sourcesState.data;
  const persons = personsState.data;
  const allTx = transactionsState.data;
  const router = useRouter();
  const { palette } = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 560;
  const [viewMonth, setViewMonth] = useState(monthKeyOf(todayISO()));
  const [cardFilter, setCardFilter] = useState<string | null>(null);
  const liveStates = [plansState, sourcesState, personsState, transactionsState];
  const dataStatus = combineLiveQueryStatus(liveStates);
  const dataReady = liveStates.every((state) => state.updatedAt != null);
  const retryData = () => {
    plansState.retry();
    sourcesState.retry();
    personsState.retry();
    transactionsState.retry();
  };

  const selfIds = new Set(persons.filter((p) => p.isSelf).map((p) => p.id));
  const sourceName = new Map(sources.map((s) => [s.id, s.name]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const personName = new Map(persons.map((p) => [p.id, p.name]));
  const noteByPlan = new Map<string, string>();
  for (const tx of allTx) {
    if (tx.installmentPlanId && tx.note && !noteByPlan.has(tx.installmentPlanId)) noteByPlan.set(tx.installmentPlanId, tx.note);
  }

  // The stepper used to walk to any month in either direction, so a plan ending
  // in October 2027 still offered 2035 — every one of those months empty. The
  // bounds are the plans themselves; with no plans at all there is nowhere to
  // go, so it stays on this month.
  const planMonths = allTx
    .filter((t) => t.installmentPlanId != null)
    .map((t) => monthKeyOf(t.effectiveDate))
    .sort();
  const firstPlanMonth = planMonths[0] ?? viewMonth;
  const lastPlanMonth = planMonths.at(-1) ?? viewMonth;

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
    ...[...cardIdsThisMonth].map((id) => ({
      value: id,
      label: sourceName.get(id) ?? tr.installments.noSource,
      icon: sourceById.get(id) ? paymentSourceIcon(sourceById.get(id)!.type) : undefined,
    })),
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
    const Icon = plan.kind === "loan" ? Landmark : CreditCard;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${installmentDisplayTitle(plan.title, noteByPlan.get(plan.id), tr.installments.plan)}. ${thisMonth ? formatMinor(thisMonth.amountMinor) : ""}. ${tr.installments.progress(progress.paid, progress.total)}`}
        onPress={() => router.push({ pathname: "/installment-new", params: { id: plan.id } })}
        style={({ pressed }) => [pressed && { opacity: 0.6 }]}
      >
        <View style={{ paddingVertical: spacing.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View
              accessible={false}
              style={{
                width: 38,
                height: 38,
                flexShrink: 0,
                borderRadius: radius.md,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: plan.kind === "loan" ? palette.secondarySoft : palette.primarySoft,
              }}
            >
              <Icon accessible={false} size={18} color={plan.kind === "loan" ? palette.secondaryText : palette.primaryText} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Body style={{ fontFamily: font.medium }}>
              {installmentDisplayTitle(plan.title, noteByPlan.get(plan.id), tr.installments.plan)}
              </Body>
              <Body muted style={{ marginTop: 2 }}>{sourceName.get(plan.paymentSourceId ?? "") ?? tr.installments.noSource}</Body>
            </View>
            <ChevronRight accessible={false} size={18} color={palette.textSecondary} />
          </View>

          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.md, marginTop: spacing.md }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.small, { color: palette.textSecondary }]}>
                {thisMonth ? tr.installments.thisMonthInstallment(thisMonth.installmentNo, progress.total) : tr.installments.progress(progress.paid, progress.total)}
              </Text>
              {thisMonth ? <Amount minor={thisMonth.amountMinor} colorized={false} style={{ fontSize: compact ? 17 : 19, textAlign: "left", marginTop: 2 }} /> : null}
            </View>
            <View style={{ alignItems: "flex-end", gap: spacing.xs }}>
              <Text style={[type.label, { color: finished ? palette.positiveText : palette.textStrong }]}>{progress.paid}/{progress.total}</Text>
              {watchedBy ? <Badge text={`${tr.installments.watchOnly}: ${watchedBy}`} tone="warning" /> : null}
            </View>
          </View>

          <View style={{ height: 6, borderRadius: 3, backgroundColor: palette.surfaceAlt, marginTop: spacing.sm, overflow: "hidden" }}>
            <View
              style={{
                height: 6,
                borderRadius: 3,
                width: `${Math.round((progress.paid / Math.max(progress.total, 1)) * 100)}%`,
                backgroundColor: finished ? palette.success : palette.primary,
              }}
            />
          </View>
        </View>
      </Pressable>
    );
  };

  const nothingThisMonth = selfPlans.length === 0 && otherPlans.length === 0;

  if (!dataReady) {
    return (
      <Screen>
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  return (
    <Screen maxWidth={1100}>
      <DataStateNotice status={dataStatus} retry={retryData} />
      <WorkspaceSplit
        testID="installments-workspace"
        primary={(
          <View>
            <MonthStepper value={viewMonth} onChange={setViewMonth} min={firstPlanMonth} max={lastPlanMonth} />
            <Card>
              <Body muted>{tr.installments.thisMonthTotal} · {monthLabel(viewMonth)}</Body>
              <Amount minor={monthObligationMinor} large colorized={false} />
              <View style={{ marginTop: spacing.md }}>
                <Select
                  label={tr.installments.cardFilter}
                  options={cardOptions}
                  value={cardFilter ?? ""}
                  onChange={(value) => setCardFilter(value === "" ? null : value)}
                  onCreate={{ label: tr.installments.addCard, run: () => router.push("/payment-sources") }}
                />
              </View>
              <Button icon={Plus} label={tr.installments.newPlan} onPress={() => router.push("/installment-new")} />
            </Card>
          </View>
        )}
        secondary={(
          <View>
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
          </View>
        )}
      />
    </Screen>
  );
}
