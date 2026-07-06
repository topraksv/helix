/** Catch-up / reconciliation screen ("nerede kaldım"): everything that came
 *  due since the last entry, confirm/skip/correct with bank statement in hand. */

import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { CheckCircle2, Plus } from "lucide-react-native";
import { confirmExpected, revertExpected, skipExpected } from "../data/repo";
import {
  useLastEntryInfo,
  usePendingExpected,
  usePersons,
  useRecurringIncomes,
  useSubscriptions,
  useUserId,
} from "../data/hooks";
import { todayISO } from "../domain/dates";
import { formatMinor, parseTRAmountToMinor } from "../domain/money";
import { dateLabel, tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { Badge, Body, Button, Card, EmptyState, Field, Row, Screen, Spread } from "../ui/components";
import { useUndo } from "../ui/undo";
import { spacing } from "../ui/theme";

export default function CatchUpScreen() {
  const userId = useUserId();
  const expected = usePendingExpected();
  const subscriptions = useSubscriptions();
  const incomes = useRecurringIncomes();
  const persons = usePersons();
  const lastEntry = useLastEntryInfo();
  const router = useRouter();
  const undo = useUndo();
  const today = todayISO();
  const [editing, setEditing] = useState<string | null>(null);
  const [amountRaw, setAmountRaw] = useState("");

  const selfPersonId = persons.find((p) => p.isSelf)?.id;
  const items = expected
    .filter((e) => (e.status === "pending" || e.status === "late") && e.dueDate <= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const nameOf = (e: (typeof expected)[number]) =>
    subscriptions.find((s) => s.id === e.refId)?.name ?? incomes.find((i) => i.id === e.refId)?.name ?? tr.common.paymentFallback;

  const confirm = async (e: (typeof expected)[number], actual?: number) => {
    if (!selfPersonId) return;
    const sub = subscriptions.find((s) => s.id === e.refId);
    const income = incomes.find((i) => i.id === e.refId);
    await confirmExpected(userId, e.id, {
      personId: sub?.personId ?? income?.personId ?? selfPersonId,
      categoryId: sub?.categoryId ?? income?.categoryId ?? null,
      actualAmountMinor: actual,
    });
    scheduleSync(userId);
    setEditing(null);
    setAmountRaw("");
    undo.show(`${nameOf(e)} ✓`, () => void revertExpected(userId, e.id));
  };

  return (
    <Screen>
      {lastEntry.at ? <Body muted style={{ marginBottom: spacing.md }}>{tr.catchup.subtitle(dateLabel(lastEntry.at))}</Body> : null}

      {items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={tr.catchup.nothing} />
      ) : (
        items.map((e) => (
          <Card key={e.id}>
            <Spread>
              <View style={{ flex: 1 }}>
                <Row gap={spacing.sm}>
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
                <Field
                  label={`${tr.catchup.fixAmount} (${e.currency})`}
                  value={amountRaw}
                  onChangeText={setAmountRaw}
                  keyboardType="decimal-pad"
                  placeholder={formatMinor(e.amountMinor, e.currency)}
                />
                <Row>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={tr.common.confirm}
                      onPress={() => {
                        const minor = parseTRAmountToMinor(amountRaw);
                        if (minor != null && minor > 0) void confirm(e, minor);
                      }}
                      disabled={parseTRAmountToMinor(amountRaw) == null}
                    />
                  </View>
                  <Button label={tr.common.cancel} variant="ghost" onPress={() => setEditing(null)} />
                </Row>
              </View>
            ) : (
              <Row style={{ marginTop: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label={e.direction === "in" ? tr.dashboard.received : tr.dashboard.markPaid}
                    onPress={() => void confirm(e)}
                  />
                </View>
                <Button label={tr.catchup.fixAmount} variant="secondary" onPress={() => { setEditing(e.id); setAmountRaw(""); }} />
                <Button label={tr.common.skip} variant="ghost" onPress={() => { void skipExpected(userId, e.id); scheduleSync(userId); }} />
              </Row>
            )}
          </Card>
        ))
      )}

      <Button icon={Plus} label={tr.cashflow.addTransaction} variant="secondary" onPress={() => router.push("/transaction")} />
    </Screen>
  );
}
