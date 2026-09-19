/** Dashboard: current balance, action-needed payments, upcoming timeline and
 * one concise monthly insight. Detailed exploration belongs to Analysis. */

import React, { useMemo } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import ArrowDownLeft from "lucide-react-native/icons/arrow-down-left";
import ArrowUpRight from "lucide-react-native/icons/arrow-up-right";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import ChartNoAxesColumn from "lucide-react-native/icons/chart-no-axes-column";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import History from "lucide-react-native/icons/rotate-ccw-clock";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import Plus from "lucide-react-native/icons/plus";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import TrendingDown from "lucide-react-native/icons/trending-down";
import TrendingUp from "lucide-react-native/icons/trending-up";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { balanceDeclarationDrift, parseBalanceDeclaration } from "../../domain/balance-declaration";
import { buildDashboardModel } from "../../domain/dashboard";
import { daysBetweenISO, firstDayOf, lastDayOf, monthKeyOf, todayISO, yearOf, type ISODate } from "../../domain/dates";
import { formatMinorCompact } from "../../domain/money";
import { AMOUNT_LABELS, needsVariableAmountEntry, occurrenceAmountText } from "../../domain/subscriptions";
import { buildUpcomingTimeline } from "../../domain/upcoming";
import { clockOrDateTimeLabel, dateLabel, dateTimeLabel, marketRateLabel, monthName, tr } from "../../i18n/tr";
import { useSession } from "../../auth/session";
import { kv } from "../../services/kv";
import {
  settingValue,
  useCategoriesState,
  useCardSettlement,
  useCreditCardStatementsState,
  useLedgerState,
  useSettingsMapState,
  usePendingExpectedState,
  usePersonsState,
  useRecurringIncomesState,
  useSourcesState,
  useSubscriptionsState,
  useUserId,
} from "../../data/hooks";
import { combineLiveStates } from "../../data/live-state";
import { confirmExpected, FxRateUnavailableError, revertExpected, setExpectedAmount } from "../../data/repo";
import { MARKET_SYMBOLS } from "../../domain/investment-catalog";
import { marketSellRateTry, retryMarkets, useMarkets } from "../../services/markets";
import { convertToTryMinor } from "../../domain/fx";
import { lookupRate, useFxRates } from "../../services/fx-fetch";
import { appAlert } from "../../ui/dialog";
import { scheduleSync } from "../../sync/engine";
import { Amount, Badge, Body, Button, Card, DataStateNotice, DisclosureChevron, Divider, Eyebrow, HeroCard, ListRow, MetricStrip, Row, Screen, SectionHeader, Segmented, Skeleton, Spread, STATUS_W } from "../../ui/components";
import { Collapse, useScreenFocus, useValueFlash } from "../../ui/motion-primitives";
import { Bars, ChartFrame, Donut, distributionDonutData, useSeriesColors } from "../../ui/charts";
import { CalendarSheet } from "../../ui/calendar";
import { ExpectedAmountSheet } from "../../ui/expected-amount-sheet";
import { BrandMark } from "../../ui/brand";
import { FirstRunTour } from "../../ui/tour";
import { useUndo } from "../../ui/undo";
import { errorNotice } from "../../ui/haptics";
import { marketTileColumns, shouldPairDashboardPanels, shouldSplitDashboardHero, shouldUseCompactChart, shouldUseLargeDonut } from "../../ui/responsive";
import { useContentWidth, useMeasuredWidth } from "../../ui/viewport";
import { interactionSurface } from "../../ui/interaction";
import { useWarmRoute } from "../../ui/route-warmup";
import { circle, controlSize, density, font, heroSurface, iconSize, radius, spacing, stateOpacity, type, useTheme } from "../../ui/theme";
import { devError } from "../../services/logger";
import { useOperationGuard } from "../../ui/operation-guard";

function MarketInstrumentArt({ code, size = 44 }: { code: string; size?: number }) {
  const { palette } = useTheme();
  const currency = code === "USDTRY" ? "$" : code === "EURTRY" ? "€" : null;
  const frame = {
    width: size,
    height: size,
    flexShrink: 0,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  };
  if (currency) {
    return (
      <View accessible={false} style={frame}>
        <View
          style={{
            width: 30,
            height: 22,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 5,
            borderWidth: 1,
            borderColor: palette.primary + "90",
            backgroundColor: palette.primarySoft,
          }}
        >
          <View style={{ position: "absolute", left: 3, top: 3, bottom: 3, width: 3, borderRadius: 2, backgroundColor: palette.primary + "90" }} />
          <View style={{ position: "absolute", right: 3, top: 3, bottom: 3, width: 3, borderRadius: 2, backgroundColor: palette.primary + "90" }} />
          <Text style={[type.heading, { color: palette.primaryText, fontFamily: font.bold, fontSize: type.body.fontSize }]}>{currency}</Text>
        </View>
      </View>
    );
  }

  if (code === "ALTIN") {
    return (
      <View accessible={false} style={frame}>
        <View
          style={{
            width: 30,
            height: 23,
            borderRadius: 5,
            borderWidth: 1,
            borderColor: palette.tertiary + "90",
            backgroundColor: palette.tertiarySoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View style={{ position: "absolute", left: 4, right: 4, top: 4, height: 3, borderRadius: 2, backgroundColor: palette.tertiary + "A0" }} />
          <Text style={[type.small, { color: palette.tertiaryText, fontFamily: font.bold, fontSize: type.micro.fontSize, marginTop: 5 }]}>Au</Text>
        </View>
      </View>
    );
  }

  const coinMark = code === "CEYREK_YENI" ? "¼" : code === "TEK_YENI" ? "1" : "C";
  return (
    <View accessible={false} style={frame}>
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: circle(30),
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1.5,
          borderColor: palette.tertiary,
          backgroundColor: palette.tertiarySoft,
        }}
      >
        <View style={{ position: "absolute", inset: 3, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.tertiary + "80" }} />
        <Text style={[type.small, { color: palette.tertiaryText, fontFamily: font.bold, fontSize: type.caption.fontSize }]}>{coinMark}</Text>
      </View>
    </View>
  );
}

