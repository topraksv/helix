/**
 * Balance engine. Reproduces the Excel chained-balance model (verified
 * against Ocak–Temmuz 2026 screenshots):
 *
 *   closing(m)   = opening(m) + Σ income − Σ expense − Σ transfer ± adjustments(m)
 *   opening(m+1) = closing(m);   opening(startMonth) = openingBalance
 *
 * Only rows with status='realized', effective_date <= today and an is_self
 * person count toward the balance (spec §2.7, §2.8). Balances may go
 * negative (Temmuz 2026: −18.773,03).
 */

import { groupBy } from "./card-statements";
import { addMonthsToKey, lastDayOf, makeMonthKey, monthKeyOf, monthRange, yearOf, type ISODate, type MonthKey } from "./dates";
import type { PlannedExpectation } from "./expected";
import type { Minor } from "./money";
import type { AdjustmentLike, SettlementFlow, TxLike } from "./types";
import { financialFlow, signedBalanceEffect } from "./transactions";

export function countsTowardBalance(tx: TxLike, today: ISODate): boolean {
  return tx.status === "realized" && tx.effectiveDate <= today && tx.personIsSelf;
}

/** Replacement value for today's deterministic reconciliation row. The
 * displayed balance already includes the existing row, so remove that effect
 * before measuring the new delta. */
export function reconciliationDelta(
  targetMinor: Minor,
  computedNowMinor: Minor,
  existingAdjustmentMinor: Minor = 0,
): Minor {
  return targetMinor - (computedNowMinor - existingAdjustmentMinor);
}

export interface MonthLedger {
  month: MonthKey;
  openingMinor: Minor;
  incomeMinor: Minor;
  expenseMinor: Minor;
  transferMinor: Minor;
  adjustmentMinor: Minor;
  closingMinor: Minor;
  /** Displayed sums per category (TRY minor), including pending when enabled. */
  byCategory: Map<string, Minor>;
  /** Rows with no category, kept visible without inventing a category id. */
  uncategorizedMinor: Minor;
  /**
   * The planned (not yet realized) half of this month, split by flow type.
   *
   * These come from EXACTLY the rows that also entered `byCategory`, which is
   * what makes a month-focused card able to show a total and a breakdown that
   * agree: the realized-only chain above is right for the balance but reads 0
   * for every future month, while the category cells beside it already showed
   * the planned amounts.
   */
  plannedIncomeMinor: Minor;
  plannedExpenseMinor: Minor;
  plannedTransferMinor: Minor;
  /**
   * What each stored balance declaration dated in this month moved the
   * balance by, recomputed from the rows as they stand. Already inside
   * `adjustmentMinor`; listed so the screen that keeps declarations can say
   * what each one is correcting.
   */
  declarationDeltas: { id: string; deltaMinor: Minor }[];
  /**
   * Recorded statement payments, as the balance sees them (spec §3.1f). The
   * charges stay in the category cells; these say when their money actually
   * left. `cardSettlementMinor` is the realized part inside `closingMinor`,
   * `plannedCardSettlementMinor` the rest of it inside the projected close.
   * `cardOwedMinor` (still unpaid, given back on the due date) and
   * `cardPaymentsMinor` (payments, and payments given back where they were made
   * on another day) split the same total for the month's breakdown.
   */
  cardSettlementMinor: Minor;
  plannedCardSettlementMinor: Minor;
  cardOwedMinor: Minor;
  cardPaymentsMinor: Minor;
  /** The same chain as `openingMinor`/`closingMinor`, carrying the planned
   *  flows too. Identical to them for a month with nothing planned. */
  projectedOpeningMinor: Minor;
  projectedClosingMinor: Minor;
}

/**
 * What a month-focused surface (the Mali Tablo month cards, the month detail
 * summary) must show: one total and the breakdown it is actually made of.
 *
 * Both live here so the two can never be sourced differently again —
 * `closingMinor` minus a realized-only breakdown is the divergence this
 * replaces, not a second opinion about it. The balance chain itself
 * (`openingMinor`/`closingMinor`, the Mali Tablo balance columns, the current
 * balance) stays realized-only and is untouched.
 */
