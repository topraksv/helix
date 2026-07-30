/**
 * Month detail: per-column breakdown; expand a column to see and manage its
 * transactions + cell note. The whole screen is one flattened FlatList so an
 * expanded category with 1.000+ rows mounts lazily instead of all at once;
 * collapsed groups cost one header row each.
 */

import React, { useEffect, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ArrowRight, ChevronDown, ChevronUp, Inbox } from "lucide-react-native";
import { deleteTransaction, restoreTransaction, saveCellNote } from "../../../data/repo";
import { monthFlowTotals } from "../../../domain/balance";
import { firstDayOf, isMonthKey, lastDayOf, monthKeyOf, todayISO, yearOf } from "../../../domain/dates";
import {
  useCategoriesState,
  useCellNotesState,
  useLedgerState,
  usePersonsState,
  usePlansState,
  useTransactionsBetweenState,
  useUserId,
} from "../../../data/hooks";
import { combineLiveQueryStatus } from "../../../data/live-state";
import { installmentDisplayTitle } from "../../../domain/installments";
import { formatMinor } from "../../../domain/money";
import { signedBalanceEffectOf } from "../../../domain/transactions";
import { transactionDateText } from "../../../ui/transaction-date";
import { categoryIcon } from "../../../data/category-icons";
import { monthLabel, tr } from "../../../i18n/tr";
import { Amount, Body, Button, Card, DataStateNotice, EmptyState, Field, Heading, Row, Screen, Spread } from "../../../ui/components";
import { TransactionRow } from "../../../ui/transaction-row";
import { useUndo } from "../../../ui/undo";
import { selectionTapIfChanged } from "../../../ui/haptics";
import { radius, spacing, useTheme } from "../../../ui/theme";
import { navigateBack } from "../../../ui/navigation";
import { useDirtyExitGuard } from "../../../ui/dirty-exit";
import { appAlert } from "../../../ui/dialog";

type Categories = ReturnType<typeof useCategoriesState>["data"];
type MonthTransactions = ReturnType<typeof useTransactionsBetweenState>["data"];

type MonthListItem =
  | { kind: "summary" }
  | { kind: "empty" }
  | { kind: "group-header"; categoryId: string; category: Categories[number] | undefined; txs: MonthTransactions; open: boolean }
  | { kind: "tx"; categoryId: string; category: Categories[number] | undefined; tx: MonthTransactions[number]; last: boolean }
  | { kind: "group-footer"; categoryId: string; category: Categories[number] | undefined };

function MonthFlowSummary({
  flows,
}: {
  flows: ReturnType<typeof monthFlowTotals>;
}) {
  const { palette } = useTheme();
  const deltas = [
    {
      key: "income",
      label: tr.cashflow.income,
      minor: flows.incomeMinor,
      color: palette.positiveText,
      backgroundColor: palette.positive + "14",
    },
    {
      key: "expense",
      label: tr.cashflow.expense,
      minor: -flows.expenseMinor,
      color: palette.negativeText,
      backgroundColor: palette.negative + "14",
    },
    ...(flows.transferMinor !== 0
      ? [{
          key: "transfer",
          label: tr.cashflow.transfer,
          minor: -flows.transferMinor,
          color: palette.text,
          backgroundColor: palette.surfaceAlt,
        }]
      : []),
    ...(flows.adjustmentMinor !== 0
      ? [{
          key: "adjustment",
          label: tr.cashflow.adjustment,
          minor: flows.adjustmentMinor,
          color: flows.adjustmentMinor < 0 ? palette.negativeText : palette.positiveText,
          backgroundColor: palette.surfaceAlt,
        }]
      : []),
  ];
  return (
    <Card>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={[
          `${tr.cashflow.opening}: ${formatMinor(flows.openingMinor)}`,
          ...deltas.map((delta) => `${delta.label}: ${formatMinor(delta.minor)}`),
          `${tr.cashflow.closing}: ${formatMinor(flows.closingMinor)}`,
        ].join(". ")}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Body muted style={{ fontSize: 11, marginBottom: spacing.xs }}>{tr.cashflow.opening}</Body>
            <Amount minor={flows.openingMinor} colorized={false} style={{ textAlign: "left" }} />
          </View>
          <View style={{ width: 52, alignItems: "center" }}>
            <View style={{ position: "absolute", left: 0, right: 0, top: 8, height: 1, backgroundColor: palette.border }} />
            <ArrowRight accessible={false} size={17} color={palette.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0, alignItems: "flex-end" }}>
            <Body muted style={{ fontSize: 11, marginBottom: spacing.xs, textAlign: "right" }}>{tr.cashflow.closing}</Body>
            <Amount minor={flows.closingMinor} large style={{ textAlign: "right" }} />
          </View>
        </View>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: spacing.sm,
            marginTop: spacing.lg,
          }}
        >
          {deltas.map((delta) => (
            <View
              key={delta.key}
              style={{
                flexBasis: "42%",
                flexGrow: 1,
                minWidth: 120,
                borderRadius: radius.md,
                backgroundColor: delta.backgroundColor,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
              }}
            >
              <Body muted style={{ fontSize: 10, marginBottom: 2 }}>{delta.label}</Body>
              <Amount minor={delta.minor} colorized={false} color={delta.color} style={{ fontSize: 13, textAlign: "left" }} />
            </View>
          ))}
        </View>
      </View>
    </Card>
  );
}