/**
 * One live quote.
 *
 * Its own component because each tile owns a flash of its own: a feed tick is
 * the one thing in this app that changes without the user doing anything, and
 * the only sign it had happened was a number being different from the one
 * nobody was looking at. The tint is an opacity over a resting tile, so it
 * stays on the native driver, and it is armed only while the screen is the one
 * on show — a background tab must not animate.
 *
 * The provider re-sends a symbol only when its price moves, and the store
 * throttles to one apply every three seconds, so this is a punctuation mark
 * rather than a pulse.
 */
function QuoteTile({
  code,
  label,
  price,
  columns,
  cramped,
  live,
}: {
  code: string;
  label: string;
  price: { buyTry: number; sellTry: number; direction: "up" | "down" | "" };
  columns: number;
  cramped: boolean;
  live: boolean;
}) {
  const { palette } = useTheme();
  const router = useRouter();
  const flash = useValueFlash(price.sellTry, live);
  const direction = price.direction === "up"
    ? tr.markets.rising
    : price.direction === "down"
      ? tr.markets.falling
      : tr.markets.unchanged;
  const size = cramped ? 40 : 44;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr.markets.quote(label, marketRateLabel(price.buyTry), `${marketRateLabel(price.sellTry)}\u00A0₺`, direction)}
      accessibilityHint={tr.markets.openDetail(label)}
      onPress={() => router.push({ pathname: "/market-detail", params: { code } })}
      style={({ pressed }) => ({
        opacity: pressed ? stateOpacity.pressed : 1,
        flexGrow: 1,
        flexBasis: columns === 3 ? "29%" : columns === 2 ? "46%" : "100%",
        minWidth: 0,
        minHeight: columns === 3 ? 102 : 112,
        justifyContent: "space-between",
        padding: spacing.md,
        borderRadius: radius.md,
        backgroundColor: palette.surfaceAlt,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border + "70",
        overflow: "hidden",
      })}
    >
      {price.direction !== "" ? (
        <Animated.View
          pointerEvents="none"
          accessible={false}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            opacity: flash,
            backgroundColor: (price.direction === "up" ? palette.positive : palette.negative) + "24",
          }}
        />
      ) : null}
      <Row gap={spacing.xs} style={{ alignItems: "center" }}>
        <View style={{ width: size, height: size, flexShrink: 0 }}>
          <MarketInstrumentArt code={code} size={size} />
          {price.direction === "up" ? (
            <View style={{ position: "absolute", right: -2, top: -2, borderRadius: radius.sm, padding: 2, backgroundColor: palette.surface }}>
              <TrendingUp accessible={false} size={12} color={palette.positive} />
            </View>
          ) : price.direction === "down" ? (
            <View style={{ position: "absolute", right: -2, top: -2, borderRadius: radius.sm, padding: 2, backgroundColor: palette.surface }}>
              <TrendingDown accessible={false} size={12} color={palette.negative} />
            </View>
          ) : null}
        </View>
        <Body
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: font.semibold,
            fontSize: cramped ? type.label.fontSize : undefined,
            lineHeight: cramped ? 16 : undefined,
            textAlignVertical: "center",
          }}
        >
          {label}
        </Body>
      </Row>
      <View style={{ marginTop: spacing.sm, gap: 3 }}>
        <Spread>
          <Text style={[type.small, { color: palette.textSecondary }]}>{tr.markets.buy}</Text>
          <Text style={[type.amountSm, { color: palette.textSecondary, textAlign: "right" }]}>{marketRateLabel(price.buyTry)}</Text>
        </Spread>
        <Spread>
          <Text style={[type.small, { color: palette.textSecondary }]}>{tr.markets.sell}</Text>
          <Text style={[type.amount, { color: palette.text, textAlign: "right" }]}>
            {`${marketRateLabel(price.sellTry)}\u00A0₺`}
          </Text>
        </Spread>
      </View>
    </Pressable>
  );
}

