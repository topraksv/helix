/** Dashboard: current balance, action-needed payments, upcoming timeline and
 * one concise monthly insight. Detailed exploration belongs to Analysis. */

import React from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { ArrowDownLeft, ArrowUpRight, CalendarClock, ChartNoAxesColumn, ChevronDown, ChevronRight, ChevronUp, History, PartyPopper, Plus, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react-native";
import { buildDashboardModel } from "../../domain/dashboard";
import { firstDayOf, lastDayOf, monthKeyOf, todayISO, yearOf, type ISODate } from "../../domain/dates";
import { formatMinor } from "../../domain/money";
import { buildUpcomingTimeline } from "../../domain/upcoming";
import { clockOrDateTimeLabel, dateLabel, dateTimeLabel, monthName, tr } from "../../i18n/tr";
import { useSession } from "../../auth/session";
import {
  daysBetween,
  useCategoriesState,
  useCreditCardStatementsState,
  useLedgerState,
  usePendingExpectedState,
  usePersonsState,
  useRecurringIncomesState,
  useSourcesState,
  useSubscriptionsState,
  useUserId,
} from "../../data/hooks";
import { combineLiveQueryStatus } from "../../data/live-state";
import { confirmExpected, FxRateUnavailableError, revertExpected } from "../../data/repo";
import { marketSellRateTry, MARKET_SYMBOLS, useMarkets } from "../../services/markets";
import { convertToTryMinor } from "../../domain/fx";
import { lookupRate, useFxRates } from "../../services/fx-fetch";
import { appAlert } from "../../ui/dialog";
import { scheduleSync } from "../../sync/engine";
import { Amount, Badge, Body, Button, Card, DataStateNotice, Divider, EmptyState, Heading, HeroCard, ListRow, Row, Screen, SectionHeader, Segmented, Spread, STATUS_W } from "../../ui/components";
import { Bars, Donut, distributionDonutData, useSeriesColors } from "../../ui/charts";
import { CalendarSheet } from "../../ui/calendar";
import { BrandMark } from "../../ui/brand";
import { FirstRunTour } from "../../ui/tour";
import { useUndo } from "../../ui/undo";
import { errorNotice } from "../../ui/haptics";
import { shouldUseCompactChart } from "../../ui/responsive";
import { font, radius, spacing, type, useTheme } from "../../ui/theme";
import { devError } from "../../services/logger";
import { useOperationGuard } from "../../ui/operation-guard";

// Fixed widths prevent quote rows from shifting as values arrive.
const MARKET_BUY_W = 78;
const MARKET_SELL_W = 92;
const MARKET_TREND_W = 15;

function MarketsCard() {
  const { palette } = useTheme();
  const userId = useUserId();
  const { prices, status, lastEventAt } = useMarkets();
  useFxRates();
  if (status === "idle") return null;

  const priceText = (v: number) =>
    new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  // Display hierarchy: live/last-known quotes → dated FX reference rates →
  // an explanatory fallback. The card never renders empty values or "—".
  const quoted = MARKET_SYMBOLS.filter(({ code }) => prices[code] != null);
  const referenceRows = quoted.length > 0
    ? []
    : ([["USD", tr.markets.usd], ["EUR", tr.markets.eur]] as const).flatMap(([currency, label]) => {
        const rate = lookupRate(userId, currency);
        return rate ? [{ label, rate }] : [];
      });
  const statusLabel = status === "live"
    ? tr.markets.live
    : quoted.length > 0 && lastEventAt
      ? tr.markets.updatedAt(clockOrDateTimeLabel(lastEventAt))
      : status === "connecting"
        ? tr.markets.connecting
        : tr.markets.offline;

  return (
    <Card>
      <Spread style={{ marginBottom: spacing.xs, alignItems: "flex-start" }}>
        <Heading style={{ marginVertical: 0, flexShrink: 1 }}>{tr.markets.title}</Heading>
        <Row gap={spacing.xs} accessible accessibilityLiveRegion="polite" accessibilityLabel={statusLabel}>
          {/* The dot claims liveness only once real quotes are flowing. */}
          <View accessible={false} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: status === "live" ? palette.success : palette.textSecondary }} />
          <Text style={[type.small, { color: palette.textSecondary, textAlign: "right", flexShrink: 1 }]}>{statusLabel}</Text>
        </Row>
      </Spread>
      {quoted.length > 0 ? (
        <>
          {/* column headers over the price columns */}
          <Spread style={{ marginBottom: spacing.xs }}>
            <View />
            <Row gap={spacing.sm}>
              <Text style={[type.small, { color: palette.textSecondary, minWidth: MARKET_BUY_W, textAlign: "right" }]}>{tr.markets.buy}</Text>
              <Text style={[type.small, { color: palette.textSecondary, minWidth: MARKET_SELL_W, textAlign: "right" }]}>{tr.markets.sell}</Text>
              <View style={{ width: MARKET_TREND_W }} />
            </Row>
          </Spread>
          {quoted.map(({ code, label }) => {
            const p = prices[code]!;
            const direction = p.direction === "up"
              ? tr.markets.rising
              : p.direction === "down"
                ? tr.markets.falling
                : tr.markets.unchanged;
            return (
              <Spread
                key={code}
                accessible
                accessibilityLabel={tr.markets.quote(label, priceText(p.buyTry), `${priceText(p.sellTry)} ₺`, direction)}
                style={{ paddingVertical: spacing.sm - 2 }}
              >
                <Body>{label}</Body>
                <Row gap={spacing.sm}>
                  <Text style={[type.amountSm, { color: palette.textSecondary, minWidth: MARKET_BUY_W, textAlign: "right" }]}>{priceText(p.buyTry)}</Text>
                  <Text style={[type.amount, { color: palette.text, minWidth: MARKET_SELL_W, textAlign: "right" }]}>
                    {`${priceText(p.sellTry)} ₺`}
                  </Text>
                  {p.direction === "up" ? (
                    <TrendingUp accessible={false} size={MARKET_TREND_W} color={palette.positive} />
                  ) : p.direction === "down" ? (
                    <TrendingDown accessible={false} size={MARKET_TREND_W} color={palette.negative} />
                  ) : (
                    <View style={{ width: MARKET_TREND_W }} />
                  )}
                </Row>
              </Spread>
            );
          })}
        </>
      ) : referenceRows.length > 0 ? (
        <>
          {referenceRows.map(({ label, rate }) => (
            <Spread
              key={label}
              accessible
              accessibilityLabel={`${label}. ${tr.markets.referenceRate(dateLabel(rate.rate.rateDate))}. ${priceText(rate.rate.rateTry)} ₺`}
              style={{ paddingVertical: spacing.sm - 2 }}
            >
              <View style={{ flexShrink: 1 }}>
                <Body>{label}</Body>
                <Text style={[type.small, { color: palette.textSecondary }]}>{tr.markets.referenceRate(dateLabel(rate.rate.rateDate))}</Text>
              </View>
              <Text style={[type.amount, { color: palette.text }]}>{`${priceText(rate.rate.rateTry)} ₺`}</Text>
            </Spread>
          ))}
          <Body muted style={{ marginTop: spacing.sm, fontSize: 12 }}>{tr.markets.offlineHint}</Body>
        </>
      ) : (
        <Body muted>{tr.markets.noData}</Body>
      )}
    </Card>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return tr.dashboard.greetingNight;
  if (hour < 12) return tr.dashboard.greetingMorning;
  if (hour < 18) return tr.dashboard.greetingDay;
  return tr.dashboard.greetingEvening;
}

