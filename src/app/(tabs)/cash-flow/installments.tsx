/** Installments & loans, viewed one MONTH at a time: step through months and
 *  filter by card to see exactly which installments fall due that month. A plan
 *  that has no payment in the selected month (finished, or not yet started) is
 *  hidden — each month shows only its own live installments (spec §3.2, §2.8). */

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { PaymentSourceLogo } from "../../../ui/logo";
import { useContentWidth } from "../../../ui/viewport";
import { useLocalSearchParams, useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CreditCard from "lucide-react-native/icons/credit-card";
import Landmark from "lucide-react-native/icons/landmark";
import Plus from "lucide-react-native/icons/plus";
import { installmentDisplayTitle, planProgress, type GeneratedInstallment } from "../../../domain/installments";
import { monthKeyOf, todayISO } from "../../../domain/dates";
import { formatMinorCompact } from "../../../domain/money";
import { monthLabel, tr } from "../../../i18n/tr";
import {
  usePersonsState,
  usePlansState,
  useSourcesState,
  useAllTransactionsState,
} from "../../../data/hooks";
import { combineLiveStates } from "../../../data/live-state";
import { Amount, Badge, Body, Button, Card, CardList, DataGateScreen, DataStateNotice, EmptyState, MonthStepper, Screen, SectionHeader, SegmentBar, Select } from "../../../ui/components";
import { font, radius, spacing, type, useTheme } from "../../../ui/theme";
import { WorkspaceSplit } from "../../../ui/workspace-layout";

/** The Select's own icon column, so a source mark fits it exactly. */
const SOURCE_MARK = 22;

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
  const compact = useContentWidth() < 560;
  const [requestedMonth, setRequestedMonth] = useState(monthKeyOf(todayISO()));
  /**
   * Arriving with a card already chosen.
   *
   * "Yaklaşan Ödemeler" lists a card statement as one row with one amount, and
   * the question it raises is which installments make it up. That question is
   * this screen filtered to that card, so the row hands the card over rather
   * than dropping the reader into an unfiltered list to find it again. A seed,
   * not a binding: the picker is still the thing that decides, and clearing it
   * here does not send the reader back through the row.
   */
  const { card } = useLocalSearchParams<{ card?: string }>();
  const [cardFilter, setCardFilter] = useState<string | null>(card ?? null);
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([plansState, sourcesState, personsState, transactionsState]);

  const selfIds = new Set(persons.filter((p) => p.isSelf).map((p) => p.id));
  const sourceName = new Map(sources.map((s) => [s.id, s.name]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const personName = new Map(persons.map((p) => [p.id, p.name]));
  const noteByPlan = new Map<string, string>();
  for (const tx of allTx) {
    if (tx.installmentPlanId && tx.note && !noteByPlan.has(tx.installmentPlanId)) noteByPlan.set(tx.installmentPlanId, tx.note);
  }

  // The stepper walks the instalment months and nothing else: a plan ending in
  // October 2027 used to offer 2035, and every one of those months was empty.
  //
  // What made the bounds wrong on their own was the STARTING point, not the
  // bounds. The screen opens on this month, and a workspace whose last
  // instalment fell in June opens outside its own range — so Back worked,
  // Forward was dead from the first press, and walking away from today was a
  // one-way trip. The view is clamped INTO the range instead of the range
  // being widened to reach today, because a month with no instalment in it has
  // nothing to show whichever direction you arrive from.
  const planMonths = allTx
    .filter((t) => t.installmentPlanId != null)
    .map((t) => monthKeyOf(t.effectiveDate))
    .sort();
  const currentMonth = monthKeyOf(todayISO());
  const firstPlanMonth = planMonths[0] ?? currentMonth;
  const lastPlanMonth = planMonths.at(-1) ?? currentMonth;
  // Derived, not stored: clamping through state would need an effect, and an
  // effect that corrects state on the render after the data arrives is the
  // one-frame flash of an out-of-range month.
  const viewMonth = requestedMonth < firstPlanMonth
    ? firstPlanMonth
    : requestedMonth > lastPlanMonth ? lastPlanMonth : requestedMonth;

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
  /** How far into the plan the viewed month is, or the paid count outside it. */
  const reachedNo = (planId: string, paidSoFar: number) => itemInMonth(planId)?.installmentNo ?? paidSoFar;
  /**
   * Where the plan stands TODAY, whichever month is being viewed.
   *
   * The line above the bar is the one fixed fact on this card: in September it
   * says September, and it says it while you walk back through June to see what
   * that month cost. The bar and the count beside it are the moving parts.
   */
  const asOfToday = (planId: string, paidSoFar: number, total: number) => {
    const today = itemsByPlan.get(planId)?.find((item) => item.month === currentMonth);
    return today
      ? tr.installments.thisMonthInstallment(monthLabel(currentMonth), today.installmentNo, total)
      : tr.installments.progress(paidSoFar, total);
  };

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
      icon: sourceById.get(id)
        ? <PaymentSourceLogo name={sourceById.get(id)!.name} type={sourceById.get(id)!.type} logoRef={sourceById.get(id)!.logoRef} size={SOURCE_MARK} />
        : undefined,
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
    // The plan's own count, not the number of rows it happens to have: an
    // imported plan can be missing the months its workbook kept in another
    // column, and "3/21" of a 24-month loan is a figure nobody recognises.
    const total = Math.max(plan.installmentCount, progress.total);
    // The bar walks the MONTH being viewed, which is the question this screen
    // answers — where am I in this plan in September? The static paid-so-far
    // count stays on the right of it, where it reads as the running tally.
    const reached = reachedNo(plan.id, progress.paid);
    const Icon = plan.kind === "loan" ? Landmark : CreditCard;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${installmentDisplayTitle(plan.title, noteByPlan.get(plan.id), tr.installments.plan)}. ${thisMonth ? formatMinorCompact(thisMonth.amountMinor) : ""}. ${tr.installments.progress(progress.paid, total)}`}
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
                {asOfToday(plan.id, progress.paid, total)}
              </Text>
              {thisMonth ? <Amount minor={thisMonth.amountMinor} colorized={false} style={{ fontSize: compact ? type.moneyInput.fontSize : type.heading.fontSize, textAlign: "left", marginTop: 2 }} /> : null}
            </View>
            <View style={{ alignItems: "flex-end", gap: spacing.xs }}>
              {/* Moves with the bar under it: both answer "where is this plan in
                  the month I am looking at". */}
              <Text style={[type.label, { color: finished ? palette.positiveText : palette.textStrong }]}>{reached}/{total}</Text>
              {watchedBy ? <Badge text={`${tr.installments.watchOnly}: ${watchedBy}`} tone="warning" /> : null}
            </View>
          </View>

          {/* One segment per instalment, the same shape the monthly limit uses:
              a plan is a countable number of steps, and a smooth bar hid which
              one you are on. */}
          <View style={{ marginTop: spacing.sm }}>
            <SegmentBar
              ratio={reached / Math.max(total, 1)}
              segments={total}
              tone={finished ? palette.success : palette.primary}
              height={8}
            />
          </View>
        </View>
      </Pressable>
    );
  };

  const nothingThisMonth = selfPlans.length === 0 && otherPlans.length === 0;

  if (!dataReady) return <DataGateScreen status={dataStatus} retry={retryData} />;

  return (
    <Screen width="workspace">
      <DataStateNotice status={dataStatus} retry={retryData} />
      <WorkspaceSplit
        testID="installments-workspace"
        primary={(
          <View>
            <MonthStepper value={viewMonth} onChange={setRequestedMonth} min={firstPlanMonth} max={lastPlanMonth} />
            <Card>
              <Body muted>{tr.installments.thisMonthTotal} · {monthLabel(viewMonth)}</Body>
              {/* This screen's ONE hero figure, so it counts — the same rule
                  Durum and Yatırımlar follow. Stepping to another month is a
                  real change, so it counts from the figure just left rather
                  than from zero, which is what makes the step read as a step.
                  The watched-balance card below deliberately does NOT count:
                  two figures moving at once is noise, not emphasis. */}
              <Amount minor={monthObligationMinor} large count colorized={false} />
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