function MarketsCard({ fill = false, desktopColumns = 2 }: { fill?: boolean; desktopColumns?: 2 | 3 }) {
  const { palette } = useTheme();
  // How many quote tiles fit is a question about this card, not about the
  // window: the same card is a full-width strip on a phone and one column of a
  // desktop pair, and only the card knows which.
  const [cardWidth, onCardLayout] = useMeasuredWidth(320);
  const userId = useUserId();
  const { prices, status, lastEventAt } = useMarkets();
  // A feed tick must not animate a card nobody is looking at.
  const focused = useScreenFocus();
  useFxRates();
  if (status === "idle") return null;

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
  const marketColumns = marketTileColumns(cardWidth, desktopColumns);
  // A tile is cramped by how much of the card it actually gets, not by the
  // window: two columns of a 358px phone card and two columns of a 500px
  // desktop column are different tiles.
  const crampedTile = cardWidth / marketColumns < 215;

  return (
    <>
      <SectionHeader>{tr.markets.title}</SectionHeader>
      <Card onLayout={onCardLayout} style={fill ? { flex: 1 } : undefined}>
        <Row
          gap={spacing.xs}
          style={{ justifyContent: "flex-end", marginBottom: spacing.xs }}
          accessible
          role="group"
          accessibilityLiveRegion="polite"
          accessibilityLabel={statusLabel}
        >
          {/* The dot claims liveness only once real quotes are flowing. */}
          <View accessible={false} style={{ width: 7, height: 7, borderRadius: circle(7), backgroundColor: status === "live" ? palette.success : palette.textSecondary }} />
          <Text style={[type.small, { color: palette.textSecondary, textAlign: "right", flexShrink: 1 }]}>{statusLabel}</Text>
        </Row>
        {quoted.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {quoted.map(({ code, label }) => (
              <QuoteTile
                key={code}
                code={code}
                label={label}
                price={prices[code]!}
                columns={marketColumns}
                cramped={crampedTile}
                live={focused}
              />
            ))}
          </View>
        ) : referenceRows.length > 0 ? (
          <>
            {referenceRows.map(({ label, rate }) => (
              <Spread
                key={label}
                accessible
                role="group"
                accessibilityLabel={`${label}. ${tr.markets.referenceRate(dateLabel(rate.rate.rateDate))}. ${marketRateLabel(rate.rate.rateTry)} ₺`}
                style={{ paddingVertical: spacing.sm - 2 }}
              >
                <View style={{ flexShrink: 1 }}>
                  <Body>{label}</Body>
                  <Text style={[type.small, { color: palette.textSecondary }]}>{tr.markets.referenceRate(dateLabel(rate.rate.rateDate))}</Text>
                </View>
                <Text style={[type.amount, { color: palette.text }]}>{`${marketRateLabel(rate.rate.rateTry)} ₺`}</Text>
              </Spread>
            ))}
            <Body muted style={{ marginTop: spacing.sm, fontSize: type.small.fontSize }}>{tr.markets.offlineHint}</Body>
          </>
        ) : (
          // The card is stretched to its neighbour's height when the two share
          // a desktop row, so a single sentence pinned to the top left leaves
          // the column looking abandoned. One line of copy centres in the space
          // it was given instead.
          <View style={fill ? { flex: 1, justifyContent: "center", paddingVertical: spacing.lg } : undefined}>
            <Body muted style={{ textAlign: fill ? "center" : "left", maxWidth: 380, alignSelf: fill ? "center" : "auto" }}>
              {tr.markets.noData}
            </Body>
            {/* Something to do, and the truth about what is already happening.
                An empty card the height of the payment list beside it offered
                neither. */}
            {status !== "connecting" ? (
              <View style={{ marginTop: spacing.md, alignItems: fill ? "center" : "flex-start" }}>
                <Button
                  variant="secondary"
                  icon={RefreshCw}
                  label={tr.markets.retryNow}
                  onPress={() => retryMarkets()}
                />
                <Body muted style={{ marginTop: spacing.sm, fontSize: type.small.fontSize, textAlign: fill ? "center" : "left" }}>
                  {tr.markets.autoRetry}
                </Body>
              </View>
            ) : null}
          </View>
        )}
      </Card>
    </>
  );
}

/**
 * Re-render when the wall clock crosses an hour.
 *
 * The greeting and the date under it are both read from `new Date()` at render
 * time and nothing asked for another render, so a session left open said "İyi
 * günler" at 19:00 and was still saying "İyi akşamlar" — over yesterday's date
 * — at three in the morning. The timer is armed to the next hour boundary
 * rather than to a fixed interval, so it fires once an hour on the hour and
 * costs one render.
 */
function useHourTick(): number {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(now.getHours() + 1, 0, 0, 0);
    const timer = setTimeout(() => setTick((value) => value + 1), next.getTime() - now.getTime());
    return () => clearTimeout(timer);
  }, [tick]);
  return tick;
}

const CHART_TYPE_KEY = "helix.dashboard.chart";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return tr.dashboard.greetingNight;
  if (hour < 12) return tr.dashboard.greetingMorning;
  if (hour < 18) return tr.dashboard.greetingDay;
  return tr.dashboard.greetingEvening;
}

type Expected = ReturnType<typeof usePendingExpectedState>["data"][number];

