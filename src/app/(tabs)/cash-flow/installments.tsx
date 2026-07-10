/** Installments & loans: per-card grouping, n/m progress, this-month total
 *  obligation (spec §3.2), watch-only section for payer-other plans (§2.8). */

import React, { useMemo } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, CreditCard, Plus } from "lucide-react-native";
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
import { Amount, Badge, Body, Button, Card, CardList, EmptyState, Row, Screen, SectionHeader, Spread } from "../../../ui/components";
import { spacing, useTheme } from "../../../ui/theme";

export default function InstallmentsScreen() {
  const plans = usePlans();
  const sources = useSources();
  const persons = usePersons();
  const allTx = useAllTransactions();
  const router = useRouter();
  const { palette } = useTheme();
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

  const hasItems = (p: (typeof plans)[number]) => (itemsByPlan.get(p.id)?.length ?? 0) > 0;
  const selfPlans = plans.filter((p) => selfIds.has(p.personId) && hasItems(p));
  const otherPlans = plans.filter((p) => !selfIds.has(p.personId) && hasItems(p));

  const renderPlan = (plan: (typeof plans)[number], watchedBy?: string) => {
    const items = itemsByPlan.get(plan.id) ?? [];
    const progress = planProgress(items);
    const finished = progress.remaining === 0;
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: "/installment-new", params: { id: plan.id } })}
        style={({ pressed }) => [pressed && { opacity: 0.6 }]}
      >
        <Spread style={{ paddingVertical: spacing.sm }}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Row gap={spacing.sm}>
              <Body style={{ fontFamily: "Inter_500Medium" }}>{plan.title}</Body>
              {plan.kind === "loan" ? <Badge text={tr.installments.loan} /> : null}
              {watchedBy ? <Badge text={`${tr.installments.watchOnly}: ${watchedBy}`} tone="warning" /> : null}
            </Row>
            <Body muted style={{ marginTop: 2 }}>
              {sourceName.get(plan.paymentSourceId ?? "") ?? tr.common.none} · {tr.installments.progress(progress.paid, progress.total)}
              {finished ? ` · ${tr.installments.finished}` : ` · ${tr.installments.remaining(progress.remaining, formatMinor(progress.monthlyMinor))}`}
              {` · ${tr.installments.endsAt(monthLabel(progress.endMonth))}`}
            </Body>
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
          <Row gap={spacing.xs}>
            {finished ? <Badge text="✓" tone="positive" /> : <Amount minor={progress.remainingMinor} colorized={false} />}
            <ChevronRight size={16} color={palette.textMuted} />
          </Row>
        </Spread>
      </Pressable>
    );
  };

  return (
    <Screen>
      <Card>
        <Body muted>{tr.installments.thisMonthTotal}</Body>
        <Amount minor={monthTotals.total} large colorized={false} />
        {/* Wrap instead of clipping: the two labels drop to separate lines on a
            narrow phone rather than truncating "Değişken Harcama". */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing.lg, rowGap: spacing.xs, marginTop: spacing.sm }}>
          <Body muted>
            {tr.dashboard.fixed}: {formatMinor(monthTotals.fixed)}
          </Body>
          <Body muted>
            {tr.dashboard.variable}: {formatMinor(monthTotals.variable)}
          </Body>
        </View>
      </Card>

      <Button icon={Plus} label={tr.installments.newPlan} onPress={() => router.push("/installment-new")} />
      <View style={{ height: spacing.lg }} />

      {selfPlans.length === 0 && otherPlans.length === 0 ? (
        <EmptyState icon={CreditCard} title={tr.installments.emptyTitle} hint={tr.installments.emptyHint} />
      ) : null}

      <CardList items={selfPlans} keyExtractor={(p) => p.id} renderItem={(p) => renderPlan(p)} />

      {otherPlans.length > 0 ? (
        <>
          <SectionHeader>{tr.installments.othersSection}</SectionHeader>
          <CardList items={otherPlans} keyExtractor={(p) => p.id} renderItem={(p) => renderPlan(p, personName.get(p.personId) ?? "")} />
        </>
      ) : null}
    </Screen>
  );
}
