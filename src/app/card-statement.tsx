/**
 * One card statement: what is on it, what has been paid, and a payment made by
 * hand (spec §3.1f).
 *
 * A statement nobody records a payment for is paid in full on its due date,
 * which is how every card charge already reaches the balance. The first payment
 * recorded here ends that assumption for this statement alone, so the form says
 * so before it is used rather than after.
 */

import { useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import CreditCard from "lucide-react-native/icons/credit-card";
import ReceiptText from "lucide-react-native/icons/receipt-text";
import Trash from "lucide-react-native/icons/trash";
import Wallet from "lucide-react-native/icons/wallet";
import { addStatementPayment, deleteStatementPayment, restoreStatementPayment, StatementPaymentTooLargeError } from "../data/repo";
import {
  useCardSettlement,
  useCategoriesState,
  useCreditCardStatementsState,
  usePersonsState,
  useSourcesState,
  useStatementPaymentsState,
  useUserId,
} from "../data/hooks";
import { combineLiveStates } from "../data/live-state";
import type { StatementSettlement } from "../domain/card-statements";
import { todayISO, type ISODate, type MonthKey } from "../domain/dates";
import { formatMinorCompact } from "../domain/money";
import { financialFlow } from "../domain/transactions";
import type { StatementPaymentKind, TxLike } from "../domain/types";
import { dateLabel, monthLabel, tr } from "../i18n/tr";
import { DateField } from "../ui/calendar";
import {
  Amount,
  Badge,
  Body,
  Button,
  Card,
  CardList,
  ChoiceTile,
  DataGateScreen,
  DataStateNotice,
  EmptyState,
  Field,
  IconButton,
  ListRow,
  MetricStrip,
  MoneyField,
  MonthStepper,
  PanelHeader,
  Row,
  Screen,
  SectionHeader,
  Select,
} from "../ui/components";
import { appAlert } from "../ui/dialog";
import { useOperationGuard } from "../ui/operation-guard";
import { useUndo } from "../ui/undo";
import { spacing, type } from "../ui/theme";
import { scheduleSync } from "../sync/engine";
import { devError } from "../services/logger";

type Statement = ReturnType<typeof useCreditCardStatementsState>["data"][number];
type Source = ReturnType<typeof useSourcesState>["data"][number];
type Payment = ReturnType<typeof useStatementPaymentsState>["data"][number];

const KINDS: StatementPaymentKind[] = ["full", "minimum", "partial"];

/** The badge a statement wears: what was recorded, else what is assumed. */
function statementBadge(settled: StatementSettlement | undefined, dueDate: string, today: string) {
  if (settled) return { text: tr.cardStatement.state[settled.state], tone: settled.state === "full" ? "success" as const : "warning" as const };
  return dueDate <= today
    ? { text: tr.cardStatement.stateAssumed, tone: "muted" as const }
    : { text: tr.cardStatement.stateOpen, tone: "primary" as const };
}

/** The sentence under the badge: what the recorded payments did to the balance. */
function statementHint(settled: StatementSettlement | undefined): string {
  if (!settled) return tr.cardStatement.assumptionHint;
  return settled.paidInFullOn
    ? tr.cardStatement.fullHint(dateLabel(settled.paidInFullOn))
    : tr.cardStatement.owedHint(formatMinorCompact(settled.remainingMinor));
}

/** The card the screen shows: the one chosen, else the one a row handed over, else the first. */
function pickCard(cards: Source[], cardChoice: string | null, handedOver: string | undefined): Source | undefined {
  return cards.find((candidate) => candidate.id === cardChoice)
    ?? cards.find((candidate) => candidate.id === handedOver)
    ?? cards[0];
}

/**
 * The statement month the screen shows: the one chosen, else the statement a
 * row handed over — until another card is chosen — else the next one still to
 * be paid, else the last there is.
 */
function openingMonth(
  statements: Statement[],
  handedOverId: string | undefined,
  cardChosen: boolean,
  monthChoice: MonthKey | null,
  today: string,
): MonthKey | null {
  if (monthChoice) return monthChoice;
  const handedOver = cardChosen ? undefined : statements.find((statement) => statement.id === handedOverId);
  const opening = handedOver ?? statements.find((statement) => statement.dueDate >= today) ?? statements.at(-1);
  return opening?.periodMonth ?? null;
}

function StatementDetail({
  statement,
  cardName,
  charges,
  payments,
  categoryName,
}: {
  statement: Statement;
  cardName: string;
  charges: TxLike[];
  payments: Payment[];
  categoryName: (id: string | null) => string;
}) {
  const userId = useUserId();
  const router = useRouter();
  const undo = useUndo();
  const operationGuard = useOperationGuard();
  const { byStatement } = useCardSettlement();
  const today = todayISO();
  const chargesMinor = charges.reduce((sum, tx) => sum + financialFlow(tx).amountTryMinor, 0);
  const paidMinor = payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
  const remainingMinor = Math.max(0, chargesMinor - paidMinor);
  const settled = byStatement.get(statement.id);

  const [kind, setKind] = useState<StatementPaymentKind>("full");
  const [amountRaw, setAmountRaw] = useState("");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [paidOn, setPaidOn] = useState<ISODate>(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // A full payment is whatever is still owed; asking for the figure would only
  // invite one that is a kuruş off and quietly records a partial payment.
  const payMinor = kind === "full" ? remainingMinor : amountMinor;
  const valid = payMinor != null && payMinor > 0 && payMinor <= remainingMinor;

  const kindLabel: Record<StatementPaymentKind, string> = {
    full: tr.cardStatement.kindFull,
    minimum: tr.cardStatement.kindMinimum,
    partial: tr.cardStatement.kindPartial,
  };
  const kindHint: Record<StatementPaymentKind, string> = {
    full: tr.cardStatement.kindFullHint(formatMinorCompact(remainingMinor)),
    minimum: tr.cardStatement.kindMinimumHint,
    partial: tr.cardStatement.kindPartialHint,
  };
  const badge = statementBadge(settled, statement.dueDate, today);
  const hint = statementHint(settled);

  const save = async () => {
    if (!valid) return;
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        const id = await addStatementPayment(userId, {
          statementId: statement.id,
          paidOn,
          amountMinor: payMinor,
          kind,
          note: note.trim() || null,
        });
        scheduleSync(userId);
        setKind("full");
        setAmountRaw("");
        setAmountMinor(null);
        setNote("");
        undo.show(tr.cardStatement.saved, () => deleteStatementPayment(userId, id).then(() => scheduleSync(userId)));
      } catch (error) {
        devError("card-statement.pay", error);
        void appAlert(
          error instanceof StatementPaymentTooLargeError
            ? tr.cardStatement.tooLarge(formatMinorCompact(error.remainingMinor))
            : tr.errors.saveFailed,
          tr.errors.title,
        );
      } finally {
        setBusy(false);
      }
    });
  };

  const remove = (payment: Payment) => {
    void operationGuard.run(async () => {
      try {
        const snapshot = await deleteStatementPayment(userId, payment.id);
        scheduleSync(userId);
        if (snapshot) {
          undo.show(tr.cardStatement.deleted, () => restoreStatementPayment(userId, snapshot).then(() => scheduleSync(userId)), "warning");
        }
      } catch (error) {
        devError("card-statement.delete", error);
        void appAlert(tr.errors.saveFailed, tr.errors.title);
      }
    });
  };

  return (
    <>
      <Card>
        <PanelHeader
          icon={ReceiptText}
          title={tr.cardStatement.periodTitle(cardName, monthLabel(statement.periodMonth))}
          description={tr.cardStatement.dates(dateLabel(statement.statementDate), dateLabel(statement.dueDate))}
        />
        <MetricStrip
          items={[
            { label: tr.cardStatement.charges, minor: chargesMinor },
            { label: tr.cardStatement.paid, minor: paidMinor },
            { label: tr.cardStatement.remaining, minor: remainingMinor },
          ]}
        />
        <View style={{ flexDirection: "row", marginTop: spacing.md }}>
          <Badge text={badge.text} tone={badge.tone} />
        </View>
        <Body muted style={{ marginTop: spacing.sm }}>{hint}</Body>
        <View style={{ marginTop: spacing.md }}>
          <Button
            icon={CreditCard}
            variant="secondary"
            label={tr.cardStatement.showInstallments}
            onPress={() => router.push({ pathname: "/installments", params: { card: statement.paymentSourceId } })}
          />
        </View>
      </Card>

      <Card>
        <PanelHeader icon={Wallet} title={tr.cardStatement.addTitle} description={tr.cardStatement.addHint} />
        {remainingMinor === 0 ? (
          <Body muted>{tr.cardStatement.nothingLeft}</Body>
        ) : (
          <>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={tr.cardStatement.addTitle}
              style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md }}
            >
              {KINDS.map((value) => (
                <ChoiceTile
                  key={value}
                  label={kindLabel[value]}
                  description={kindHint[value]}
                  selected={kind === value}
                  onPress={() => setKind(value)}
                />
              ))}
            </View>
            {kind === "full" ? null : (
              <MoneyField
                label={tr.cardStatement.amount}
                value={amountRaw}
                onChangeMinor={(raw, minor) => {
                  setAmountRaw(raw);
                  setAmountMinor(minor);
                }}
                error={amountMinor != null && amountMinor > remainingMinor ? tr.cardStatement.tooLarge(formatMinorCompact(remainingMinor)) : null}
              />
            )}
            <DateField label={tr.cardStatement.paidOn} value={paidOn} onChange={setPaidOn} max={today} />
            <Field label={tr.cardStatement.note} value={note} onChangeText={setNote} />
            <Button icon={Wallet} label={tr.cardStatement.save} onPress={() => void save()} disabled={!valid} loading={busy} />
          </>
        )}
      </Card>

      <SectionHeader>{tr.cardStatement.paymentsTitle}</SectionHeader>
      {payments.length === 0 ? (
        <Card><Body muted>{tr.cardStatement.paymentsEmpty}</Body></Card>
      ) : (
        <CardList
          items={payments}
          keyExtractor={(payment) => payment.id}
          renderItem={(payment) => (
            <ListRow
              title={kindLabel[payment.kind]}
              subtitle={[dateLabel(payment.paidOn), payment.note].filter(Boolean).join(" · ")}
              right={(
                <Row gap={spacing.sm}>
                  <Amount minor={payment.amountMinor} colorized={false} style={[type.amountSm, { textAlign: "right" }]} />
                  <IconButton
                    icon={Trash}
                    tone="danger"
                    label={`${tr.common.delete} · ${formatMinorCompact(payment.amountMinor)}`}
                    onPress={() => remove(payment)}
                  />
                </Row>
              )}
            />
          )}
        />
      )}

      <SectionHeader>{tr.cardStatement.chargesTitle}</SectionHeader>
      {charges.length === 0 ? (
        <Card><Body muted>{tr.cardStatement.chargesEmpty}</Body></Card>
      ) : (
        <CardList
          items={charges}
          keyExtractor={(tx) => tx.id}
          renderItem={(tx) => (
            <ListRow
              title={categoryName(tx.categoryId)}
              subtitle={dateLabel(tx.purchaseDate ?? tx.effectiveDate)}
              right={<Amount minor={financialFlow(tx).amountTryMinor} colorized={false} style={[type.amountSm, { textAlign: "right" }]} />}
            />
          )}
        />
      )}
    </>
  );
}