/** Everything the dashboard reads, and the month model built from it. */
function useDashboardData() {
  const userId = useUserId();
  const today = todayISO();
  const year = yearOf(today);
  const month = monthKeyOf(today);
  const ledgerState = useLedgerState(year);
  const settingsState = useSettingsMapState();
  const categoriesState = useCategoriesState();
  const personsState = usePersonsState();
  const expectedState = usePendingExpectedState();
  const subscriptionsState = useSubscriptionsState();
  const incomesState = useRecurringIncomesState();
  const sourcesState = useSourcesState();
  const cardStatementsState = useCreditCardStatementsState();
  const bundle = ledgerState.data;
  const categories = categoriesState.data;
  const expected = expectedState.data;
  const subscriptions = subscriptionsState.data;
  const incomes = incomesState.data;
  // Payments recorded by hand. A partly paid statement still owes the rest on
  // the list, and its charges no longer come off the forecast (spec §3.1f).
  const { byStatement } = useCardSettlement();
  const statementPaidMinor = useMemo(
    () => new Map([...byStatement.values()].map((settled) => [settled.statementId, settled.paidMinor])),
    [byStatement],
  );
  const partlyPaidStatementIds = useMemo(
    () => new Set([...byStatement.values()].filter((settled) => settled.paidInFullOn == null).map((settled) => settled.statementId)),
    [byStatement],
  );
  const live = combineLiveStates([ledgerState, categoriesState, personsState, expectedState, subscriptionsState, incomesState, sourcesState, cardStatementsState]);
  // Re-render when FX rates land so foreign-currency projections settle.
  useFxRates();

  // Its own memo, so the empty-ledger fallback is one stable array rather than
  // a new one per render feeding everything derived from it.
  const txLike = useMemo(() => bundle?.txLike ?? [], [bundle]);
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const subscriptionById = useMemo(() => new Map(subscriptions.map((s) => [s.id, s])), [subscriptions]);
  const incomeById = useMemo(() => new Map(incomes.map((income) => [income.id, income])), [incomes]);
  const catName = React.useCallback((id: string | null) => (id ? categoryById.get(id)?.name : undefined), [categoryById]);
  // Missing FX stays missing; a foreign amount is never treated as TRY.
  const expectedTryMinor = (currency: string, amountMinor: number): number | null => {
    if (currency === "TRY") return amountMinor;
    const rateTry = marketSellRateTry(currency) ?? lookupRate(userId, currency)?.rate.rateTry ?? null;
    return rateTry == null ? null : convertToTryMinor(amountMinor, rateTry);
  };
  // Deliberately NOT memoized: `expectedTryMinor` reads the live market store,
  // which this screen does not subscribe to, so a dependency list would pin a rate.
  const model = buildDashboardModel({
    transactions: txLike,
    expected,
    ledger: bundle?.ledger ?? [],
    actualBalanceMinor: bundle?.actualBalanceMinor ?? null,
    today,
    monthStart: firstDayOf(month),
    monthEnd: lastDayOf(month),
    currentMonth: month,
    year,
    expectedTryMinor,
    partlyPaidStatementIds,
  });
  // Derived from every transaction the account has, so from the data and not the render.
  const upcoming = useMemo(() => buildUpcomingTimeline({
    expected,
    transactions: txLike,
    expectedSources: [
      ...subscriptions.map((subscription) => ({ id: subscription.id, name: subscription.name, sourceType: "subscription" as const, categoryName: catName(subscription.categoryId) ?? null })),
      ...incomes.map((income) => ({ id: income.id, name: income.name, sourceType: "recurring_income" as const, categoryName: catName(income.categoryId) ?? null })),
    ],
    categories: categories.map((category) => ({ id: category.id, name: category.name })),
    cards: sourcesState.data.filter((source) => source.type === "credit_card"),
    statements: cardStatementsState.data,
    statementPaidMinor,
    today,
    horizonDays: 31,
  }).filter((item) => item.status === "upcoming"),
  [expected, txLike, subscriptions, incomes, categories, sourcesState.data, cardStatementsState.data, statementPaidMinor, today, catName]);

  return {
    userId, today, month, bundle, expected, model, upcoming, categoryById, subscriptionById, incomeById, live,
    selfPersonId: personsState.data.find((p) => p.isSelf)?.id,
    nameOf: (e: Expected) => subscriptionById.get(e.refId)?.name ?? incomeById.get(e.refId)?.name ?? tr.common.paymentFallback,
    // "You told me X; the table says Y" — the ledger has moved away from the last
    // figure the user confirmed against a real account.
    balanceDrift: balanceDeclarationDrift(
      parseBalanceDeclaration(settingValue<unknown>(settingsState.data, "balance_declared", null)),
      bundle?.actualBalanceMinor ?? null,
    ),
  };
}

type DashboardData = ReturnType<typeof useDashboardData>;

/** Marking an expected payment paid on the day it was paid, or entering a variable bill's amount first. */
function useExpectedActions(data: DashboardData) {
  const { userId, today, selfPersonId, subscriptionById, incomeById } = data;
  const undo = useUndo();
  const operationGuard = useOperationGuard();
  const [paying, setPaying] = React.useState<Expected | null>(null);
  const [amountEditing, setAmountEditing] = React.useState<Expected | null>(null);
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  const open = (e: Expected) => (needsVariableAmountEntry(e, subscriptionById) ? setAmountEditing(e) : setPaying(e));
  const confirm = (e: Expected, paidOn: ISODate) => operationGuard.run(async () => {
    if (!selfPersonId) return;
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
      undo.show(`${data.nameOf(e)} ✓`, () => revertExpected(userId, e.id));
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
  const sheets = (
    <>
      {/* "When did you pay?" — records the actual paid day, so an early or manual
          payment realizes on that date. Future days disabled. */}
      {paying ? (
        <CalendarSheet
          value={paying.dueDate <= today ? (paying.dueDate as ISODate) : today}
          max={today}
          onSelect={(iso) => void confirm(paying, iso)}
          onClose={() => setPaying(null)}
        />
      ) : null}
      {amountEditing ? (
        <ExpectedAmountSheet
          currency={amountEditing.currency}
          currentMinor={amountEditing.amountMinor}
          isEstimated={amountEditing.amountIsEstimated === true}
          onSave={async (amountMinor) => {
            await setExpectedAmount(userId, amountEditing.id, amountMinor);
            scheduleSync(userId);
            undo.show(tr.subs.amountEntrySaved);
          }}
          onClose={() => setAmountEditing(null)}
          onError={(error) => {
            devError("dashboard.amount", error);
            void appAlert(tr.errors.saveFailed);
          }}
        />
      ) : null}
    </>
  );
  return { open, confirmingId, sheets, needsAmountEntry: (e: Expected) => needsVariableAmountEntry(e, subscriptionById) };
}

/** The ledger has moved away from the last figure the owner confirmed; the mark opens the screen that says by how much. */
function BalanceDriftPill() {
  const router = useRouter();
  const { palette } = useTheme();
  return (
    // The painted pill stays compact beside a label in a hero, but the PRESSABLE
    // is the platform minimum: an 18pt pill navigated, and react-native-web does
    // not implement `hitSlop` to rescue it.
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr.settings.balanceDriftTitle}
      onPress={() => router.push("/opening-balance")}
      style={{ minHeight: controlSize.minimumTarget, justifyContent: "center" }}
    >
      {(state) => (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
            borderRadius: radius.full,
            backgroundColor: palette.warning + "1C",
            ...interactionSurface(palette, state, { base: palette.warning + "1C" }),
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.warning + "80",
          }}
        >
          <TriangleAlert accessible={false} size={iconSize.compact} color={palette.warningText} strokeWidth={2.4} />
          <Text style={[type.small, { color: palette.warningText, fontFamily: font.semibold }]}>{tr.settings.balanceDriftShort}</Text>
        </View>
      )}
    </Pressable>
  );
}