export function monthFlowTotals(month: MonthLedger): {
  openingMinor: Minor;
  incomeMinor: Minor;
  expenseMinor: Minor;
  transferMinor: Minor;
  adjustmentMinor: Minor;
  cardOwedMinor: Minor;
  cardPaymentsMinor: Minor;
  closingMinor: Minor;
} {
  return {
    openingMinor: month.projectedOpeningMinor,
    incomeMinor: month.incomeMinor + month.plannedIncomeMinor,
    expenseMinor: month.expenseMinor + month.plannedExpenseMinor,
    transferMinor: month.transferMinor + month.plannedTransferMinor,
    adjustmentMinor: month.adjustmentMinor,
    cardOwedMinor: month.cardOwedMinor,
    cardPaymentsMinor: month.cardPaymentsMinor,
    closingMinor: month.projectedClosingMinor,
  };
}

/**
 * The month figures a computed column reads.
 *
 * `byCategory` already carries the planned rows, so pairing it with the
 * realized-only income/expense made a formula like "Net Akış" read 0 for a
 * future month while the category cell next to it in the SAME row showed the
 * planned amount. One accessor, one dataset, every call site.
 */
export function monthColumnBasis(month: MonthLedger): {
  byCategory: Map<string, Minor>;
  incomeMinor: Minor;
  expenseMinor: Minor;
} {
  const flows = monthFlowTotals(month);
  return { byCategory: month.byCategory, incomeMinor: flows.incomeMinor, expenseMinor: flows.expenseMinor };
}

interface LedgerInput {
  openingBalanceMinor: Minor;
  startMonth: MonthKey;
  endMonth: MonthKey;
  transactions: TxLike[];
  adjustments: AdjustmentLike[];
  today: ISODate;
  /** Also show future/pending self rows inside category cells (display only —
   *  balances, income/expense sums and the chain stay realized-only). */
  includePendingInCells?: boolean;
  /** What recorded statement payments move, from `settleCardStatements`. */
  settlements?: SettlementFlow[];
  /** Drawn beside the pending rows, under the same switch. */
  plannedExpectations?: readonly PlannedExpectation[];
}

/**
 * The earliest month carrying anything, never later than `seed`.
 *
 * One scan serving two questions that used to own a copy each: where an
 * anchored ledger has to reach back to, and where an unanchored one begins.
 */
function earliestRecordedMonth(
  seed: MonthKey,
  transactions: TxLike[],
  adjustments: AdjustmentLike[],
): MonthKey {
  let earliest = seed;
  for (const tx of transactions) {
    const month = monthKeyOf(tx.effectiveDate);
    if (month < earliest) earliest = month;
  }
  for (const adjustment of adjustments) {
    const month = monthKeyOf(adjustment.date);
    if (month < earliest) earliest = month;
  }
  return earliest;
}

/**
 * The earliest month carrying a record, or null when nothing does.
 *
 * `earliestRecordedMonth` answers a different question — it is bounded by a
 * seed it may never exceed — and that bound is exactly what a caller asking
 * "where does the data start" must not inherit.
 */
function firstRecordedMonth(
  transactions: TxLike[],
  adjustments: AdjustmentLike[],
): MonthKey | null {
  // Sorted rather than compared in a running-minimum loop. A month key is a
  // sortable string, so the loop's `month < earliest` had a twin — `<=` — that
  // assigns an equal value and produces the same answer for every input there
  // is. A test cannot tell those apart, which makes the comparison a thing the
  // suite is permanently unable to guard.
  return [
    ...transactions.map((tx) => monthKeyOf(tx.effectiveDate)),
    ...adjustments.map((adjustment) => monthKeyOf(adjustment.date)),
  ].sort()[0] ?? null;
}

/**
 * The configured anchor read as what it is: a statement that the balance at
 * the end of the day before its month opens was this figure.
 */
function anchorDeclaration(configuredStart: MonthKey, configuredOpeningMinor: Minor): AdjustmentLike {
  return { date: lastDayOf(addMonthsToKey(configuredStart, -1)), amountMinor: 0, declaredMinor: configuredOpeningMinor };
}

/**
 * The earliest statement of what the balance was on a day: the configured
 * anchor or a stored declaration dated today or earlier.
 *
 * On one day the anchor, which has no id, comes first, so the declaration the
 * owner wrote down separately is the one the chain then holds.
 */
