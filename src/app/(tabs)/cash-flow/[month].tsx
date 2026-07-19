/**
 * Month detail: per-column breakdown; expand a column to see and manage its
 * transactions + cell note. The whole screen is one flattened FlatList so an
 * expanded category with 1.000+ rows mounts lazily instead of all at once;
 * collapsed groups cost one header row each.
 */

import React, { useEffect, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { and, eq, isNull } from "drizzle-orm";
import { ChevronDown, ChevronUp, Inbox, StickyNote } from "lucide-react-native";
import { getDb } from "../../../db/client";
import * as s from "../../../db/schema";
import { restoreRow } from "../../../db/mutations";
import { deleteTransaction } from "../../../data/repo";
import { saveCellNote } from "../../../data/cell-notes";
import { firstDayOf, isMonthKey, lastDayOf, monthKeyOf, todayISO, yearOf } from "../../../domain/dates";
import { useCategories, useLedger, useLive, usePersons, usePlans, useTransactionsBetween, useUserId } from "../../../data/hooks";
import { installmentDisplayTitle } from "../../../domain/installments";
import { formatMinor } from "../../../domain/money";
import { signedBalanceEffectOf } from "../../../domain/transactions";
import { transactionDateText } from "../../../ui/transaction-date";
import { categoryIcon } from "../../../data/category-icons";
import { monthLabel, tr } from "../../../i18n/tr";
import { Amount, Body, Button, Card, Divider, EmptyState, Field, Heading, Row, Screen, Spread } from "../../../ui/components";
import { TransactionRow } from "../../../ui/transaction-row";
import { useUndo } from "../../../ui/undo";
import { selectionTapIfChanged } from "../../../ui/haptics";
import { radius, spacing, useTheme } from "../../../ui/theme";
import { navigateBack } from "../../../ui/navigation";

type Categories = ReturnType<typeof useCategories>;
type MonthTransactions = ReturnType<typeof useTransactionsBetween>;

type MonthListItem =
  | { kind: "summary" }
  | { kind: "empty" }
  | { kind: "group-header"; categoryId: string; category: Categories[number] | undefined; txs: MonthTransactions; open: boolean }
  | { kind: "tx"; categoryId: string; category: Categories[number] | undefined; tx: MonthTransactions[number]; last: boolean }
  | { kind: "group-footer"; categoryId: string; category: Categories[number] | undefined };

export default function MonthDetailScreen() {
  const { month } = useLocalSearchParams<{ month: string }>();
  const router = useRouter();
  const userId = useUserId();
  const categories = useCategories();
  const persons = usePersons();
  const plans = usePlans();
  // A dynamic segment carries whatever the URL says, so `/cash-flow/garbage`
  // reaches this screen and `lastDayOf` throws while the queries below are
  // being built — a white screen with no chance to handle it. Query a real
  // month, then leave for the parent list.
  const validMonth = isMonthKey(month) ? month : null;
  const rangeMonth = validMonth ?? monthKeyOf(todayISO());
  const transactions = useTransactionsBetween(firstDayOf(rangeMonth), lastDayOf(rangeMonth));
  const bundle = useLedger(yearOf(rangeMonth));
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

  const cellNotes = useLive(
    getDb()
      .select()
      .from(s.cellNotes)
      .where(and(eq(s.cellNotes.userId, userId), eq(s.cellNotes.month, rangeMonth), isNull(s.cellNotes.deletedAt))),
    [userId, rangeMonth],
    ["cell_notes"],
  ).data;

  const removeTx = async (id: string) => {
    const snapshot = await deleteTransaction(userId, id);
    if (snapshot) {
      undo.show(tr.tx.deletedUndo, () => void restoreRow(userId, "transactions", snapshot), "warning");
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
      case "summary":
        return ledgerMonth ? (
          <Card>
            <Spread>
              <Body muted>{tr.cashflow.opening}</Body>
              <Amount minor={ledgerMonth.openingMinor} />
            </Spread>
            <Spread style={{ marginTop: spacing.xs }}>
              <Body muted>{tr.cashflow.income}</Body>
              <Amount minor={ledgerMonth.incomeMinor} colorized={false} color={palette.positiveText} />
            </Spread>
            <Spread style={{ marginTop: spacing.xs }}>
              <Body muted>{tr.cashflow.expense}</Body>
              <Amount minor={-ledgerMonth.expenseMinor} />
            </Spread>
            {ledgerMonth.transferMinor !== 0 ? (
              <Spread style={{ marginTop: spacing.xs }}>
                <Body muted style={{ flex: 1, paddingRight: spacing.sm }}>{tr.cashflow.transfer}</Body>
                <Amount minor={-ledgerMonth.transferMinor} />
              </Spread>
            ) : null}
            {ledgerMonth.adjustmentMinor !== 0 ? (
              <Spread style={{ marginTop: spacing.xs }}>
                <Body muted style={{ flex: 1, paddingRight: spacing.sm }}>{tr.cashflow.adjustment}</Body>
                <Amount minor={ledgerMonth.adjustmentMinor} />
              </Spread>
            ) : null}
            <Divider />
            <Spread>
              <Heading style={{ marginVertical: 0 }}>{tr.cashflow.closing}</Heading>
              <Amount minor={ledgerMonth.closingMinor} large />
            </Spread>
          </Card>
        ) : null;
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
              <Spread>
                <Row gap={spacing.sm} style={{ flex: 1, paddingRight: spacing.md }}>
                  <Heading style={{ marginVertical: 0, flexShrink: 1 }}>
                    {category ? `${categoryIcon(category)} ` : ""}
                    {title}
                  </Heading>
                  {note ? <StickyNote accessible={false} size={14} color={palette.textSecondary} /> : null}
                </Row>
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

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ title: monthLabel(rangeMonth) }} />
      <FlatList
        data={items}
        keyExtractor={(item) =>
          item.kind === "summary" || item.kind === "empty"
            ? item.kind
            : item.kind === "tx"
              ? `tx:${item.tx.id}`
              : `${item.kind}:${item.categoryId}`
        }
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
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
  const save = async () => {
    await saveCellNote(userId, month, categoryId, text, existing);
    onSaved();
  };
  return (
    <View style={{ marginTop: spacing.sm }}>
      <Field label={tr.cashflow.cellNote} value={text} onChangeText={onDraftChange} multiline placeholder={tr.cell.notePlaceholder} />
      <Button label={tr.common.save} variant="secondary" size="sm" onPress={() => void save()} disabled={text === (existing?.body ?? "")} />
    </View>
  );
}