function ForecastToggle({ projected, actual, open, onToggle, wide }: { projected: number; actual: number; open: boolean; onToggle: () => void; wide: boolean }) {
  const { palette } = useTheme();
  const rising = projected - actual >= 0;
  return (
    <Pressable
      testID="dashboard-forecast-toggle"
      accessibilityRole="button"
      accessibilityLabel={`${tr.dashboard.forecastToggle} ${rising ? tr.dashboard.forecastRising : tr.dashboard.forecastFalling}`}
      aria-expanded={open}
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={(state) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        marginTop: spacing.md,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: palette.border,
        // The row reaches the rule below it with its own PADDING, symmetric as
        // `resilience.spec.ts` requires: a cancelled margin put the rule through
        // the lit band. The wide layout draws that rule beside this column instead.
        ...(wide ? { paddingVertical: spacing.md, marginBottom: -spacing.md } : { paddingVertical: spacing.lg }),
        ...interactionSurface(palette, state),
      })}
    >
      {/* Direction is carried by the glyph, never by colour: a forecast that fell
          but stayed positive once showed a red arrow beside a green number. */}
      {rising
        ? <TrendingUp accessible={false} size={iconSize.accessory} color={palette.textSecondary} />
        : <TrendingDown accessible={false} size={iconSize.accessory} color={palette.textSecondary} />}
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text style={[type.label, { color: palette.textSecondary }]}>{tr.dashboard.forecastToggle}</Text>
        <Amount minor={projected} colorized={false} color={projected >= 0 ? palette.positiveText : palette.negativeText} style={{ textAlign: "left" }} />
      </View>
      <DisclosureChevron open={open} size={18} color={palette.accentText} />
    </Pressable>
  );
}

function BalanceHero({ data, wide, showForecast, onToggleForecast }: { data: DashboardData; wide: boolean; showForecast: boolean; onToggleForecast: () => void }) {
  const router = useRouter();
  const { palette, scheme } = useTheme();
  const heroInk = heroSurface(palette, scheme).ink;
  const { bundle, model, month } = data;
  if (!bundle) {
    return (
      <HeroCard>
        {/* Same label and amount line heights as the loaded state, so the hero
            does not change height when the figures arrive. */}
        <Skeleton width={120} height={type.label.fontSize} />
        <Skeleton width={208} height={type.amountLg.fontSize} style={{ marginTop: spacing.xs }} />
      </HeroCard>
    );
  }
  const projected = model.projectedMinor;
  const incomeMinor = model.distribution.incomeTotalMinor;
  const outflowMinor = model.distribution.expenseTotalMinor + model.distribution.transferTotalMinor;
  return (
    <HeroCard>
      <View style={wide ? { flexDirection: "row", alignItems: "stretch" } : undefined}>
        <View style={wide ? { flex: 1, paddingRight: spacing.xl, justifyContent: "center" } : undefined}>
          <Row gap={spacing.sm} style={{ alignItems: "center" }}>
            <Eyebrow color={heroInk}>{tr.dashboard.actualBalance}</Eyebrow>
            {data.balanceDrift != null ? <BalanceDriftPill /> : null}
          </Row>
          <Amount
            testID="dashboard-current-balance"
            minor={bundle.actualBalanceMinor}
            hero
            count
            colorized={false}
            color={heroInk}
            style={{ marginTop: spacing.xs, textAlign: "left" }}
          />
          {projected != null ? <ForecastToggle projected={projected} actual={bundle.actualBalanceMinor} open={showForecast} onToggle={onToggleForecast} wide={wide} /> : null}
        </View>
        <View
          accessible={false}
          style={wide
            ? { width: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginHorizontal: spacing.xl }
            // The forecast row owns the space down to this line, so its hover ends ON
            // the rule; the full gap returns when that row is absent.
            : { height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginTop: projected != null ? 0 : spacing.lg, marginBottom: spacing.lg }}
        />
        <View style={wide ? { flex: 1, paddingLeft: spacing.xl, justifyContent: "space-between" } : undefined}>
          <View>
            <Eyebrow>{monthName(month)}</Eyebrow>
            <MetricStrip
              testID="dashboard-month-metrics"
              style={{ marginTop: spacing.md }}
              // The three figures share one line and shorten together on the
              // shared compact scale rather than dropping "Net değişim" a row.
              items={[
                { label: tr.cashflow.income, minor: incomeMinor, color: palette.positiveText },
                { label: tr.dashboard.outflow, minor: -outflowMinor, color: palette.negativeText },
                { label: tr.dashboard.netChange, minor: incomeMinor - outflowMinor },
              ]}
            />
          </View>
          {/* One door per destination: the warning card above already opens reconciliation. */}
          <Row style={{ marginTop: spacing.lg }}>
            <View style={{ flex: 1 }}>
              <Button icon={Plus} label={tr.cashflow.addTransaction} onPress={() => router.push("/transaction")} />
            </View>
          </Row>
        </View>
      </View>
    </HeroCard>
  );
}