function earliestStatement(
  configuredStart: MonthKey | null,
  configuredOpeningMinor: Minor,
  adjustments: AdjustmentLike[],
  today: ISODate,
): AdjustmentLike | undefined {
  let earliest = configuredStart == null ? undefined : anchorDeclaration(configuredStart, configuredOpeningMinor);
  for (const adjustment of adjustments) {
    if (adjustment.declaredMinor == null || adjustment.date > today) continue;
    if (!earliest || precedes(adjustment, earliest)) earliest = adjustment;
  }
  return earliest;
}

function precedes(a: AdjustmentLike, b: AdjustmentLike): boolean {
  return a.date < b.date || (a.date === b.date && (a.id ?? "").localeCompare(b.id ?? "") < 0);
}

/**
 * The balance the chain must open with so that `statement` holds: its figure
 * less everything counted on or before its day. Nothing is dated before the
 * chain's first month, so a statement dated before that month opens it as is.
 */
function openingFor(statement: AdjustmentLike, transactions: TxLike[], adjustments: AdjustmentLike[], today: ISODate): Minor {
  let before = 0;
  for (const tx of transactions) {
    if (tx.effectiveDate <= statement.date && countsTowardBalance(tx, today)) before += signedBalanceEffect(tx);
  }
  for (const adjustment of adjustments) {
    if (adjustment.declaredMinor == null && adjustment.date <= statement.date && adjustment.date <= today) {
      before += adjustment.amountMinor;
    }
  }
  return statement.declaredMinor! - before;
}

/**
 * Resolve the effective ledger anchor so history entered before the
 * configured opening month still appears. Extends the start back to the
 * earliest recorded data and back-computes the opening balance there, so the
 * balance AT the configured start (and the current balance) is unchanged.
 *
 * The back-computation starts from the EARLIEST statement of a balance, which
 * is the anchor unless a declaration is dated before it; the chain then holds
 * every later statement, the anchor included, as it reaches it.
 */
export function resolveLedgerAnchor(
  configuredStart: MonthKey,
  configuredOpeningMinor: Minor,
  transactions: TxLike[],
  adjustments: AdjustmentLike[],
  today: ISODate,
): { startMonth: MonthKey; openingBalanceMinor: Minor } {
  const startMonth = earliestRecordedMonth(configuredStart, transactions, adjustments);
  const first = earliestStatement(configuredStart, configuredOpeningMinor, adjustments, today);
  return { startMonth, openingBalanceMinor: openingFor(first!, transactions, adjustments, today) };
}

