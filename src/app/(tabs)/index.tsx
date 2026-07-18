/** Dashboard: current balance, action-needed payments, upcoming timeline and
 * one concise monthly insight. Detailed exploration belongs to Analysis. */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ArrowDownLeft, ArrowUpRight, CalendarClock, ChartNoAxesColumn, ChevronDown, ChevronRight, ChevronUp, History, PartyPopper, Plus, TrendingDown, TrendingUp } from "lucide-react-native";
import { buildDashboardModel } from "../../domain/dashboard";
import { firstDayOf, lastDayOf, monthKeyOf, todayISO, yearOf, type ISODate } from "../../domain/dates";
import { formatMinor } from "../../domain/money";
import { standaloneUpcomingTransactions, upcomingCardStatements } from "../../domain/upcoming";
import { dateLabel, dateTimeLabel, tr } from "../../i18n/tr";
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
import { projectedTransactionFlow } from "../../domain/transactions";
import { lookupRate, useFxRates } from "../../services/fx-fetch";
import { appAlert } from "../../ui/dialog";
import { scheduleSync } from "../../sync/engine";
import { Amount, Body, Button, Card, DataStateNotice, EmptyState, Heading, HeroCard, ListRow, Row, Screen, SectionHeader, Spread, STATUS_W, StatusPill } from "../../ui/components";
import { CalendarSheet } from "../../ui/calendar";
import { BrandMark } from "../../ui/brand";
import { FirstRunTour } from "../../ui/tour";
import { useUndo } from "../../ui/undo";
import { errorNotice } from "../../ui/haptics";
import { font, radius, spacing, type, useTheme } from "../../ui/theme";
import { devError } from "../../services/logger";
import { useOperationGuard } from "../../ui/operation-guard";

// Fixed column widths keep buy/sell figures right-aligned across rows (and
// give the connecting-state placeholders the exact final geometry).
const MARKET_BUY_W = 78;
const MARKET_SELL_W = 92;
const MARKET_TREND_W = 15;