/** A line of the forecast's arithmetic. */
function ForecastLine({ label, minor, color }: { label: string; minor: number; color?: string }) {
  return (
    <Spread style={{ marginBottom: spacing.xs }}>
      <Body muted={color == null} style={color ? { color } : undefined}>{label}</Body>
      <Amount minor={minor} colorized={color == null} color={color} />
    </Spread>
  );
}

function ForecastPanel({ data }: { data: DashboardData }) {
  const { palette } = useTheme();
  const { bundle, model } = data;
  const projected = model.projectedMinor;
  if (!bundle || projected == null) return null;
  const resultColor = projected >= 0 ? palette.positiveText : palette.negativeText;
  return (
    <Card style={{ marginBottom: 0 }}>
      {/* One sentence: what the figure is, and that today's balance is not it. */}
      <Body muted style={{ fontSize: type.small.fontSize, marginBottom: spacing.sm }}>{tr.dashboard.forecastHint}</Body>
      <ForecastLine label={tr.dashboard.forecastCurrent} minor={bundle.actualBalanceMinor} />
      {model.incomingMinor > 0 ? <ForecastLine label={tr.dashboard.forecastIncoming} minor={model.incomingMinor} color={palette.positiveText} /> : null}
      {model.outgoingMinor > 0 ? <ForecastLine label={tr.dashboard.forecastOutgoing} minor={-model.outgoingMinor} color={palette.negativeText} /> : null}
      <Divider />
      <Spread>
        <Body style={{ fontFamily: font.semibold }}>{tr.dashboard.forecastResult}</Body>
        <Amount minor={projected} colorized={false} color={resultColor} />
      </Spread>
      {/* The figure above sums what is KNOWN. This is the month once the spending
          no rule predicts happens too — measured from history, not recorded, so
          it sits below the result where a reader can tell the two apart. */}
      {model.expectedVariableMinor != null && model.expectedVariableMinor > 0 ? (
        <>
          <Spread style={{ marginTop: spacing.xs }}>
            <Body muted>{tr.dashboard.forecastTypical}</Body>
            <Amount minor={projected - model.expectedVariableMinor} colorized={false} color={palette.textSecondary} />
          </Spread>
          <Body muted style={{ fontSize: type.small.fontSize, marginTop: spacing.xs }}>
            {tr.dashboard.forecastTypicalHint(formatMinorCompact(model.expectedVariableMinor))}
          </Body>
        </>
      ) : null}
    </Card>
  );
}

function MonthInsightCard({ data }: { data: DashboardData }) {
  const router = useRouter();
  const { palette } = useTheme();
  const contentWidth = useContentWidth();
  const chartColors = useSeriesColors();
  // Remembered, like the ledger's own view mode and pins: coming back from
  // another tab used to put the pie chart back.
  const [chartType, setChartType] = React.useState<"pie" | "bars">("pie");
  React.useEffect(() => {
    void kv.get(CHART_TYPE_KEY).then((value) => {
      if (value === "pie" || value === "bars") setChartType(value);
    });
  }, []);
  const { distribution } = data.model;
  const incomeMinor = distribution.incomeTotalMinor;
  const outflowMinor = distribution.expenseTotalMinor + distribution.transferTotalMinor;
  const donut = distributionDonutData(distribution, chartColors, (id) => data.categoryById.get(id)?.name ?? tr.common.none);
  const hasFlow = incomeMinor !== 0 || donut.slices.length > 0 || donut.supplementalSlices.length > 0;
  return (
    <>
      <SectionHeader>{tr.dashboard.monthInsight}</SectionHeader>
      {/* `rows`, because the first child is a pressable row whose hover must
          reach the card's top edge; the block below gives the padding back. */}
      <Card rows>
        <ListRow
          icon={ChartNoAxesColumn}
          title={tr.dashboard.monthNet(formatMinorCompact(incomeMinor - outflowMinor))}
          // Signed, like the hero strip above it: Gelir + Çıkış = Net değişim
          // only reads as arithmetic when the outflow carries its sign.
          subtitle={tr.dashboard.monthFlowSummary(formatMinorCompact(incomeMinor), formatMinorCompact(-outflowMinor))}
          chevron
          // Root-level route, so the iOS edge swipe pops back to this screen and
          // not to the Cash Flow tab's own index.
          onPress={() => router.push("/analytics")}
        />
        {/* Flush, because the row above carries its own padding and the hover fill must reach the rule. */}
        <Divider flush />
        <View style={{ paddingTop: spacing.sm, paddingBottom: density.list.cardPadding }}>
          {hasFlow ? (
            <>
              <Segmented
                noMargin
                options={[{ value: "pie", label: tr.analysis.chartPie }, { value: "bars", label: tr.analysis.chartBars }]}
                value={chartType}
                onChange={(value) => {
                  setChartType(value);
                  void kv.set(CHART_TYPE_KEY, value);
                }}
              />
              {/* No `alignItems: center`: the chart lays its ring and legend out as
                  one centred row, and a centred wrapper collapsed that row. */}
              <View style={{ marginTop: spacing.lg }}>
                {chartType === "pie" ? (
                  <Donut
                    slices={donut.slices}
                    supplementalSlices={donut.supplementalSlices}
                    totalMinor={donut.totalMinor}
                    // A ceiling per class of viewport; `Donut` fits whatever box it gets.
                    size={shouldUseCompactChart(contentWidth) ? 152 : shouldUseLargeDonut(contentWidth) ? 300 : 236}
                  />
                ) : (
                  <ChartFrame>
                    {(chartWidth) => (
                      <Bars
                        width={chartWidth}
                        groups={[{ label: monthName(data.month), values: [incomeMinor, distribution.expenseTotalMinor, distribution.transferTotalMinor] }]}
                        series={[
                          { label: tr.cashflow.income, color: palette.positive },
                          { label: tr.cashflow.expense, color: palette.negative },
                          { label: tr.cashflow.transfer, color: palette.secondary },
                        ]}
                      />
                    )}
                  </ChartFrame>
                )}
              </View>
            </>
          ) : (
            <Body muted style={{ marginTop: spacing.md }}>{tr.analysis.noResults}</Body>
          )}
        </View>
      </Card>
    </>
  );
}