/** Build the chained month-by-month ledger over [startMonth, endMonth]. */
export function buildLedger(input: LedgerInput): MonthLedger[] {
  const { openingBalanceMinor, startMonth, endMonth, transactions, adjustments, today, includePendingInCells } = input;
  const months = monthRange(startMonth, endMonth);
  const byMonth = new Map<MonthKey, TxLike[]>();
  const pendingByMonth = new Map<MonthKey, TxLike[]>();
  for (const tx of transactions) {
    if (countsTowardBalance(tx, today)) {
      const key = monthKeyOf(tx.effectiveDate);
      const bucket = byMonth.get(key);
      if (bucket) bucket.push(tx);
      else byMonth.set(key, [tx]);
    } else if (includePendingInCells && tx.personIsSelf) {
      // An own row the balance does not count yet is planned: pending, or marked
      // realized but dated after today by a device whose day had already turned.
      // Left out of both, that second kind vanished from its own cell on the
      // device still behind.
      const key = monthKeyOf(tx.effectiveDate);
      const bucket = pendingByMonth.get(key);
      if (bucket) bucket.push(tx);
      else pendingByMonth.set(key, [tx]);
    }
  }
  const staticByMonth = new Map<MonthKey, AdjustmentLike[]>();
  const declarationsByMonth = new Map<MonthKey, AdjustmentLike[]>();
  for (const adj of adjustments) {
    if (adj.date > today) continue;
    const target = adj.declaredMinor == null ? staticByMonth : declarationsByMonth;
    const key = monthKeyOf(adj.date);
    const bucket = target.get(key);
    if (bucket) bucket.push(adj);
    else target.set(key, [adj]);
  }

  const expectedByMonth = groupBy(
    includePendingInCells ? input.plannedExpectations ?? [] : [],
    (item) => monthKeyOf(item.dueDate),
  );

  const settlementsByMonth = new Map<MonthKey, SettlementFlow[]>();
  for (const flow of input.settlements ?? []) {
    const key = monthKeyOf(flow.date);
    const bucket = settlementsByMonth.get(key);
    if (bucket) bucket.push(flow);
    else settlementsByMonth.set(key, [flow]);
  }

  const ledger: MonthLedger[] = [];
  let opening = openingBalanceMinor;
  let projectedOpening = openingBalanceMinor;
  for (const month of months) {
    const settled = settlementsByMonth.get(month) ?? [];
    const counted = byMonth.get(month) ?? [];
    let cardSettlement = 0;
    let plannedCardSettlement = 0;
    let cardOwed = 0;
    for (const flow of settled) {
      if (flow.planned) plannedCardSettlement += flow.amountMinor;
      else cardSettlement += flow.amountMinor;
      if (flow.kind === "owed") cardOwed += flow.amountMinor;
    }
    let income = 0;
    let expense = 0;
    let transfer = 0;
    let plannedIncome = 0;
    let plannedExpense = 0;
    let plannedTransfer = 0;
    let uncategorized = 0;
    const byCategory = new Map<string, Minor>();
    for (const tx of counted) {
      const flow = financialFlow(tx);
      if (flow.type === "income") income += flow.amountTryMinor;
      else if (flow.type === "expense") expense += flow.amountTryMinor;
      else transfer += flow.amountTryMinor;
      if (tx.categoryId) {
        byCategory.set(tx.categoryId, (byCategory.get(tx.categoryId) ?? 0) + flow.amountTryMinor);
      } else uncategorized += flow.amountTryMinor;
    }
    // One pass, one classification: whatever lands in a category cell is also
    // counted in the planned totals, so a cell can never show an amount that
    // the month's own breakdown denies.
    for (const tx of pendingByMonth.get(month) ?? []) {
      const flow = financialFlow(tx);
      if (flow.type === "income") plannedIncome += flow.amountTryMinor;
      else if (flow.type === "expense") plannedExpense += flow.amountTryMinor;
      else plannedTransfer += flow.amountTryMinor;
      if (tx.categoryId) {
        byCategory.set(tx.categoryId, (byCategory.get(tx.categoryId) ?? 0) + flow.amountTryMinor);
      } else uncategorized += flow.amountTryMinor;
    }
    // An expectation is planned the way a pending row is, and in its rule's
    // category, so the month close carries what "Ay sonu tahmini" counts and
    // the row still adds up on its own face.
    for (const item of expectedByMonth.get(month) ?? []) {
      if (item.direction === "in") plannedIncome += item.amountTryMinor;
      else plannedExpense += item.amountTryMinor;
      if (item.categoryId) {
        byCategory.set(item.categoryId, (byCategory.get(item.categoryId) ?? 0) + item.amountTryMinor);
      } else uncategorized += item.amountTryMinor;
    }
    const statics = staticByMonth.get(month) ?? [];
    let adjustment = statics.reduce((sum, adj) => sum + adj.amountMinor, 0);
    const declarationDeltas: { id: string; deltaMinor: Minor }[] = [];
    // A declaration holds the balance at the end of its day to its figure, so
    // what it adds is recomputed from the rows as they stand: a row entered
    // later on or before its day is absorbed, one after it is not. Applied to
    // the planned chain unchanged, because a declaration is about the balance,
    // and an unconfirmed row before it is still something the owner may confirm.
    // An anchor has no id, so it holds first on its day.
    const declarations = [...(declarationsByMonth.get(month) ?? [])]
      .sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? "").localeCompare(b.id ?? ""));
    let declared = 0;
    for (const declaration of declarations) {
      let running = opening + declared;
      for (const tx of counted) if (tx.effectiveDate <= declaration.date) running += signedBalanceEffect(tx);
      for (const adj of statics) if (adj.date <= declaration.date) running += adj.amountMinor;
      for (const flow of settled) if (!flow.planned && flow.date <= declaration.date) running += flow.amountMinor;
      const delta = declaration.declaredMinor! - running;
      declared += delta;
      if (declaration.id != null) declarationDeltas.push({ id: declaration.id, deltaMinor: delta });
    }
    adjustment += declared;
    const closing = opening + income - expense - transfer + adjustment + cardSettlement;
    const projectedClosing =
      projectedOpening +
      (income + plannedIncome) -
      (expense + plannedExpense) -
      (transfer + plannedTransfer) +
      adjustment +
      cardSettlement +
      plannedCardSettlement;
    ledger.push({
      month,
      openingMinor: opening,
      incomeMinor: income,
      expenseMinor: expense,
      transferMinor: transfer,
      adjustmentMinor: adjustment,
      closingMinor: closing,
      byCategory,
      uncategorizedMinor: uncategorized,
      plannedIncomeMinor: plannedIncome,
      plannedExpenseMinor: plannedExpense,
      plannedTransferMinor: plannedTransfer,
      declarationDeltas,
      cardSettlementMinor: cardSettlement,
      plannedCardSettlementMinor: plannedCardSettlement,
      cardOwedMinor: cardOwed,
      cardPaymentsMinor: cardSettlement + plannedCardSettlement - cardOwed,
      projectedOpeningMinor: projectedOpening,
      projectedClosingMinor: projectedClosing,
    });
    opening = closing;
    projectedOpening = projectedClosing;
  }
  return ledger;
}

