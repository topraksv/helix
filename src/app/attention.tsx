/**
 * The attention inbox.
 *
 * Every row is a view of a record that already exists, so there is no second
 * store to drift from the ledger and no history to prune: an item leaves the
 * moment the thing it is about is dealt with, wherever that happened. What IS
 * stored is only what the owner did to a row — read, dismissed, snoozed — and
 * `domain/attention.ts` keeps that bounded.
 *
 * An expected payment is settled on its own row — paid, paid at a corrected
 * amount, or skipped — because a separate confirmation screen put the same
 * overdue bill in two places with two sets of buttons, and "Kaldır" here hid
 * the row without recording the payment.
 */

import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Stack, useRouter, type Href } from "expo-router";
import BellOff from "lucide-react-native/icons/bell-off";
import {
  settingValue,
  useAllTransactionsState,
  useLedgerState,
  usePendingExpectedState,
  usePersonsState,
  usePlansState,
  useRecurringIncomesState,
  useSettingsMapState,
  useSubscriptionsState,
  useUserId,
} from "../data/hooks";
import { combineLiveStates } from "../data/live-state";
import { setAttentionState, skipExpected, unskipExpected } from "../data/repo";
import { confirmExpectedPayment } from "../ui/save-result";
import { addDaysISO, todayISO, yearOf } from "../domain/dates";
import { formatMinorCompact } from "../domain/money";
import { balanceDeclarationDrift, parseBalanceDeclaration } from "../domain/balance-declaration";
import {
  EMPTY_ATTENTION_STATE,
  buildAttentionInbox,
  groupAttention,
  isAttentionState,
  snoozeUntil,
  unreadCount,
  type AttentionCandidate,
  type AttentionItem,
  type AttentionState,
} from "../domain/attention";
import { needsVariableAmountEntry, isVariableSubscriptionOccurrence } from "../domain/subscriptions";
import { dateLabel, tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { devError } from "../services/logger";
import { Badge, Body, Button, Card, DataStateNotice, EmptyState, MoneyField, Row, Screen, SectionHeader, Spread } from "../ui/components";
import { appAlert } from "../ui/dialog";
import { useDirtyExitGuard } from "../ui/dirty-exit";
import { useOperationGuard } from "../ui/operation-guard";
import { useUndo } from "../ui/undo";
import { spacing, type, useTheme } from "../ui/theme";
import { WorkspaceGrid } from "../ui/workspace-layout";

/** How far ahead an unpaid obligation is worth mentioning at all. */
const HORIZON_DAYS = 14;

export default function AttentionScreen() {
  const userId = useUserId();
  const router = useRouter();
  const { palette } = useTheme();
  const undo = useUndo();
  const today = todayISO();

  const expectedState = usePendingExpectedState();
  const subscriptionsState = useSubscriptionsState();
  const incomesState = useRecurringIncomesState();
  const plansState = usePlansState();
  const transactionsState = useAllTransactionsState();
  const settingsState = useSettingsMapState();
  const ledgerState = useLedgerState(yearOf(today));
  const personsState = usePersonsState();
  const { status, ready, retry } = combineLiveStates([
    expectedState, subscriptionsState, incomesState, plansState, transactionsState, settingsState, ledgerState, personsState,
  ]);

  const stored = settingValue<unknown>(settingsState.data, "attention_state", null);
  const state: AttentionState = isAttentionState(stored) ? stored : EMPTY_ATTENTION_STATE;

  const candidates = useMemo<AttentionCandidate[]>(() => {
    const horizon = addDaysISO(today, HORIZON_DAYS);
    const nameOf = (refId: string): string | null =>
      subscriptionsState.data.find((rule) => rule.id === refId)?.name
      ?? incomesState.data.find((rule) => rule.id === refId)?.name
      ?? null;

    const rows: AttentionCandidate[] = [];
    for (const item of expectedState.data) {
      if (item.status !== "pending" && item.status !== "late") continue;
      if (item.dueDate > horizon) continue;
      const late = item.dueDate < today;
      rows.push({
        id: `expected:${item.id}`,
        kind: late ? "late" : item.dueDate === today ? "dueToday" : "upcoming",
        date: item.dueDate,
        amountMinor: item.amountIsEstimated && item.amountMinor === 0 ? null : item.amountMinor,
        currency: item.currency,
        target: { kind: "expected", id: item.id },
        name: nameOf(item.refId),
        // An overdue bill is not something to put off; a future one is.
        snoozable: !late,
      });
    }
    for (const rule of subscriptionsState.data) {
      if (!rule.isActive || !rule.trialEndDate) continue;
      if (rule.trialEndDate < today || rule.trialEndDate > horizon) continue;
      rows.push({
        id: `trial:${rule.id}`,
        kind: "trialEnding",
        date: rule.trialEndDate,
        amountMinor: rule.amountMinor,
        currency: rule.currency,
        target: { kind: "subscription", id: rule.id },
        name: rule.name,
        snoozable: false,
      });
    }
    // A plan's last instalment is the one worth knowing about: the obligation
    // ends, and nothing else in the app says so.
    const planById = new Map(plansState.data.map((plan) => [plan.id, plan]));
    for (const transaction of transactionsState.data) {
      if (!transaction.installmentPlanId || transaction.status !== "pending") continue;
      const plan = planById.get(transaction.installmentPlanId);
      if (!plan || transaction.installmentNo !== plan.installmentCount) continue;
      if (transaction.effectiveDate < today || transaction.effectiveDate > horizon) continue;
      rows.push({
        id: `final:${plan.id}`,
        kind: "finalInstallment",
        date: transaction.effectiveDate,
        amountMinor: transaction.amountTryMinor,
        currency: "TRY",
        target: { kind: "installmentPlan", id: plan.id },
        name: plan.title,
        snoozable: false,
      });
    }
    const declaration = parseBalanceDeclaration(settingValue<unknown>(settingsState.data, "balance_declared", null));
    const drift = balanceDeclarationDrift(declaration, ledgerState.data?.actualBalanceMinor ?? null);
    if (drift != null && drift !== 0) {
      rows.push({
        id: "balance:drift",
        kind: "driftedBalance",
        date: today,
        amountMinor: drift,
        currency: "TRY",
        target: { kind: "balance" },
        name: null,
        snoozable: true,
      });
    }
    return rows;
  }, [expectedState.data, subscriptionsState.data, incomesState.data, plansState.data, transactionsState.data, settingsState.data, ledgerState.data, today]);

  const items = useMemo(() => buildAttentionInbox(candidates, state, today), [candidates, state, today]);
  const groups = useMemo(() => groupAttention(items), [items]);
  const liveIds = useMemo(() => new Set(candidates.map((candidate) => candidate.id)), [candidates]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const operationGuard = useOperationGuard();
  const selfPersonId = personsState.data.find((person) => person.isSelf)?.id;
  const expectedById = useMemo(() => new Map(expectedState.data.map((item) => [item.id, item])), [expectedState.data]);
  const subscriptionById = useMemo(() => new Map(subscriptionsState.data.map((rule) => [rule.id, rule])), [subscriptionsState.data]);
  const incomeById = useMemo(() => new Map(incomesState.data.map((rule) => [rule.id, rule])), [incomesState.data]);
  type Expected = (typeof expectedState.data)[number];
  const nameOf = (e: Expected) => subscriptionById.get(e.refId)?.name ?? incomeById.get(e.refId)?.name ?? tr.common.paymentFallback;
  const [editing, setEditing] = useState<string | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [attempted, setAttempted] = useState(false);
  const openEditor = (id: string | null) => {
    setEditing(id);
    setAmountRaw("");
    setAmountMinor(null);
    setAttempted(false);
  };
  const { confirmDiscard } = useDirtyExitGuard(editing != null && amountRaw.trim() !== "");

  const confirm = (e: Expected, actual?: number) => operationGuard.run(async () => {
    if (!selfPersonId) return;
    setBusyId(`expected:${e.id}`);
    const rule = subscriptionById.get(e.refId) ?? incomeById.get(e.refId);
    if (await confirmExpectedPayment({ userId, expected: e, name: nameOf(e), selfPersonId, rule, actualAmountMinor: actual })) openEditor(null);
    setBusyId(null);
  });

  /** A skip is a real write: guarded, reported, and undoable, since it is otherwise silent. */
  const skip = (e: Expected) => operationGuard.run(async () => {
    setBusyId(`expected:${e.id}`);
    try {
      await skipExpected(userId, e.id);
      scheduleSync(userId);
      undo.show(tr.catchup.skipped(nameOf(e)), () => unskipExpected(userId, e.id).then(() => scheduleSync(userId)), "warning");
    } catch (err) {
      devError("attention.skip", err);
      void appAlert(tr.errors.saveFailed, undefined, { tone: "error" });
    } finally {
      setBusyId(null);
    }
  });

  const persist = async (next: AttentionState, notice?: string, undoTo?: AttentionState) => {
    try {
      await setAttentionState(userId, next, liveIds);
      scheduleSync(userId);
      if (notice) {
        undo.show(notice, undoTo ? () => setAttentionState(userId, undoTo, liveIds).then(() => scheduleSync(userId)) : null);
      }
    } catch (error) {
      devError("attention.state", error);
    }
  };

  const markRead = (item: AttentionItem) => {
    if (!item.unread) return;
    void persist({ ...state, read: [...state.read.filter((id) => id !== item.id), item.id] });
  };

  const openItem = (item: AttentionItem) => {
    markRead(item);
    const href: Href = item.target.kind === "subscription"
      ? { pathname: "/subscription-form", params: { id: item.target.id } }
      : item.target.kind === "installmentPlan"
        ? { pathname: "/installment-new", params: { id: item.target.id } }
        : item.target.kind === "balance"
          ? ("/opening-balance" as Href)
          : ("/upcoming" as Href);
    router.push(href);
  };

  const dismiss = async (item: AttentionItem) => {
    setBusyId(item.id);
    try {
      await persist(
        { ...state, dismissed: [...state.dismissed.filter((id) => id !== item.id), item.id] },
        tr.attention.dismissed,
        state,
      );
    } finally {
      setBusyId(null);
    }
  };

  const snooze = async (item: AttentionItem) => {
    setBusyId(item.id);
    try {
      await persist(
        { ...state, snoozedUntil: { ...state.snoozedUntil, [item.id]: snoozeUntil(today) } },
        tr.attention.snoozed,
        state,
      );
    } finally {
      setBusyId(null);
    }
  };

  /** An expected payment's own answers, or null for a row that only opens somewhere. */
  const expectedActionsFor = (item: AttentionItem) => {
    const e = item.target.kind === "expected" ? expectedById.get(item.target.id) : undefined;
    if (!e) return null;
    return (
      <ExpectedActions
        expected={e}
        name={item.name ?? tr.common.paymentFallback}
        variable={isVariableSubscriptionOccurrence(e, subscriptionById)}
        needsAmount={needsVariableAmountEntry(e, subscriptionById)}
        busy={busyId === item.id}
        editing={editing === e.id}
        amountRaw={amountRaw}
        amountError={attempted && !(amountMinor != null && amountMinor > 0) ? tr.required.amount : null}
        onAmount={(raw, minor) => {
          setAmountRaw(raw);
          setAmountMinor(minor);
        }}
        onPaid={(paid) => {
          markRead(item);
          void confirm(paid);
        }}
        onEdit={(edited) => confirmDiscard(() => openEditor(edited.id))}
        onConfirmAmount={(confirmed) => {
          if (amountMinor != null && amountMinor > 0) void confirm(confirmed, amountMinor);
          else setAttempted(true);
        }}
        onCancelEdit={() => openEditor(null)}
        onSkip={(skipped) => void skip(skipped)}
        snooze={item.snoozable ? () => void snooze(item) : null}
      />
    );
  };

  if (!ready) {
    return (
      <Screen>
        <Stack.Screen options={{ title: tr.attention.title }} />
        <DataStateNotice status={status} retry={retry} />
      </Screen>
    );
  }

  const unread = unreadCount(items);

  return (
    <Screen width="workspace">
      <Stack.Screen options={{ title: tr.attention.title }} />
      <DataStateNotice status={status} retry={retry} />
      <Spread style={{ alignItems: "center", marginBottom: spacing.sm }}>
        <Body muted style={{ flex: 1, minWidth: 0 }}>{tr.attention.subtitle}</Body>
        {unread > 0 ? <Badge text={tr.attention.unreadCount(unread)} tone="primary" /> : null}
      </Spread>

      {items.length === 0 ? (
        <EmptyState icon={BellOff} title={tr.attention.empty} hint={tr.attention.emptyHint} />
      ) : (
        <WorkspaceGrid testID="attention-groups" layout="stack">
          {groups.map((group) => (
            <View key={group.group}>
              <SectionHeader>{tr.attention.groups[group.group]}</SectionHeader>
              {group.items.map((item) => (
                <Card
                  key={item.id}
                  testID={`attention-item-${item.id}`}
                  tone={item.group === "overdue" ? "error" : undefined}
                >
                  <Row gap={spacing.sm} style={{ flexWrap: "wrap" }}>
                    {/* Unread is a word, not a dot: a coloured mark alone says
                        nothing to a reader who cannot see it. */}
                    {item.unread ? <Badge text={tr.attention.unread} tone="primary" /> : null}
                    <Badge text={tr.attention.kinds[item.kind]} tone={item.group === "overdue" ? "error" : "muted"} />
                  </Row>
                  <Body style={{ marginTop: spacing.xs }}>
                    {item.name ?? tr.attention.kinds[item.kind]}
                  </Body>
                  <Text
                    accessible
                    accessibilityLabel={tr.attention.itemA11y(
                      tr.attention.kinds[item.kind],
                      item.name ?? "",
                      dateLabel(item.date),
                      item.unread ? tr.attention.unread : "",
                    )}
                    style={[type.small, { color: palette.textSecondary, marginTop: 2 }]}
                  >
                    {dateLabel(item.date)}
                    {item.amountMinor != null ? ` · ${formatMinorCompact(item.amountMinor, item.currency)}` : ""}
                  </Text>
                  {expectedActionsFor(item) ?? (
                    <Row gap={spacing.sm} style={{ marginTop: spacing.sm, flexWrap: "wrap" }}>
                      <View>
                        <Button size="sm" label={tr.attention.open} onPress={() => openItem(item)} />
                      </View>
                      {item.snoozable ? (
                        <View>
                          <Button
                            size="sm"
                            variant="ghost"
                            label={tr.attention.snooze}
                            disabled={busyId === item.id}
                            onPress={() => void snooze(item)}
                          />
                        </View>
                      ) : null}
                      <View>
                        <Button
                          size="sm"
                          variant="ghost"
                          label={tr.attention.done}
                          disabled={busyId === item.id}
                          onPress={() => void dismiss(item)}
                        />
                      </View>
                    </Row>
                  )}
                </Card>
              ))}
            </View>
          ))}
        </WorkspaceGrid>
      )}
    </Screen>
  );
}

type ExpectedRow = ReturnType<typeof usePendingExpectedState>["data"][number];

/** Paid, paid at another amount, or skipped: the three answers an expected payment can get, on its own row. */
function ExpectedActions({
  expected: e, name, variable, needsAmount, busy, editing, amountRaw, amountError,
  onAmount, onPaid, onEdit, onConfirmAmount, onCancelEdit, onSkip, snooze,
}: {
  expected: ExpectedRow;
  name: string;
  variable: boolean;
  needsAmount: boolean;
  busy: boolean;
  editing: boolean;
  amountRaw: string;
  amountError: string | null;
  onAmount: (raw: string, minor: number | null) => void;
  onPaid: (e: ExpectedRow) => void;
  onEdit: (e: ExpectedRow) => void;
  onConfirmAmount: (e: ExpectedRow) => void;
  onCancelEdit: () => void;
  onSkip: (e: ExpectedRow) => void;
  snooze: (() => void) | null;
}) {
  if (editing) {
    return (
      <View style={{ marginTop: spacing.md }}>
        <MoneyField
          label={`${variable ? tr.subs.amountEntryTitle : tr.catchup.fixAmount} (${e.currency})`}
          value={amountRaw}
          onChangeMinor={onAmount}
          placeholder={formatMinorCompact(e.amountMinor, e.currency)}
          error={amountError}
        />
        <Row>
          <View style={{ flex: 1 }}>
            <Button label={tr.common.confirm} onPress={() => onConfirmAmount(e)} loading={busy} haptic="none" />
          </View>
          <Button label={tr.common.cancel} variant="ghost" onPress={onCancelEdit} />
        </Row>
      </View>
    );
  }
  return (
    <Row gap={spacing.sm} style={{ marginTop: spacing.sm, flexWrap: "wrap" }}>
      <View>
        <Button
          size="sm"
          label={needsAmount ? tr.subs.enterAmount : e.direction === "in" ? tr.dashboard.received : tr.dashboard.markPaid}
          subject={name}
          loading={busy}
          disabled={busy}
          haptic="none"
          onPress={() => (needsAmount ? onEdit(e) : onPaid(e))}
        />
      </View>
      {needsAmount ? null : (
        <View>
          <Button size="sm" variant="secondary" label={tr.catchup.fixAmount} subject={name} onPress={() => onEdit(e)} />
        </View>
      )}
      {snooze ? (
        <View>
          <Button size="sm" variant="ghost" label={tr.attention.snooze} subject={name} disabled={busy} onPress={snooze} />
        </View>
      ) : null}
      <View>
        <Button size="sm" variant="ghost" label={tr.common.skip} subject={name} disabled={busy} onPress={() => onSkip(e)} />
      </View>
    </Row>
  );
}