export default function CardStatementScreen() {
  const params = useLocalSearchParams<{ card?: string; statement?: string }>();
  const router = useRouter();
  const sourcesState = useSourcesState();
  const personsState = usePersonsState();
  const statementsState = useCreditCardStatementsState();
  const paymentsState = useStatementPaymentsState();
  const categoriesState = useCategoriesState();
  const { transactions } = useCardSettlement();
  const { status, ready, retry } = combineLiveStates([sourcesState, personsState, statementsState, paymentsState, categoriesState]);
  const [cardChoice, setCardChoice] = useState<string | null>(null);
  const [monthChoice, setMonthChoice] = useState<MonthKey | null>(null);

  const title = <Stack.Screen options={{ title: tr.cardStatement.title }} />;
  if (!ready) return <DataGateScreen status={status} retry={retry}>{title}</DataGateScreen>;

  // Only the owner's own cards: a watched card's charges never reach this
  // balance, so there is nothing a payment of them could change.
  const selfIds = new Set(personsState.data.filter((person) => person.isSelf).map((person) => person.id));
  const cards = sourcesState.data.filter((source) => source.type === "credit_card" && selfIds.has(source.personId));
  const seeded = statementsState.data.find((statement) => statement.id === params.statement);
  const card = pickCard(cards, cardChoice, seeded?.paymentSourceId ?? params.card);
  const statements = statementsState.data
    .filter((statement) => statement.paymentSourceId === card?.id)
    .sort((a, b) => a.periodMonth.localeCompare(b.periodMonth));
  const month = openingMonth(statements, params.statement, cardChoice != null, monthChoice, todayISO());
  const statement = statements.find((candidate) => candidate.periodMonth === month) ?? null;
  const categoryNames = new Map(categoriesState.data.map((category) => [category.id, category.name]));

  return (
    <Screen width="form">
      {title}
      <DataStateNotice status={status} retry={retry} />
      {!card ? (
        <EmptyState
          icon={CreditCard}
          title={tr.cardStatement.noCards}
          hint={tr.cardStatement.noCardsHint}
          action={<Button label={tr.settings.sources} onPress={() => router.push("/payment-sources")} />}
        />
      ) : (
        <>
          {cards.length > 1 || statements.length > 1 ? (
            <Card>
              {cards.length > 1 ? (
                <Select
                  label={tr.cardStatement.card}
                  options={cards.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
                  value={card.id}
                  onChange={(value) => {
                    setCardChoice(value);
                    setMonthChoice(null);
                  }}
                />
              ) : null}
              {month && statements.length > 1 ? (
                <MonthStepper value={month} onChange={setMonthChoice} min={statements[0]!.periodMonth} max={statements.at(-1)!.periodMonth} />
              ) : null}
            </Card>
          ) : null}
          {statement ? (
            <StatementDetail
              key={statement.id}
              statement={statement}
              cardName={card.name}
              charges={transactions
                .filter((tx) => tx.cardStatementId === statement.id && tx.personIsSelf && financialFlow(tx).type === "expense")
                .sort((a, b) => (b.purchaseDate ?? b.effectiveDate).localeCompare(a.purchaseDate ?? a.effectiveDate))}
              payments={paymentsState.data
                .filter((payment) => payment.statementId === statement.id)
                .sort((a, b) => a.paidOn.localeCompare(b.paidOn))}
              categoryName={(id) => (id ? categoryNames.get(id) : undefined) ?? tr.common.none}
            />
          ) : (
            <EmptyState icon={ReceiptText} title={tr.cardStatement.noStatements} hint={tr.cardStatement.noStatementsHint} />
          )}
        </>
      )}
    </Screen>
  );
}