export default function MonthDetailScreen() {
  /**
   * An undo that fails must say so — the snackbar dismisses on tap either way,
   * so a swallowed rejection left the row deleted with no message.
   */
  const { month } = useLocalSearchParams<{ month: string }>();
  const router = useRouter();
  const userId = useUserId();
  const categoriesState = useCategoriesState();
  const personsState = usePersonsState();
  const plansState = usePlansState();
  const categories = categoriesState.data;
  const persons = personsState.data;
  const plans = plansState.data;
  // A dynamic segment carries whatever the URL says, so `/cash-flow/garbage`
  // reaches this screen and `lastDayOf` throws while the queries below are
  // being built — a white screen with no chance to handle it. Query a real
  // month, then leave for the parent list.
  const validMonth = isMonthKey(month) ? month : null;
  const rangeMonth = validMonth ?? monthKeyOf(todayISO());
  const transactionsState = useTransactionsBetweenState(firstDayOf(rangeMonth), lastDayOf(rangeMonth));
  const ledgerState = useLedgerState(yearOf(rangeMonth));
  const transactions = transactionsState.data;
  const bundle = ledgerState.data;
  const [expanded, setExpanded] = useState<string | null>(null);
  // Note drafts live on the screen, keyed by category: the footer editor is a
  // virtualized row, so its own state would be discarded the moment it scrolls
  // out of the render window mid-typing.
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const { palette } = useTheme();
  const undo = useUndo();
  useEffect(() => {
    if (!validMonth) navigateBack(router, "/(tabs)/cash-flow");
  }, [validMonth, router]);

  const ledgerMonth = bundle?.ledger.find((m) => m.month === rangeMonth);
  const personName = new Map(persons.map((p) => [p.id, p.name]));
  const selfIds = new Set(persons.filter((p) => p.isSelf).map((p) => p.id));
  const planTitle = new Map(plans.map((plan) => [plan.id, plan.title]));

  const byCategory = new Map<string, typeof transactions>();
  for (const transaction of transactions) {
    const key = transaction.categoryId ?? "uncategorized";
    const list = byCategory.get(key);
    if (list) list.push(transaction);
    else byCategory.set(key, [transaction]);
  }

  const cellNotesState = useCellNotesState();
  const cellNotes = cellNotesState.data.filter((note) => note.month === rangeMonth);
  const noteDirty = Object.entries(noteDrafts).some(
    ([categoryId, body]) => body !== (cellNotes.find((note) => note.categoryId === categoryId)?.body ?? ""),
  );
  useDirtyExitGuard(noteDirty);
  const liveStates = [categoriesState, personsState, plansState, transactionsState, ledgerState, cellNotesState];
  const dataStatus = combineLiveQueryStatus(liveStates);
  const dataReady = liveStates.every((state) => state.updatedAt != null);
  const retryData = () => {
    categoriesState.retry();
    personsState.retry();
    plansState.retry();
    transactionsState.retry();
    ledgerState.retry();
    cellNotesState.retry();
  };

  const removeTx = async (id: string) => {
    try {
      const snapshot = await deleteTransaction(userId, id);
      if (snapshot) {
        undo.show(tr.tx.deletedUndo, () => restoreTransaction(userId, snapshot), "warning");
      }
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
  };

  const items: MonthListItem[] = [
    { kind: "summary" },
    ...(transactions.length === 0 ? [{ kind: "empty" } as const] : []),
    ...[...byCategory.entries()].flatMap<MonthListItem>(([categoryId, txs]) => {
      const category = categories.find((c) => c.id === categoryId);
      const open = expanded === categoryId;
      return [
        { kind: "group-header", categoryId, category, txs, open },
        ...(open ? txs.map((tx, index) => ({ kind: "tx" as const, categoryId, category, tx, last: index === txs.length - 1 })) : []),
        ...(open ? [{ kind: "group-footer" as const, categoryId, category }] : []),
      ];
    }),
  ];

  // Card look, split across virtualized rows: the header owns the top radii,
  // the footer (or a closed header) owns the bottom radii + group margin.
  const groupSurface = { backgroundColor: palette.surface, paddingHorizontal: spacing.lg };
  const groupTop = { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg };
  const groupBottom = { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, marginBottom: spacing.md };

  const renderItem = ({ item }: { item: MonthListItem }) => {
    switch (item.kind) {
      case "summary": {
        if (!ledgerMonth) return null;
        // The rows below this card list the month's real and planned entries,
        // so the card is built from the same set — a future month showed a
        // carried balance above three zeros while its own list had entries.
        const flows = monthFlowTotals(ledgerMonth);
        return <MonthFlowSummary flows={flows} />;
      }
      case "empty":
        return <EmptyState icon={Inbox} title={tr.cashflow.emptyMonth} />;
      case "group-header": {
        const { categoryId, category, txs, open } = item;
        const title = category?.name ?? tr.common.none;
        const selfSum = txs.filter((t) => selfIds.has(t.personId)).reduce(
          (sum, t) => sum + signedBalanceEffectOf(t.type, t.amountTryMinor, category?.kind ?? null),
          0,
        );
        const note = cellNotes.find((n) => n.categoryId === categoryId);
        return (
          <View style={[groupSurface, groupTop, { paddingTop: spacing.lg, paddingBottom: open ? spacing.sm : spacing.lg }, open ? null : groupBottom]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={tr.a11y.categorySummary(title, formatMinor(selfSum), Boolean(note))}
              onPress={() => {
                selectionTapIfChanged(expanded, open ? "" : categoryId);
                setExpanded(open ? null : categoryId);
              }}
            >
              <Spread style={{ alignItems: "flex-start" }}>
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Heading style={{ marginVertical: 0 }}>
                    {category ? `${categoryIcon(category)} ` : ""}
                    {title}
                  </Heading>
                  {/* The note itself is the indicator. A badge saying "Not"
                      read like a category of its own, and a floating pill
                      never lined up with the serif heading beside it. Quoting
                      the user's own words needs no label to be understood,
                      and it stacks under the title so both share one edge. */}
                  {note ? (
                    <View
                      style={{
                        marginTop: spacing.xs,
                        paddingLeft: spacing.sm,
                        borderLeftWidth: 2,
                        borderLeftColor: palette.border,
                      }}
                    >
                      <Body muted style={{ fontSize: 12 }}>{note.body}</Body>
                    </View>
                  ) : null}
                </View>
                <Row gap={spacing.sm}>
                  <Amount minor={selfSum} />
                  {open ? <ChevronUp accessible={false} size={16} color={palette.textSecondary} /> : <ChevronDown accessible={false} size={16} color={palette.textSecondary} />}
                </Row>
              </Spread>
            </Pressable>
          </View>
        );
      }
      case "tx": {
        const { category, tx: t, last } = item;
        const installmentTitle = t.installmentPlanId
          ? installmentDisplayTitle(planTitle.get(t.installmentPlanId), t.note, tr.installments.plan)
          : null;
        return (
          <View style={groupSurface}>
            <TransactionRow
              installmentTitle={installmentTitle}
              dateText={
                transactionDateText(t) +
                (t.installmentNo ? `  ·  ${tr.installments.nthInstallment(t.installmentNo)}` : "") +
                (t.isAggregate ? `  ·  ${tr.bulk.aggregateBadge}` : "") +
                (!selfIds.has(t.personId) ? `  ·  ${personName.get(t.personId) ?? ""}` : "")
              }
              note={t.note}
              pending={t.status === "pending"}
              reversalBadge={
                t.amountTryMinor < 0
                  ? { text: tr.tx.reversalLabel(t.type), tone: t.type === "income" ? "negative" : "positive" }
                  : null
              }
              amountMinor={signedBalanceEffectOf(t.type, t.amountTryMinor, category?.kind ?? null)}
              onEdit={() => router.push({ pathname: "/transaction", params: { id: t.id } })}
              onDelete={() => void removeTx(t.id)}
              divider={!last}
            />
          </View>
        );
      }
      case "group-footer": {
        const existing = cellNotes.find((n) => n.categoryId === item.categoryId);
        return (
          <View style={[groupSurface, groupBottom, { paddingBottom: spacing.lg }]}>
            {item.category ? (
              <CellNoteEditor
                userId={userId}
                month={rangeMonth}
                categoryId={item.category.id}
                existing={existing}
                draft={noteDrafts[item.categoryId]}
                onDraftChange={(text) =>
                  setNoteDrafts((drafts) => ({ ...drafts, [item.categoryId]: text }))
                }
                onSaved={() =>
                  setNoteDrafts(({ [item.categoryId]: _saved, ...rest }) => rest)
                }
              />
            ) : null}
          </View>
        );
      }
    }
  };

  if (!dataReady) {
    return (
      <Screen>
        <Stack.Screen options={{ title: monthLabel(rangeMonth) }} />
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} maxWidth={900}>
      <Stack.Screen options={{ title: monthLabel(rangeMonth) }} />
      <FlatList
        data={items}
        ListHeaderComponent={(
          <View>
            <DataStateNotice status={dataStatus} retry={retryData} />
          </View>
        )}
        keyExtractor={(item) =>
          item.kind === "summary" || item.kind === "empty"
            ? item.kind
            : item.kind === "tx"
              ? `tx:${item.tx.id}`
              : `${item.kind}:${item.categoryId}`
        }
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustContentInsets={false}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

/** Controlled by the screen: the draft must survive this row being
 *  virtualized out of the window (and the group collapsing). */
function CellNoteEditor({
  userId,
  month,
  categoryId,
  existing,
  draft,
  onDraftChange,
  onSaved,
}: {
  userId: string;
  month: string;
  categoryId: string;
  existing?: { id: string; body: string };
  draft: string | undefined;
  onDraftChange: (text: string) => void;
  onSaved: () => void;
}) {
  const text = draft ?? existing?.body ?? "";
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveCellNote(userId, month, categoryId, text, existing);
      onSaved();
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    } finally {
      setSaving(false);
    }
  };
  return (
    <View style={{ marginTop: spacing.sm }}>
      <Field label={tr.cashflow.cellNote} value={text} onChangeText={onDraftChange} multiline placeholder={tr.cell.notePlaceholder} />
      <Button label={tr.common.save} variant="secondary" size="sm" onPress={() => void save()} disabled={saving || text === (existing?.body ?? "")} loading={saving} />
    </View>
  );
}