/** A compact calendar picture gives an otherwise empty equal-height desktop panel weight without inventing a payment. */
function UpcomingEmpty({ fill }: { fill: boolean }) {
  const router = useRouter();
  const { palette } = useTheme();
  const dots = (size: number) => (
    <View style={{ flexDirection: "row", gap: 4 }}>
      {[palette.surfaceStrong, palette.surfaceStrong, palette.primary].map((color, index) => (
        <View key={index} style={{ width: size, height: size, borderRadius: circle(size), backgroundColor: color }} />
      ))}
    </View>
  );
  return (
    <Card style={fill ? { flex: 1 } : undefined}>
      <View style={fill ? { flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.sm } : { alignItems: "center", gap: spacing.sm }}>
        <View
          accessible={false}
          style={{
            width: fill ? "76%" : 84,
            maxWidth: 300,
            height: fill ? 170 : 68,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: palette.border + "70",
            backgroundColor: palette.surfaceAlt,
          }}
        >
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: fill ? 8 : 6, backgroundColor: palette.primary }} />
          {fill ? (
            <View style={{ alignSelf: "stretch", flex: 1, padding: spacing.lg, paddingTop: spacing.xl }}>
              <Spread style={{ marginBottom: spacing.md }}>
                <CalendarClock size={22} color={palette.accentText} strokeWidth={1.8} />
                {dots(6)}
              </Spread>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {Array.from({ length: 20 }, (_, index) => (
                  <View
                    key={index}
                    style={{
                      flexBasis: "16%",
                      flexGrow: 1,
                      height: 15,
                      borderRadius: 3,
                      backgroundColor: index === 17 ? palette.primarySoft : palette.surface,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: index === 17 ? palette.primary + "70" : palette.border + "50",
                    }}
                  />
                ))}
              </View>
            </View>
          ) : (
            <>
              <CalendarClock size={25} color={palette.accentText} strokeWidth={1.8} />
              <View style={{ position: "absolute", bottom: spacing.sm }}>{dots(5)}</View>
            </>
          )}
        </View>
        <Body muted style={{ textAlign: "center" }}>{tr.dashboard.noUpcoming}</Body>
      </View>
      <View style={{ marginTop: spacing.xs }}>
        <Button label={tr.dashboard.allUpcoming} variant="ghost" size="sm" onPress={() => router.push("/upcoming" as Href)} />
      </View>
    </Card>
  );
}

const TIMELINE_TYPE_LABELS = {
  recurring_income: () => tr.dashboard.expectedIncome,
  subscription: () => tr.subs.title,
  scheduled_transaction: () => tr.dashboard.scheduledTx,
  card_statement: () => tr.dashboard.cardStatement,
};

function UpcomingPanel({ data, actions, fill }: { data: DashboardData; actions: ReturnType<typeof useExpectedActions>; fill: boolean }) {
  const router = useRouter();
  const { palette } = useTheme();
  const { model, upcoming, today, expected } = data;
  const status = data.live.status;
  // One rule for how an estimated amount reads, shared with the catch-up and upcoming screens.
  const amountFragment = (item: { amountMinor: number; currency: string; amountIsEstimated?: boolean }) => occurrenceAmountText(item, formatMinorCompact, AMOUNT_LABELS);
  const late = model.lateItems.slice(0, 5);
  const coming = upcoming.slice(0, Math.max(0, 5 - late.length));
  const payButton = (id: string, direction: string, entry: boolean, onPress: () => void) => (
    <View style={{ width: STATUS_W }}>
      <Button
        size="sm"
        label={entry ? tr.subs.enterAmount : direction === "in" ? tr.dashboard.received : tr.dashboard.markPaid}
        variant="secondary"
        tone={direction === "in" ? "positive" : "primary"}
        loading={actions.confirmingId === id}
        disabled={actions.confirmingId != null}
        onPress={onPress}
      />
    </View>
  );
  if (status === "error") return null;
  if (status === "loading") {
    return (
      /* The panel keeps its shape instead of leaving a gap the real card later
         pushes open; three rows is what an ordinary account shows. */
      <Card style={fill ? { flex: 1 } : undefined}>
        {[0, 1, 2].map((row) => (
          <Row key={row} gap={spacing.md} style={{ alignItems: "center", paddingVertical: spacing.md - 2 }}>
            <Skeleton width={24} height={24} radius={radius.sm} />
            <View style={{ flex: 1, gap: 6 }}>
              <Skeleton width="60%" height={type.body.fontSize} />
              <Skeleton width="40%" height={type.small.fontSize} />
            </View>
            <Skeleton width={STATUS_W} height={controlSize.minimumTarget} radius={radius.md} />
          </Row>
        ))}
      </Card>
    );
  }
  if ((model.lateItems.length === 0 && upcoming.length === 0) || !data.selfPersonId) return <UpcomingEmpty fill={fill} />;
  return (
    <Card rows style={fill ? { flex: 1 } : undefined}>
      <View style={fill ? { flexGrow: 1 } : undefined}>
        {late.map((e) => (
          <ListRow
            key={e.id}
            icon={e.direction === "in" ? ArrowDownLeft : ArrowUpRight}
            iconColor={palette.error}
            title={data.nameOf(e)}
            subtitle={`${tr.dashboard.late} · ${dateLabel(e.dueDate)} · ${amountFragment(e)}`}
            right={payButton(e.id, e.direction, actions.needsAmountEntry(e), () => actions.open(e))}
          />
        ))}
        {coming.map((u) => {
          const expectedItem = u.kind === "expected" ? expected.find((item) => item.id === u.expectedId) : undefined;
          return (
            <ListRow
              key={u.key}
              icon={u.direction === "in" ? ArrowDownLeft : CalendarClock}
              iconColor={u.direction === "in" ? palette.positive : undefined}
              title={u.name ?? u.categoryName ?? tr.common.paymentFallback}
              subtitle={`${TIMELINE_TYPE_LABELS[u.sourceType]()} · ${tr.dashboard.inDays(daysBetweenISO(today, u.date))} · ${amountFragment(u)}${u.paidMinor ? ` · ${tr.dashboard.cardStatementPaid(formatMinorCompact(u.paidMinor))}` : ""}`}
              // A card statement is a due date derived from the card's charges, not
              // a payment to confirm, so it opens that statement — at a ROOT-level
              // route, since a screen pushed into the Mali Tablo tab's stack stayed
              // there until restart (see `src/app/installments.tsx`).
              onPress={u.kind === "card_statement"
                ? () => router.push({ pathname: "/card-statement", params: { card: u.refId, ...(u.statementId ? { statement: u.statementId } : {}) } })
                : undefined}
              chevron={u.kind === "card_statement"}
              right={u.kind === "expected" && u.expectedId
                ? payButton(u.expectedId, u.direction, Boolean(u.amountIsEstimated), () => {
                    if (expectedItem) actions.open(expectedItem);
                  })
                : undefined}
            />
          );
        })}
      </View>
      {/* The trailing link action is `sm`, like every other one: a regular
          button's height left the card's top and bottom gaps uneven. */}
      <Row gap={spacing.sm}>
        <View style={{ flex: 1 }}>
          <Button label={tr.dashboard.allUpcoming} variant="ghost" size="sm" onPress={() => router.push("/upcoming" as Href)} />
        </View>
        {/* The inbox is the actionable half of the same data: what waits for a decision. */}
        <View style={{ flex: 1 }}>
          <Button testID="dashboard-attention-link" label={tr.attention.title} variant="ghost" size="sm" onPress={() => router.push("/attention" as Href)} />
        </View>
      </Row>
    </Card>
  );
}