export default function DashboardScreen() {
  const userId = useUserId();
  const previousLoginAt = useSession((state) => state.previousLoginAt);
  const today = todayISO();
  const year = yearOf(today);
  const month = monthKeyOf(today);
  const ledgerState = useLedgerState(year);
  const categoriesState = useCategoriesState();
  const personsState = usePersonsState();
  const expectedState = usePendingExpectedState();
  const subscriptionsState = useSubscriptionsState();
  const incomesState = useRecurringIncomesState();
  const sourcesState = useSourcesState();
  const cardStatementsState = useCreditCardStatementsState();
  const bundle = ledgerState.data;
  const categories = categoriesState.data;
  const persons = personsState.data;
  const expected = expectedState.data;
  const subscriptions = subscriptionsState.data;
  const incomes = incomesState.data;
  const sources = sourcesState.data;
  const cardStatements = cardStatementsState.data;
  const liveStates = [
    ledgerState,
    categoriesState,
    personsState,
    expectedState,
    subscriptionsState,
    incomesState,
    sourcesState,
    cardStatementsState,
  ];
  const dataStatus = combineLiveQueryStatus(liveStates);
  const retryData = () => {
    ledgerState.retry();
    categoriesState.retry();
    personsState.retry();
    expectedState.retry();
    subscriptionsState.retry();
    incomesState.retry();
    sourcesState.retry();
    cardStatementsState.retry();
  };
  const router = useRouter();
  const undo = useUndo();
  const { palette } = useTheme();
  const { width } = useWindowDimensions();
  const chartColors = useSeriesColors();
  // Re-render when FX rates land so foreign-currency projections settle.
  useFxRates();

  const txLike = bundle?.txLike ?? [];
  const selfPersonId = persons.find((p) => p.isSelf)?.id;
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const subscriptionById = new Map(subscriptions.map((subscription) => [subscription.id, subscription]));
  const incomeById = new Map(incomes.map((income) => [income.id, income]));

  const catName = (id: string | null) => (id ? categoryById.get(id)?.name : undefined);
  const nameOf = (e: (typeof expected)[number]) =>
    subscriptionById.get(e.refId)?.name ?? incomeById.get(e.refId)?.name ?? tr.common.paymentFallback;
  // Missing FX stays missing; a foreign amount is never treated as TRY.
  const expectedTryMinor = (currency: string, amountMinor: number): number | null => {
    if (currency === "TRY") return amountMinor;
    const rateTry = marketSellRateTry(currency) ?? lookupRate(userId, currency)?.rate.rateTry ?? null;
    return rateTry == null ? null : convertToTryMinor(amountMinor, rateTry);
  };
  const monthEnd = lastDayOf(month);
  const model = buildDashboardModel({
    transactions: txLike,
    expected,
    ledger: bundle?.ledger ?? [],
    actualBalanceMinor: bundle?.actualBalanceMinor ?? null,
    today,
    monthStart: firstDayOf(month),
    monthEnd,
    currentMonth: month,
    year,
    expectedTryMinor,
  });
  const { lateItems: late, incomingMinor, outgoingMinor: remainingFixedMinor } = model;
  const upcoming = buildUpcomingTimeline({
    expected,
    transactions: txLike,
    expectedSources: [
      ...subscriptions.map((subscription) => ({
        id: subscription.id,
        name: subscription.name,
        sourceType: "subscription" as const,
        categoryName: catName(subscription.categoryId) ?? null,
      })),
      ...incomes.map((income) => ({
        id: income.id,
        name: income.name,
        sourceType: "recurring_income" as const,
        categoryName: catName(income.categoryId) ?? null,
      })),
    ],
    categories: categories.map((category) => ({ id: category.id, name: category.name })),
    cards: sources.filter((source) => source.type === "credit_card"),
    statements: cardStatements,
    today,
    horizonDays: 31,
  }).filter((item) => item.status === "upcoming").slice(0, 12);
  const timelineTypeLabel = (sourceType: (typeof upcoming)[number]["sourceType"]) => ({
    recurring_income: tr.dashboard.expectedIncome,
    subscription: tr.subs.title,
    scheduled_transaction: tr.dashboard.scheduledTx,
    card_statement: tr.dashboard.cardStatement,
  })[sourceType];

  const projected = model.projectedMinor;
  const monthIncomeMinor = model.distribution.incomeTotalMinor;
  const monthOutflowMinor = model.distribution.expenseTotalMinor + model.distribution.transferTotalMinor;
  const monthNetMinor = monthIncomeMinor - monthOutflowMinor;
  const monthDonut = distributionDonutData(
    model.distribution,
    chartColors,
    (id) => categoryById.get(id)?.name ?? tr.common.none,
  );
  const hasMonthFlow = monthIncomeMinor !== 0 || monthDonut.slices.length > 0 || monthDonut.supplementalSlices.length > 0;
  const monthBars = [{
    label: monthName(month),
    values: [monthIncomeMinor, model.distribution.expenseTotalMinor, model.distribution.transferTotalMinor],
  }];
  const monthBarSeries = [
    { label: tr.cashflow.income, color: chartColors[1] },
    { label: tr.cashflow.expense, color: chartColors[5] },
    { label: tr.cashflow.transfer, color: chartColors[4] },
  ];

  // A paid item realizes on its actual payment day, not its planned due day.
  const [showForecast, setShowForecast] = React.useState(false);
  const [chartType, setChartType] = React.useState<"pie" | "bars">("pie");
  const [paying, setPaying] = React.useState<(typeof expected)[number] | null>(null);
  const defaultPaidDate = (dueDate: string): ISODate => (dueDate <= today ? (dueDate as ISODate) : today);
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  const operationGuard = useOperationGuard();
  const confirm = async (e: (typeof expected)[number], paidOn: ISODate) => {
    if (!selfPersonId) return;
    await operationGuard.run(async () => {
      setConfirmingId(e.id);
      try {
        const sub = subscriptionById.get(e.refId);
        const income = incomeById.get(e.refId);
        await confirmExpected(userId, e.id, {
          personId: sub?.personId ?? income?.personId ?? selfPersonId,
          categoryId: sub?.categoryId ?? income?.categoryId ?? null,
          paidOn,
        });
        scheduleSync(userId);
        undo.show(`${nameOf(e)} ✓`, () => revertExpected(userId, e.id));
      } catch (err) {
        errorNotice();
        if (err instanceof FxRateUnavailableError) void appAlert(tr.errors.fxUnavailable);
        else {
          devError("confirm", err);
          void appAlert(tr.errors.saveFailed);
        }
      } finally {
        setConfirmingId(null);
      }
    });
  };

  const projectedDelta = bundle && projected != null ? projected - bundle.actualBalanceMinor : null;
  return (
    <Screen title={greeting()} subtitle={dateLabel(today)} leading={<BrandMark size={40} />}>
      <FirstRunTour />
      <DataStateNotice status={dataStatus} retry={retryData} />
      {previousLoginAt ? (
        <View style={{ marginBottom: spacing.sm, alignSelf: "flex-start" }}>
          <Badge icon={ShieldCheck} text={tr.dashboard.lastLogin(dateTimeLabel(previousLoginAt))} />
        </View>
      ) : null}
      {/* "When did you pay?" — records the actual paid day for an expected item,
          so an early/manual payment realizes on that date. Future days disabled. */}
      {paying ? (
        <CalendarSheet
          value={defaultPaidDate(paying.dueDate)}
          max={today}
          onSelect={(iso) => void confirm(paying, iso)}
          onClose={() => setPaying(null)}
        />
      ) : null}
      {/* Reconciliation nudge — shown only when payments are actually overdue and
          awaiting confirmation (not on a stale "days since last entry" timer, which
          lingered even with nothing to do). Derived from live data, so it clears
          itself the moment the last item is confirmed. */}
      {late.length > 0 ? (
        <Pressable onPress={() => router.push("/reconciliation")} accessibilityRole="button">
          <Card style={{ backgroundColor: palette.warning + "14", borderWidth: 0 }}>
            <Row>
              <History accessible={false} size={20} color={palette.warning} />
              <View style={{ flex: 1 }}>
                <Body>{tr.dashboard.pendingConfirm(late.length)}</Body>
                <Body muted>{tr.dashboard.catchUp}</Body>
              </View>
              <ChevronRight accessible={false} size={18} color={palette.textSecondary} />
            </Row>
          </Card>
        </Pressable>
      ) : null}

      {bundle ? (
        <HeroCard>
          <Text style={[type.label, { color: palette.primaryText, textTransform: "uppercase", letterSpacing: 1, fontSize: 11 }]}>
            {tr.dashboard.actualBalance}
          </Text>
          <Amount
            minor={bundle.actualBalanceMinor}
            hero
            colorized={false}
            color={palette.textSecondary}
            style={{ marginTop: spacing.xs, textAlign: "left" }}
          />
          {projected != null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showForecast }}
              onPress={() => setShowForecast((v) => !v)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                marginTop: spacing.md,
                backgroundColor: pressed ? palette.surfaceHover : palette.surface,
                borderRadius: radius.md,
                padding: spacing.md,
              })}
            >
              {projectedDelta != null && projectedDelta >= 0 ? (
                <TrendingUp size={18} color={palette.accentText} />
              ) : (
                <TrendingDown size={18} color={palette.accentText} />
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.label, { color: palette.textSecondary }]}>{tr.dashboard.forecastToggle}</Text>
                <Amount minor={projected} colorized={false} color={palette.textStrong} style={{ textAlign: "left" }} />
              </View>
              {showForecast ? <ChevronUp size={18} color={palette.accentText} /> : <ChevronDown size={18} color={palette.accentText} />}
            </Pressable>
          ) : null}
        </HeroCard>
      ) : (
        <HeroCard>
          {/* Same label/amount line heights as the loaded state. */}
          <View style={{ width: 120, height: 13, borderRadius: radius.sm, backgroundColor: palette.border }} />
          <View style={{ width: 208, height: 38, borderRadius: radius.sm, backgroundColor: palette.border, marginTop: spacing.xs }} />
        </HeroCard>
      )}

      {bundle && showForecast && projected != null ? (
        <Card>
          <Body muted style={{ fontSize: 12, marginBottom: spacing.sm }}>{tr.dashboard.forecastHint}</Body>
          <Spread style={{ marginBottom: spacing.xs }}>
            <Body muted>{tr.dashboard.forecastCurrent}</Body>
            <Amount minor={bundle.actualBalanceMinor} />
          </Spread>
          {incomingMinor > 0 ? (
            <Spread style={{ marginBottom: spacing.xs }}>
              <Body muted>{tr.dashboard.forecastIncoming}</Body>
              <Amount minor={incomingMinor} />
            </Spread>
          ) : null}
          {remainingFixedMinor > 0 ? (
            <Spread style={{ marginBottom: spacing.xs }}>
              <Body muted>{tr.dashboard.forecastOutgoing}</Body>
              <Amount minor={-remainingFixedMinor} />
            </Spread>
          ) : null}
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginVertical: spacing.sm }} />
          <Spread>
            <Body style={{ fontFamily: font.semibold }}>{tr.dashboard.forecastResult}</Body>
            <Amount minor={projected} />
          </Spread>
        </Card>
      ) : null}

      {/* Quick actions */}
      <Row style={{ marginBottom: spacing.lg }}>
        <View style={{ flex: 1 }}>
          <Button icon={Plus} label={tr.cashflow.addTransaction} onPress={() => router.push("/transaction")} />
        </View>
        {late.length > 0 ? (
          <View style={{ flex: 1 }}>
            <Button icon={History} label={tr.dashboard.catchupShort} variant="secondary" onPress={() => router.push("/reconciliation")} />
          </View>
        ) : null}
      </Row>

      {/* Upcoming payments */}
      <SectionHeader>{tr.dashboard.upcoming}</SectionHeader>
      {dataStatus === "loading" || dataStatus === "error" ? null : (late.length > 0 || upcoming.length > 0) && selfPersonId ? (
        <Card>
          {late.map((e) => (
            <ListRow
              key={e.id}
              icon={e.direction === "in" ? ArrowDownLeft : ArrowUpRight}
              iconColor={palette.error}
              title={nameOf(e)}
              subtitle={`${tr.dashboard.late} · ${dateLabel(e.dueDate)} · ${formatMinor(e.amountMinor, e.currency)}`}
              right={
                <View style={{ width: STATUS_W }}>
                  <Button
                    size="sm"
                    label={e.direction === "in" ? tr.dashboard.received : tr.dashboard.markPaid}
                    variant="secondary"
                    loading={confirmingId === e.id}
                    disabled={confirmingId != null}
                    onPress={() => setPaying(e)}
                  />
                </View>
              }
            />
          ))}
          {upcoming.map((u) => (
            <ListRow
              key={u.key}
              icon={u.direction === "in" ? ArrowDownLeft : CalendarClock}
              iconColor={u.direction === "in" ? palette.positive : undefined}
              title={u.name ?? u.categoryName ?? tr.common.paymentFallback}
              subtitle={`${timelineTypeLabel(u.sourceType)} · ${tr.dashboard.inDays(daysBetween(today, u.date))} · ${formatMinor(u.amountMinor, u.currency)}`}
              right={
                u.kind === "expected" && u.expectedId ? (
                  <View style={{ width: STATUS_W }}>
                    <Button
                      size="sm"
                      label={u.direction === "in" ? tr.dashboard.received : tr.dashboard.markPaid}
                      variant="secondary"
                      loading={confirmingId === u.expectedId}
                      disabled={confirmingId != null}
                      onPress={() => {
                        const e = expected.find((x) => x.id === u.expectedId);
                        if (e) setPaying(e);
                      }}
                    />
                  </View>
                ) : undefined
              }
            />
          ))}
          <Button label={tr.dashboard.allUpcoming} variant="ghost" onPress={() => router.push("/upcoming" as Href)} />
        </Card>
      ) : (
        <Card>
          <EmptyState icon={PartyPopper} title={tr.dashboard.noUpcoming} hint={tr.dashboard.upcomingHint} />
        </Card>
      )}

      {/* Live markets */}
      <MarketsCard />

      <SectionHeader>{tr.dashboard.monthInsight}</SectionHeader>
      <Card>
        <ListRow
          icon={ChartNoAxesColumn}
          title={tr.dashboard.monthNet(formatMinor(monthNetMinor))}
          subtitle={tr.dashboard.monthFlowSummary(formatMinor(monthIncomeMinor), formatMinor(monthOutflowMinor))}
          chevron
          // Record the source: the anchored push mounts the Cash Flow stack at
          // its own index, so Analysis must be told it was opened from Summary
          // or its back control pops to the Financial Table instead.
          onPress={() =>
            router.push({ pathname: "/(tabs)/cash-flow/analytics", params: { from: "summary" } } as Href, {
              withAnchor: true,
            })
          }
        />
        <Divider />
        {hasMonthFlow ? (
          <>
            <Segmented
              noMargin
              options={[
                { value: "pie", label: tr.analysis.chartPie },
                { value: "bars", label: tr.analysis.chartBars },
              ]}
              value={chartType}
              onChange={setChartType}
            />
            <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
              {chartType === "pie" ? (
                <Donut
                  slices={monthDonut.slices}
                  supplementalSlices={monthDonut.supplementalSlices}
                  totalMinor={monthDonut.totalMinor}
                  size={shouldUseCompactChart(width) ? 144 : 168}
                />
              ) : (
                <Bars
                  width={Math.max(240, Math.min(width - spacing.xxl * 2, 640))}
                  groups={monthBars}
                  series={monthBarSeries}
                />
              )}
            </View>
          </>
        ) : (
          <Body muted style={{ marginTop: spacing.md }}>{tr.analysis.noResults}</Body>
        )}
      </Card>
    </Screen>
  );
}
