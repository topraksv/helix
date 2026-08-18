/** Catch-up / reconciliation screen ("nerede kaldım"): everything that came
 *  due since the last entry, confirm/skip/correct with bank statement in hand. */

import React, { useState } from "react";
import { View } from "react-native";
import { Stack, useRouter } from "expo-router";
import CheckCircle2 from "lucide-react-native/icons/circle-check";
import Plus from "lucide-react-native/icons/plus";
import { confirmExpected, ExpectedAlreadyMatchedError, FxRateUnavailableError, matchExpectedToTransaction, revertExpected, skipExpected, unskipExpected } from "../data/repo";
import {
  useAllTransactionsState,
  useLastEntryInfoState,
  usePendingExpectedState,
  usePersonsState,
  useRecurringIncomesState,
  useSubscriptionsState,
  useUserId,
} from "../data/hooks";
import { combineLiveStates } from "../data/live-state";
import { todayISO } from "../domain/dates";
import { findDuplicates, matchCandidates, provenanceOf, type MatchCandidate } from "../domain/provenance";
import { formatMinorCompact } from "../domain/money";
import { AMOUNT_LABELS, needsVariableAmountEntry, isVariableSubscriptionOccurrence, occurrenceAmountText } from "../domain/subscriptions";
import { dateLabel, tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { devError } from "../services/logger";
import { Badge, Body, Button, Card, DataStateNotice, EmptyState, MoneyField, Row, Screen, SectionHeader, Spread } from "../ui/components";
import { appAlert } from "../ui/dialog";
import { useUndo } from "../ui/undo";
import { errorNotice } from "../ui/haptics";
import { spacing } from "../ui/theme";
import { useOperationGuard } from "../ui/operation-guard";
import { useDirtyExitGuard } from "../ui/dirty-exit";
import { WorkspaceGrid } from "../ui/workspace-layout";
import { useClusterWidth } from "../ui/viewport";


/**
 * Rows that may be the same money written twice.
 *
 * It finds and explains; it never resolves. Two identical grocery shops three
 * days apart is a real pattern, and a product that quietly merged them would
 * delete money that was actually spent — so every pair opens the transaction
 * and lets the owner decide, and the reason for the suspicion is stated so they
 * can disagree with something specific.
 */
function DuplicateReview({
  transactions,
  onOpen,
}: {
  transactions: ReturnType<typeof useAllTransactionsState>["data"];
  onOpen: (id: string) => void;
}) {
  const pairs = React.useMemo(
    () => findDuplicates(transactions.map((transaction) => ({
      id: transaction.id,
      amountTryMinor: transaction.amountTryMinor,
      effectiveDate: transaction.effectiveDate,
      categoryId: transaction.categoryId,
      origin: transaction.origin,
      importKey: transaction.importKey,
    }))).slice(0, 12),
    [transactions],
  );
  const byId = React.useMemo(() => new Map(transactions.map((row) => [row.id, row])), [transactions]);

  return (
    <View style={{ marginTop: spacing.lg }}>
      <SectionHeader>{tr.duplicates.title}</SectionHeader>
      <Body muted style={{ marginBottom: spacing.sm }}>{tr.duplicates.hint}</Body>
      {pairs.length === 0 ? (
        <Body muted testID="duplicate-review-empty">{tr.duplicates.none}</Body>
      ) : (
        pairs.map((pair) => {
          const duplicate = byId.get(pair.duplicateId);
          if (!duplicate) return null;
          return (
            <Card key={`${pair.existingId}:${pair.duplicateId}`} tone={pair.certain ? "warning" : undefined}>
              <Row gap={spacing.sm} style={{ flexWrap: "wrap" }}>
                <Badge text={pair.certain ? tr.duplicates.certain : tr.duplicates.suspected} tone={pair.certain ? "warning" : "muted"} />
              </Row>
              <Body style={{ marginTop: spacing.xs }}>
                {formatMinorCompact(duplicate.amountTryMinor)} · {dateLabel(duplicate.effectiveDate)}
              </Body>
              <Body muted style={{ marginTop: 2 }}>
                {pair.dayGap === 0 ? tr.duplicates.sameDay : tr.duplicates.dayGap(pair.dayGap)}
                {" · "}
                {tr.provenance[provenanceOf(duplicate)]}
              </Body>
              <Row gap={spacing.sm} style={{ marginTop: spacing.sm }}>
                <View>
                  <Button size="sm" variant="secondary" label={tr.duplicates.open} onPress={() => onOpen(pair.duplicateId)} />
                </View>
              </Row>
            </Card>
          );
        })
      )}
    </View>
  );
}

export default function CatchUpScreen() {
  const userId = useUserId();
  const expectedState = usePendingExpectedState();
  const subscriptionsState = useSubscriptionsState();
  const incomesState = useRecurringIncomesState();
  const personsState = usePersonsState();
  const transactionsState = useAllTransactionsState();
  const lastEntryState = useLastEntryInfoState();
  const expected = expectedState.data;
  const subscriptions = subscriptionsState.data;
  const incomes = incomesState.data;
  const persons = personsState.data;
  const lastEntry = lastEntryState.data;
  const router = useRouter();
  const undo = useUndo();
  const today = todayISO();
  const [editing, setEditing] = useState<string | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const actionClusterWidth = useClusterWidth(3);
  const { confirmDiscard } = useDirtyExitGuard(editing != null && amountRaw.trim() !== "");
  // One confirmation at a time (spinner on the active button) — a double-tap
  // must not submit the same expected item twice.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const operationGuard = useOperationGuard();
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([expectedState, subscriptionsState, incomesState, personsState, lastEntryState]);

  const selfPersonId = persons.find((p) => p.isSelf)?.id;
  const subscriptionById = new Map(subscriptions.map((subscription) => [subscription.id, subscription]));
  const incomeById = new Map(incomes.map((income) => [income.id, income]));
  const isVariableSubscription = (e: (typeof expected)[number]) => isVariableSubscriptionOccurrence(e, subscriptionById);
  const needsAmountEntry = (e: (typeof expected)[number]) => needsVariableAmountEntry(e, subscriptionById);
  const amountFragment = (e: (typeof expected)[number]) =>
    occurrenceAmountText(e, formatMinorCompact, AMOUNT_LABELS);
  const items = expected
    .filter((e) => (e.status === "pending" || e.status === "late") && e.dueDate <= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const nameOf = (e: (typeof expected)[number]) =>
    subscriptionById.get(e.refId)?.name ?? incomeById.get(e.refId)?.name ?? tr.common.paymentFallback;

  /** Undo for a confirmation, with the same "never look successful" rule. */
  const revertConfirmed = async (expectedId: string) => {
    try {
      await revertExpected(userId, expectedId);
      scheduleSync(userId);
    } catch (err) {
      devError("reconcile.revert", err);
      void appAlert(tr.errors.saveFailed);
    }
  };

  const confirm = async (e: (typeof expected)[number], actual?: number) => {
    if (!selfPersonId) return;
    await operationGuard.run(async () => {
      setConfirmingId(e.id);
      try {
        const sub = subscriptionById.get(e.refId);
        const income = incomeById.get(e.refId);
        await confirmExpected(userId, e.id, {
          personId: sub?.personId ?? income?.personId ?? selfPersonId,
          categoryId: sub?.categoryId ?? income?.categoryId ?? null,
          actualAmountMinor: actual,
        });
        scheduleSync(userId);
        setEditing(null);
        setAmountRaw("");
        setAmountMinor(null);
        undo.show(`${nameOf(e)} ✓`, () => revertConfirmed(e.id));
      } catch (err) {
        errorNotice();
        if (err instanceof FxRateUnavailableError) void appAlert(tr.errors.fxUnavailable);
        else {
          devError("reconcile.confirm", err);
          void appAlert(tr.errors.saveFailed);
        }
      } finally {
        setConfirmingId(null);
      }
    });
  };

  /**
   * Skipping is a real write, so it gets the same ownership as confirming:
   * serialized by the shared operation guard, a busy state on the row, an
   * error surfaced instead of an unhandled rejection, sync scheduled only
   * AFTER the write resolves, and an undo — a skip is otherwise silent and
   * irreversible from the UI. It used to be
   * an unowned fire-and-forget call with sync scheduled alongside it.
   */
  const skip = async (e: (typeof expected)[number]) => {
    await operationGuard.run(async () => {
      setConfirmingId(e.id);
      try {
        await skipExpected(userId, e.id);
        scheduleSync(userId);
        undo.show(tr.catchup.skipped(nameOf(e)), () => restoreSkipped(e.id), "warning");
      } catch (err) {
        errorNotice();
        devError("reconcile.skip", err);
        void appAlert(tr.errors.saveFailed);
      } finally {
        setConfirmingId(null);
      }
    });
  };

  /** Undo for a skip must itself report failure rather than look successful. */
  const restoreSkipped = async (expectedId: string) => {
    try {
      await unskipExpected(userId, expectedId);
      scheduleSync(userId);
    } catch (err) {
      devError("reconcile.unskip", err);
      void appAlert(tr.errors.saveFailed);
    }
  };

  /** Which expectation the owner is looking for an existing payment for. */
  const [matchingId, setMatchingId] = useState<string | null>(null);
  /**
   * Every transaction an expectation has already claimed, so one payment can
   * never be offered as the answer to two different months.
   */
  const linkedTransactionIds = React.useMemo(
    () => new Set(expectedState.data.flatMap((item) => item.transactionId ? [item.transactionId] : [])),
    [expectedState.data],
  );
  const candidatesFor = React.useCallback((expected: { id: string; dueDate: string; amountMinor: number; currency: string; direction: "in" | "out" }): MatchCandidate[] =>
    matchCandidates(
      expected,
      transactionsState.data.map((transaction) => ({
        id: transaction.id,
        amountTryMinor: transaction.amountTryMinor,
        effectiveDate: transaction.effectiveDate,
        categoryId: transaction.categoryId,
        origin: transaction.origin,
        importKey: transaction.importKey,
      })),
      { alreadyLinkedIds: linkedTransactionIds },
    ).slice(0, 4),
  [transactionsState.data, linkedTransactionIds]);

  const applyMatch = async (expectedId: string, transactionId: string) => {
    setMatchingId(null);
    try {
      await matchExpectedToTransaction(userId, expectedId, transactionId);
      scheduleSync(userId);
      undo.show(tr.matching.matched, () => revertExpected(userId, expectedId));
    } catch (error) {
      if (error instanceof ExpectedAlreadyMatchedError) {
        void appAlert(tr.matching.alreadyMatched, tr.errors.title);
        return;
      }
      devError("expected.match", error);
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
  };

  if (!dataReady) {
    return (
      <Screen>
        <Stack.Screen options={{ title: tr.catchup.title }} />
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  return (
    <Screen width="workspace">
      <Stack.Screen options={{ title: tr.catchup.title }} />
      <DataStateNotice status={dataStatus} retry={retryData} />
      {lastEntry.at ? <Body muted style={{ marginBottom: spacing.md }}>{tr.catchup.subtitle(dateLabel(lastEntry.at))}</Body> : null}

      {items.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={tr.catchup.nothing}
          action={<Button icon={Plus} label={tr.cashflow.addTransaction} variant="secondary" onPress={() => router.push("/transaction")} />}
        />
      ) : (
        // One column at every width. Two columns of confirmations put the same
        // decision in two places on the screen and halved the room each row had
        // for its own action cluster.
        <WorkspaceGrid testID="reconciliation-grid" layout="stack">
        {items.map((e) => (
          <Card key={e.id}>
            <Spread>
              <View style={{ flex: 1 }}>
                <Row gap={spacing.sm} style={{ flexWrap: "wrap" }}>
                  {e.dueDate < today ? <Badge text={tr.dashboard.late} tone="error" /> : null}
                  {e.direction === "in" ? <Badge text={tr.dashboard.expectedIncome} tone="positive" /> : null}
                  {e.amountIsEstimated && e.amountMinor !== 0 ? <Badge text={tr.subs.estimatedBadge} tone="warning" /> : null}
                  <Body>{nameOf(e)}</Body>
                </Row>
                <Body muted style={{ marginTop: spacing.xs }}>
                  {dateLabel(e.dueDate)} · {amountFragment(e)}
                </Body>
              </View>
            </Spread>
            {matchingId === e.id ? (
              /* Candidates for THIS expectation, ranked and never applied on
                 their own: an exact amount on the due date is still only a
                 candidate, because the owner is the one who knows whether the
                 bill they paid was this month's. */
              <View style={{ marginTop: spacing.md }}>
                <Body style={{ marginBottom: 2 }}>{tr.matching.title}</Body>
                <Body muted style={{ marginBottom: spacing.sm }}>{tr.matching.hint}</Body>
                {candidatesFor({
                  id: e.id,
                  dueDate: e.dueDate,
                  amountMinor: e.amountMinor,
                  currency: e.currency,
                  direction: e.direction,
                }).length === 0 ? (
                  <Body muted>{tr.matching.none}</Body>
                ) : (
                  candidatesFor({
                    id: e.id,
                    dueDate: e.dueDate,
                    amountMinor: e.amountMinor,
                    currency: e.currency,
                    direction: e.direction,
                  }).map((candidate) => {
                    const reason = [
                      candidate.sameAmount ? tr.matching.exactAmount : tr.matching.closeAmount,
                      candidate.dayGap === 0 ? tr.matching.sameDay : tr.matching.dayGap(candidate.dayGap),
                    ].join(" · ");
                    return (
                      <Spread
                        key={candidate.transactionId}
                        style={{ alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs }}
                      >
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Body>{formatMinorCompact(candidate.amountTryMinor)}</Body>
                          <Body muted style={{ marginTop: 2 }}>{dateLabel(candidate.effectiveDate)} · {reason}</Body>
                        </View>
                        <Button
                          size="sm"
                          variant="secondary"
                          label={tr.matching.confirm}
                          accessibilityHint={tr.matching.candidateA11y(
                            formatMinorCompact(candidate.amountTryMinor),
                            dateLabel(candidate.effectiveDate),
                            reason,
                          )}
                          onPress={() => void applyMatch(e.id, candidate.transactionId)}
                        />
                      </Spread>
                    );
                  })
                )}
                <Row style={{ marginTop: spacing.sm }}>
                  <Button label={tr.common.cancel} variant="ghost" onPress={() => setMatchingId(null)} />
                </Row>
              </View>
            ) : editing === e.id ? (
              <View style={{ marginTop: spacing.md }}>
                <MoneyField
                  label={`${isVariableSubscription(e) ? tr.subs.amountEntryTitle : tr.catchup.fixAmount} (${e.currency})`}
                  value={amountRaw}
                  onChangeMinor={(raw, minor) => {
                    setAmountRaw(raw);
                    setAmountMinor(minor);
                  }}
                  placeholder={formatMinorCompact(e.amountMinor, e.currency)}
                />
                <Row>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={tr.common.confirm}
                      onPress={() => {
                        if (amountMinor != null && amountMinor > 0) void confirm(e, amountMinor);
                      }}
                      loading={confirmingId === e.id}
                      disabled={amountMinor == null || amountMinor <= 0 || confirmingId != null}
                      haptic="none"
                    />
                  </View>
                  <Button label={tr.common.cancel} variant="ghost" onPress={() => setEditing(null)} />
                </Row>
              </View>
            ) : (
              // Three buttons, three widths taken from their own labels and one
              // gap between them. They used to be stretched to 1 / 1.45 / 0.7
              // of the row, so "Alındı", "Tutarı düzelt" and "Atla" sat at
              // three arbitrary widths with a 4px gap: the cluster read as one
              // squeezed block rather than as three choices.
              <Row gap={spacing.sm} style={{ marginTop: spacing.md, maxWidth: actionClusterWidth, flexWrap: "wrap" }}>
                <View>
                  <Button
                    size="sm"
                    variant="ghost"
                    testID={`match-${e.id}`}
                    label={tr.matching.action}
                    onPress={() => setMatchingId(e.id)}
                    disabled={confirmingId != null}
                  />
                </View>
                <View>
                  <Button
                    size="sm"
                    label={needsAmountEntry(e) ? tr.subs.enterAmount : e.direction === "in" ? tr.dashboard.received : tr.dashboard.markPaid}
                    loading={confirmingId === e.id}
                    disabled={confirmingId != null}
                    haptic="none"
                    onPress={() => {
                      if (needsAmountEntry(e)) {
                        confirmDiscard(() => {
                          setEditing(e.id);
                          setAmountRaw("");
                          setAmountMinor(null);
                        });
                      } else {
                        void confirm(e);
                      }
                    }}
                  />
                </View>
                <View>
                  <Button
                    size="sm"
                    label={needsAmountEntry(e) ? tr.subs.enterAmount : tr.catchup.fixAmount}
                    variant="secondary"
                    onPress={() => confirmDiscard(() => {
                      setEditing(e.id);
                      setAmountRaw("");
                      setAmountMinor(null);
                    })}
                  />
                </View>
                <View>
                  <Button
                    size="sm"
                    label={tr.common.skip}
                    variant="ghost"
                    loading={confirmingId === e.id}
                    disabled={confirmingId != null}
                    onPress={() => void skip(e)}
                  />
                </View>
              </Row>
            )}
          </Card>
        ))}
        </WorkspaceGrid>
      )}
      <DuplicateReview
        transactions={transactionsState.data}
        onOpen={(id) => router.push({ pathname: "/transaction", params: { id } })}
      />

      {/* Only once there is a list to add to: with nothing pending, the same
          action is the empty state's own way out and repeating it here left it
          stranded at the bottom of an otherwise empty page. */}
      {items.length > 0 ? (
        <Button icon={Plus} label={tr.cashflow.addTransaction} variant="secondary" onPress={() => router.push("/transaction")} />
      ) : null}
    </Screen>
  );
}