function MarketsCard() {
  const { palette } = useTheme();
  const { prices, status } = useMarkets();
  // While connecting, the card renders at full height with per-symbol "—"
  // placeholders instead of returning null — quotes fill in without the card
  // popping in above the content (layout shift). A dead feed remains visible
  // as an honest unavailable state so the feature never silently disappears.
  if (status === "idle") return null;

  const priceText = (v: number) =>
    new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  return (
    <Card>
      <Spread style={{ marginBottom: spacing.xs, alignItems: "flex-start" }}>
        <View style={{ flex: 1, paddingRight: spacing.md }}>
          <Heading style={{ marginVertical: 0 }}>{tr.markets.title}</Heading>
          <Text style={[type.small, { color: palette.textMuted, marginTop: 2 }]}>{tr.markets.source}</Text>
        </View>
        <Row
          gap={spacing.xs}
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel={status === "live"
            ? tr.markets.live
            : status === "stale"
              ? tr.markets.reconnecting
              : status === "connecting"
                ? tr.markets.connecting
                : tr.markets.unavailableShort}
        >
          {/* The dot claims liveness only once real quotes are flowing. */}
          <View accessible={false} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: status === "live" ? palette.positive : palette.textMuted }} />
          <Text style={[type.small, { color: palette.textMuted }]}>
            {status === "live"
              ? tr.markets.live
              : status === "stale"
                ? tr.markets.reconnecting
                : status === "connecting"
                  ? tr.markets.connecting
                  : tr.markets.unavailableShort}
          </Text>
        </Row>
      </Spread>
      {status === "error" ? (
        <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ paddingVertical: spacing.md }}>
          <Body muted>{tr.markets.unavailable}</Body>
          <Body muted style={{ fontSize: 12, marginTop: spacing.xs }}>{tr.markets.fallback}</Body>
        </View>
      ) : (
        <>
      {/* column headers over the price columns */}
      <Spread style={{ marginBottom: spacing.xs }}>
        <View />
        <Row gap={spacing.sm}>
          <Text style={[type.small, { color: palette.textMuted, minWidth: MARKET_BUY_W, textAlign: "right" }]}>{tr.markets.buy}</Text>
          <Text style={[type.small, { color: palette.textMuted, minWidth: MARKET_SELL_W, textAlign: "right" }]}>{tr.markets.sell}</Text>
          <View style={{ width: MARKET_TREND_W }} />
        </Row>
      </Spread>
      {MARKET_SYMBOLS.map(({ code, label }) => {
        const p = prices[code];
        const direction = p?.direction === "up"
          ? tr.markets.rising
          : p?.direction === "down"
            ? tr.markets.falling
            : tr.markets.unchanged;
        const accessibilityLabel = p
          ? tr.markets.quote(label, priceText(p.buyTry), `${priceText(p.sellTry)} ₺`, direction)
          : tr.markets.quoteUnavailable(label);
        return (
          <Spread key={code} accessible accessibilityLabel={accessibilityLabel} style={{ paddingVertical: spacing.sm - 2 }}>
            <Body>{label}</Body>
            <Row gap={spacing.sm}>
              <Text style={[type.amountSm, { color: palette.textMuted, minWidth: MARKET_BUY_W, textAlign: "right" }]}>{p ? priceText(p.buyTry) : "—"}</Text>
              <Text style={[type.amount, { color: palette.text, minWidth: MARKET_SELL_W, textAlign: "right" }]}>
                {p ? `${priceText(p.sellTry)} ₺` : "—"}
              </Text>
              {p?.direction === "up" ? (
                <TrendingUp accessible={false} size={MARKET_TREND_W} color={palette.positive} />
              ) : p?.direction === "down" ? (
                <TrendingDown accessible={false} size={MARKET_TREND_W} color={palette.negative} />
              ) : (
                <View style={{ width: MARKET_TREND_W }} />
              )}
            </Row>
          </Spread>
        );
      })}
        </>
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
    // Ledger already retries settings, persons, categories, transactions and
    // adjustments; retry only the remaining independent sources once.
    ledgerState.retry();
    expectedState.retry();
    subscriptionsState.retry();
    incomesState.retry();
    sourcesState.retry();
    cardStatementsState.retry();
  };
  const router = useRouter();
  const undo = useUndo();
  const { palette } = useTheme();
  // Re-render when FX rates land so foreign-currency projections settle.
  useFxRates();

  // No manual useMemo here: the React Compiler (enabled app-wide) memoizes
  // these derivations automatically and bails out when useMemo is hand-rolled.
  // Reuse the ledger's already-built txLike instead of running a second
  // full-table live query (useAllTransactions) + toTxLike on the same data.
  const txLike = bundle?.txLike ?? [];
  const selfPersonId = persons.find((p) => p.isSelf)?.id;
  const creditCardIds = new Set(sources.filter((source) => source.type === "credit_card").map((source) => source.id));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const subscriptionById = new Map(subscriptions.map((subscription) => [subscription.id, subscription]));
  const incomeById = new Map(incomes.map((income) => [income.id, income]));

  const catName = (id: string | null) => (id ? categoryById.get(id)?.name : undefined);
  const nameOf = (e: (typeof expected)[number]) =>
    subscriptionById.get(e.refId)?.name ?? incomeById.get(e.refId)?.name ?? tr.common.paymentFallback;
  // Convert an expected amount to TRY minor for projections using the best
  // available rate (fresh live quote → dated local cache). Returns null when no rate is
  // known — such an item is left out of the projection rather than counted at
  // its raw foreign value (which would silently distort the figure). Foreign
  // subscriptions were previously dropped entirely; now they count when a rate
  // exists (the common USD/EUR case, once TCMB has been cached).
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
  const { pendingItems, lateItems: late, incomingMinor, outgoingMinor: remainingFixedMinor } = model;
  // Upcoming = the next ~31 days of everything you'll pay/receive on a fixed
  // schedule: subscriptions + recurring incomes (expected items) AND your own
  // future-dated one-off entries (a bill you scheduled ahead). A month-wide
  // window so each monthly obligation shows once, auto-pay or not.
  const upcoming: {
    key: string;
    kind: "expected" | "tx";
    expectedId?: string;
    direction: "in" | "out";
    name: string;
    typeLabel: string;
    amountMinor: number;
    currency: string;
    date: string;
  }[] = [
    ...pendingItems
      .filter((e) => e.status === "pending" && e.dueDate >= today && daysBetween(today, e.dueDate) <= 31)
      .map((e) => ({
        key: e.id,
        kind: "expected" as const,
        expectedId: e.id,
        direction: e.direction,
        name: nameOf(e),
        typeLabel:
          e.direction === "in"
            ? tr.dashboard.expectedIncome
            : catName(subscriptionById.get(e.refId)?.categoryId ?? null) ?? tr.subs.title,
        amountMinor: e.amountMinor,
        currency: e.currency,
        date: e.dueDate,
      })),
    ...standaloneUpcomingTransactions(txLike, creditCardIds, today)
      .map((t) => {
        const flow = projectedTransactionFlow(t);
        return {
          key: t.id,
          kind: "tx" as const,
          direction: flow.direction,
          name: catName(t.categoryId) ?? tr.dashboard.scheduledTx,
          typeLabel: tr.dashboard.scheduledTx,
          amountMinor: flow.amountTryMinor,
          currency: "TRY",
          date: t.effectiveDate,
        };
      }),
    // One consolidated statement per credit card — you pay the card once, not
    // each purchase. Only for cards that HAVE a due day; a card with no known
    // due date shows nothing (never a fabricated "in N days"). The amount is the
    // card's next unpaid statement month (its earliest pending installments).
    ...upcomingCardStatements(
      txLike,
      sources.filter((source) => source.type === "credit_card"),
      cardStatements,
      today,
    ).map((statement) => ({
          key: `card-${statement.cardId}`,
          kind: "tx" as const,
          direction: "out" as const,
          name: statement.cardName,
          typeLabel: tr.dashboard.cardStatement,
          amountMinor: statement.amountMinor,
          currency: "TRY",
          date: statement.dueDate,
        })),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 12);

  // Everything still to happen between today and month end, as ONE flow set, so
  // the month-end forecast and its breakdown reconcile exactly:
  //   forecast = current balance + incoming − outgoing.
  // Installment tx are already pending transactions, so expected items cover only
  // subs/incomes → no double count. Pending (not yet realized) items from today
  // onward are what isn't in the actual balance yet.
  const hasForecast = incomingMinor > 0 || remainingFixedMinor > 0;
  const projected = model.projectedMinor;
  const monthIncomeMinor = model.distribution.incomeTotalMinor;
  const monthOutflowMinor = model.distribution.expenseTotalMinor + model.distribution.transferTotalMinor;
  const monthNetMinor = monthIncomeMinor - monthOutflowMinor;

  // Marking an expected item paid picks the day it was actually paid. This lets
  // the user record an early/manual payment ("due the 15th, I paid it on the
  // 12th") — the amount then becomes a realized expense on that day and drops
  // out of the month-end forecast, instead of staying a projected future flow.
  // Default: the due date if it has already passed, else today.
  const [showForecast, setShowForecast] = React.useState(false);
  const [paying, setPaying] = React.useState<(typeof expected)[number] | null>(null);
  const defaultPaidDate = (dueDate: string): ISODate => (dueDate <= today ? (dueDate as ISODate) : today);
  // One confirmation at a time: the button shows a spinner while the write is
  // in flight, so a double-tap can't submit the same expected item twice.
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
        undo.show(`${nameOf(e)} ✓`, () => void revertExpected(userId, e.id));
      } catch (err) {
        errorNotice();
        // Foreign-currency item confirmed before any FX rate was cached: tell the
        // user to retry online instead of writing a corrupt TRY amount.
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
  const actualBalanceText = bundle ? formatMinor(bundle.actualBalanceMinor) : "";

  return (
    <Screen title={greeting()} subtitle={dateLabel(today)} leading={<BrandMark size={40} />}>
      <FirstRunTour />
      <DataStateNotice status={dataStatus} retry={retryData} />
      {previousLoginAt ? (
        <Body muted style={{ marginBottom: spacing.sm }}>
          {tr.dashboard.lastLogin(dateTimeLabel(previousLoginAt))}
        </Body>
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
              <ChevronRight accessible={false} size={18} color={palette.textMuted} />
            </Row>
          </Card>
        </Pressable>
      ) : null}

      {/* Hero balance + a single month-end forecast line (tap to expand the
          breakdown). One representation of the projected number, not the old
          hero-chip AND a duplicate card. While the ledger is still loading the
          card keeps its place with quiet placeholder bars — a transient "₺0"
          balance or a popping-in hero both read as glitches in a finance app. */}
      {bundle ? (
        <HeroCard>
          <Text style={[type.label, { color: palette.onPrimary, textTransform: "uppercase", letterSpacing: 1, fontSize: 11 }]}>
            {tr.dashboard.actualBalance}
          </Text>
          <Text
            style={[
              type.amountLg,
              {
                color: palette.onPrimary,
                fontSize: actualBalanceText.length > 20
                  ? 20
                  : actualBalanceText.length > 16
                    ? 26
                    : 38,
                marginTop: spacing.xs,
                flexShrink: 1,
              },
            ]}
          >
            {actualBalanceText}
          </Text>
          {hasForecast && projected != null ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowForecast((v) => !v)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                marginTop: spacing.md,
                backgroundColor: "rgba(255,255,255,0.14)",
                alignSelf: "flex-start",
                borderRadius: radius.full,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs + 2,
              }}
            >
              {projectedDelta != null && projectedDelta >= 0 ? (
                <TrendingUp size={14} color={palette.onPrimary} />
              ) : (
                <TrendingDown size={14} color={palette.onPrimary} />
              )}
              <Text style={[type.amountSm, { color: palette.onPrimary }]}>
                {tr.dashboard.forecastToggle} · {formatMinor(projected)}
              </Text>
              {showForecast ? <ChevronUp size={15} color={palette.onPrimary} /> : <ChevronDown size={15} color={palette.onPrimary} />}
            </Pressable>
          ) : null}
        </HeroCard>
      ) : (
        <HeroCard>
          {/* Same label/amount line heights as the loaded state. */}
          <View style={{ width: 120, height: 13, borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.30)" }} />
          <View style={{ width: 208, height: 38, borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.22)", marginTop: spacing.xs }} />
        </HeroCard>
      )}

      {/* Breakdown, revealed on demand: current balance + what's still coming in
          − what's still going out = the month-end estimate. */}
      {bundle && showForecast && hasForecast && projected != null ? (
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
              iconColor={palette.negative}
              title={nameOf(e)}
              subtitle={`${dateLabel(e.dueDate)} · ${formatMinor(e.amountMinor, e.currency)}`}
              stackRightOnNarrow
              right={
                // The "Geciken" status and the confirm button are rendered as
                // one symmetric pair — identical width and height, centred.
                <Row gap={spacing.sm}>
                  <StatusPill label={tr.dashboard.late} color={palette.negative} foreground={palette.negativeText} />
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
                </Row>
              }
            />
          ))}
          {upcoming.map((u) => (
            <ListRow
              key={u.key}
              icon={u.direction === "in" ? ArrowDownLeft : CalendarClock}
              iconColor={u.direction === "in" ? palette.positive : undefined}
              title={u.name}
              subtitle={`${u.typeLabel} · ${tr.dashboard.inDays(daysBetween(today, u.date))} · ${formatMinor(u.amountMinor, u.currency)}`}
              stackRightOnNarrow
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
          onPress={() => router.push("/cash-flow/analytics")}
        />
      </Card>
    </Screen>
  );
}
