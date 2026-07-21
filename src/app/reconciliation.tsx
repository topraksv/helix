/** Catch-up / reconciliation screen ("nerede kaldım"): everything that came
 *  due since the last entry, confirm/skip/correct with bank statement in hand. */

import React, { useState } from "react";
import { View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { CheckCircle2, Plus } from "lucide-react-native";
import { confirmExpected, FxRateUnavailableError, revertExpected, skipExpected, unskipExpected } from "../data/repo";
import {
  useLastEntryInfoState,
  usePendingExpectedState,
  usePersonsState,
  useRecurringIncomesState,
  useSubscriptionsState,
  useUserId,
} from "../data/hooks";
import { combineLiveQueryStatus } from "../data/live-state";
import { todayISO } from "../domain/dates";
import { formatMinor } from "../domain/money";
import { dateLabel, tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { devError } from "../services/logger";
import { Badge, Body, Button, Card, DataStateNotice, EmptyState, MoneyField, Row, Screen, Spread } from "../ui/components";
import { appAlert } from "../ui/dialog";
import { useUndo } from "../ui/undo";
import { errorNotice } from "../ui/haptics";
import { spacing } from "../ui/theme";
import { useOperationGuard } from "../ui/operation-guard";
import { useDirtyExitGuard } from "../ui/dirty-exit";

export default function CatchUpScreen() {
  const userId = useUserId();
  const expectedState = usePendingExpectedState();
  const subscriptionsState = useSubscriptionsState();
  const incomesState = useRecurringIncomesState();
  const personsState = usePersonsState();
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
  useDirtyExitGuard(editing != null && amountRaw.trim() !== "");
  // One confirmation at a time (spinner on the active button) — a double-tap
  // must not submit the same expected item twice.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const operationGuard = useOperationGuard();
  const liveStates = [expectedState, subscriptionsState, incomesState, personsState, lastEntryState];
  const dataStatus = combineLiveQueryStatus(liveStates);
  const dataReady = liveStates.every((state) => state.updatedAt != null);
  const retryData = () => {
    expectedState.retry();
    subscriptionsState.retry();
    incomesState.retry();
    personsState.retry();
    lastEntryState.retry();
  };

  const selfPersonId = persons.find((p) => p.isSelf)?.id;
  const subscriptionById = new Map(subscriptions.map((subscription) => [subscription.id, subscription]));
  const incomeById = new Map(incomes.map((income) => [income.id, income]));
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

  if (!dataReady) {
    return (
      <Screen>
        <Stack.Screen options={{ title: tr.catchup.title }} />
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: tr.catchup.title }} />
      <DataStateNotice status={dataStatus} retry={retryData} />
      <Body muted style={{ marginBottom: spacing.md }}>{tr.catchup.intro}</Body>
      {lastEntry.at ? <Body muted style={{ marginBottom: spacing.md }}>{tr.catchup.subtitle(dateLabel(lastEntry.at))}</Body> : null}

      {items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={tr.catchup.nothing} />
      ) : (
        items.map((e) => (
          <Card key={e.id}>
            <Spread>
              <View style={{ flex: 1 }}>
                <Row gap={spacing.sm} style={{ flexWrap: "wrap" }}>
                  {e.dueDate < today ? <Badge text={tr.dashboard.late} tone="negative" /> : null}
                  {e.direction === "in" ? <Badge text={tr.dashboard.expectedIncome} tone="positive" /> : null}
                  <Body>{nameOf(e)}</Body>
                </Row>
                <Body muted>
                  {dateLabel(e.dueDate)} · {formatMinor(e.amountMinor, e.currency)}
                </Body>
              </View>
            </Spread>
            {editing === e.id ? (
              <View style={{ marginTop: spacing.md }}>
                <MoneyField
                  label={`${tr.catchup.fixAmount} (${e.currency})`}
                  value={amountRaw}
                  onChangeMinor={(raw, minor) => {
                    setAmountRaw(raw);
                    setAmountMinor(minor);
                  }}
                  placeholder={formatMinor(e.amountMinor, e.currency)}
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
              <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                <View>
                  <Button
                    label={e.direction === "in" ? tr.dashboard.received : tr.dashboard.markPaid}
                    loading={confirmingId === e.id}
                    disabled={confirmingId != null}
                    haptic="none"
                    onPress={() => void confirm(e)}
                  />
                </View>
                <Row gap={spacing.sm}>
                  <View style={{ flex: 1 }}>
                    <Button label={tr.catchup.fixAmount} variant="secondary" onPress={() => { setEditing(e.id); setAmountRaw(""); setAmountMinor(null); }} />
                  </View>
                  <Button
                    label={tr.common.skip}
                    variant="ghost"
                    loading={confirmingId === e.id}
                    disabled={confirmingId != null}
                    onPress={() => void skip(e)}
                  />
                </Row>
              </View>
            )}
          </Card>
        ))
      )}

      <Button icon={Plus} label={tr.cashflow.addTransaction} variant="secondary" onPress={() => router.push("/transaction")} />
    </Screen>
  );
}