export interface LedgerBundle {
  ledger: MonthLedger[];
  yearMonths: MonthLedger[];
  startMonth: MonthKey;
  /**
   * The earliest month that actually HOLDS something, or null when nothing does.
   *
   * Distinct from `startMonth`, which is where the balance chain has to begin.
   * An anchor can sit years before the first record — an import writes one, a
   * setup screen writes one — and the chain then carries the opening figure
   * across every empty month in between. That is right for the arithmetic and
   * wrong for navigation: the Mali Tablo offered six years of blank rows with
   * a balance column filled in, which reads as data that went missing rather
   * than as months that never had any.
   */
  firstRecordedMonth: MonthKey | null;
  actualBalanceMinor: Minor;
  txLike: TxLike[];
  /** See `LedgerChain.plannedExpectations`. */
  plannedExpectations: readonly PlannedExpectation[];
  /** See `LedgerChain.declarationDeltaById`. */
  declarationDeltaById: ReadonlyMap<string, Minor>;
}

/**
 * The chain itself, which does not depend on which year is being looked at.
 *
 * Splitting this out is the difference between a year switch costing a full
 * rebuild and costing an array filter. `buildLedger` walks every transaction
 * the account has and chains every month from the anchor forward; for any year
 * at or before the current one the result is byte-identical whichever year the
 * screen is showing, because only the SLICE differs. Measured at 6x CPU
 * throttle on a five-year, 3.000-row workspace, moving between years blocked
 * the main thread for 208ms doing arithmetic it had already done.
 *
 * `endYear` is the one thing a requested year can change: looking at 2028 has
 * to extend the chain that far. It is therefore part of the cache key rather
 * than the year itself, so browsing backwards through history never rebuilds.
 */
export function ledgerChainEndYear(year: number, today: ISODate): number {
  return Math.max(year, yearOf(today));
}

export interface LedgerChain {
  ledger: MonthLedger[];
  startMonth: MonthKey;
  /** See `LedgerBundle.firstRecordedMonth`. */
  firstRecordedMonth: MonthKey | null;
  actualBalanceMinor: Minor;
  txLike: TxLike[];
  /** What the chain drew as planned beside the pending rows, for the forecast and the lists. */
  plannedExpectations: readonly PlannedExpectation[];
  /** What each stored balance declaration adds, by row id, as the rows stand now. */
  declarationDeltaById: ReadonlyMap<string, Minor>;
}

/**
 * The whole chain, anchored or not.
 *
 * An unset `start_month` is NOT a missing ledger, and modelling it as one is
 * the defect this signature used to carry: it returned `null`, and each of the
 * seven screens reading it invented its own meaning for that. The dashboard
 * held a loading skeleton that never resolved, Mali Tablo announced the month
 * was empty, and the opening-balance editor — the one screen that can SET the
 * anchor — refused to open because there was no anchor to read, which is a
 * deadlock a person cannot leave without reinstalling.
 *
 * It is reached by clearing the whole ledger, which the reset does on purpose,
 * so "no anchor" is an ordinary state rather than a corrupt one. Worse, every
 * row entered AFTERWARDS was invisible too: the chain refused before it ever
 * looked at the transactions.
 *
 * Unanchored therefore means what a person would assume it means — the table
 * opens at zero, in the earliest month that carries anything, or in this month
 * when nothing does. `null` no longer travels from here, so a screen holding
 * one is holding exactly one fact: the queries have not answered yet.
 */