export default function DashboardScreen() {
  // The ledger is the tab this app exists for and the most expensive one to
  // create. Built while the navigator is fading between two scenes it drops
  // frames once, on the first arrival; built here, in idle, it drops none.
  useWarmRoute("cash-flow");
  useHourTick();
  const previousLoginAt = useSession((state) => state.previousLoginAt);
  const router = useRouter();
  const { palette } = useTheme();
  const contentWidth = useContentWidth();
  const data = useDashboardData();
  const actions = useExpectedActions(data);
  const [showForecast, setShowForecast] = React.useState(false);
  const late = data.model.lateItems;
  const paired = shouldPairDashboardPanels(contentWidth);
  return (
    <Screen
      title={greeting()}
      subtitle={dateLabel(data.today)}
      // The rail carries the mark at desktop widths; phones have no rail, so the greeting keeps it.
      leading={<BrandMark size={40} />}
      width="workspace"
    >
      <FirstRunTour />
      <DataStateNotice status={data.live.status} retry={data.live.retry} />
      {previousLoginAt ? (
        <View style={{ marginBottom: spacing.sm, alignSelf: "flex-start" }}>
          <Badge icon={ShieldCheck} text={tr.dashboard.lastLogin(dateTimeLabel(previousLoginAt))} />
        </View>
      ) : null}
      {actions.sheets}
      {/* Shown only while payments are actually overdue, derived from live data,
          so it clears itself the moment the last item is confirmed. */}
      {late.length > 0 ? (
        <Card tone="warning" onPress={() => router.push("/reconciliation")}>
          <Row>
            <History accessible={false} size={20} color={palette.warning} />
            <View style={{ flex: 1 }}>
              <Body>{tr.dashboard.pendingConfirm(late.length)}</Body>
              <Body muted>{tr.dashboard.catchUp}</Body>
            </View>
            <ChevronRight accessible={false} size={18} color={palette.textSecondary} />
          </Row>
        </Card>
      ) : null}
      <BalanceHero data={data} wide={shouldSplitDashboardHero(contentWidth)} showForecast={showForecast} onToggleForecast={() => setShowForecast((v) => !v)} />
      {/* Collapses rather than blinking: the toggle that opens it sits directly above. */}
      <Collapse open={Boolean(data.bundle) && showForecast && data.model.projectedMinor != null}>
        <ForecastPanel data={data} />
      </Collapse>
      {/* The month owns its own row, reading across; the two panels share the one
          under it, the task taking the larger share of attention. */}
      <MonthInsightCard data={data} />
      {/* Equal columns, equal heights: a row whose two cards end at different
          heights reads as one of them having failed to load. */}
      <View style={paired ? { flexDirection: "row", alignItems: "stretch", gap: spacing.lg } : undefined}>
        <View style={paired ? { flex: 1, minWidth: 0 } : undefined}>
          <SectionHeader>{tr.dashboard.upcoming}</SectionHeader>
          <UpcomingPanel data={data} actions={actions} fill={paired} />
        </View>
        <View style={paired ? { flex: 1, minWidth: 0 } : undefined}>
          <MarketsCard fill={paired} desktopColumns={late.length + data.upcoming.length <= 3 ? 3 : 2} />
        </View>
      </View>
    </Screen>
  );
}