export function buildLedgerChain(input: {
  configuredStart: MonthKey | null;
  openingBalanceMinor: Minor;
  includePendingInCells: boolean;
  transactions: TxLike[];
  adjustments: AdjustmentLike[];
  /** What recorded statement payments move, from `settleCardStatements`. */
  settlements?: SettlementFlow[];
  /** From `plannedExpectations`; drawn only when pending rows are. */
  plannedExpectations?: readonly PlannedExpectation[];
  endYear: number;
  today: ISODate;
}): LedgerChain {
  const { configuredStart, transactions, adjustments, endYear, today } = input;
  const settlements = input.settlements ?? [];
  // A payment already made moves the balance like any movement does, so it
  // also decides where the chain has to reach back to and what it opens with.
  const movements = [
    ...adjustments,
    ...settlements.filter((flow) => !flow.planned).map((flow) => ({ date: flow.date, amountMinor: flow.amountMinor })),
  ];

  const startMonth = earliestRecordedMonth(configuredStart ?? monthKeyOf(today), transactions, movements);
  // Unanchored and undeclared, the table opens at zero; otherwise at whatever
  // makes the earliest statement of a balance hold.
  const first = earliestStatement(configuredStart, input.openingBalanceMinor, adjustments, today);
  const openingBalanceMinor = first ? openingFor(first, transactions, movements, today) : 0;
  const ledger = buildLedger({
    openingBalanceMinor,
    startMonth,
    endMonth: makeMonthKey(endYear, 12),
    transactions,
    // The anchor rides along as a declaration so a declaration dated before it
    // cannot move the balance the owner set for its month. When it is the
    // earliest statement the opening above already satisfies it and it adds 0.
    adjustments: configuredStart == null
      ? adjustments
      : [...adjustments, anchorDeclaration(configuredStart, input.openingBalanceMinor)],
    today,
    includePendingInCells: input.includePendingInCells,
    settlements,
    plannedExpectations: input.plannedExpectations,
  });
  // The current month's close is the actual balance. A chain that starts after
  // this month holds nothing dated on or before today — an earlier row or
  // adjustment would have pulled the start back to it — so today's balance is
  // the figure it opens with.
  const currentLedgerMonth = ledger.find((entry) => entry.month === monthKeyOf(today));
  const actualBalanceMinor = currentLedgerMonth?.closingMinor ?? openingBalanceMinor;
  return {
    ledger,
    startMonth,
    firstRecordedMonth: firstRecordedMonth(transactions, adjustments),
    actualBalanceMinor,
    txLike: transactions,
    plannedExpectations: input.plannedExpectations ?? [],
    declarationDeltaById: new Map(ledger.flatMap((month) => month.declarationDeltas.map((entry) => [entry.id, entry.deltaMinor] as const))),
  };
}

/** One year's view of a chain that has already been built. */
export function sliceLedgerYear(chain: LedgerChain, year: number): LedgerBundle {
  return {
    ledger: chain.ledger,
    yearMonths: chain.ledger.filter((month) => yearOf(month.month) === year),
    startMonth: chain.startMonth,
    firstRecordedMonth: chain.firstRecordedMonth,
    actualBalanceMinor: chain.actualBalanceMinor,
    txLike: chain.txLike,
    plannedExpectations: chain.plannedExpectations,
    declarationDeltaById: chain.declarationDeltaById,
  };
}

export interface UpcomingFlow {
  direction: "in" | "out";
  amountTryMinor: Minor;
  date: ISODate;
}

/**
 * Projected balance at `horizon` (spec §2.7 dashboard): actual balance plus
 * every known future flow (pending transactions and unpaid expected
 * payments) due on or before the horizon. It sums what it is given and does
 * not look for identity between flows: two entries for one obligation are
 * collapsed by `buildDashboardModel` before they get here, because only the
 * dashboard holds the rule references that establish the match.
 */
export function projectedBalance(actualMinor: Minor, flows: UpcomingFlow[], horizon: ISODate): Minor {
  let projected = actualMinor;
  for (const flow of flows) {
    if (flow.date > horizon) continue;
    projected += flow.direction === "in" ? flow.amountTryMinor : -flow.amountTryMinor;
  }
  return projected;
}
