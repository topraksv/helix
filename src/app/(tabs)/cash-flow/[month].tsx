/**
 * Month detail: per-column breakdown; expand a column to see and manage its
 * transactions + cell note. The whole screen is one flattened FlatList so an
 * expanded category with 1.000+ rows mounts lazily instead of all at once;
 * collapsed groups cost one header row each.
 */

import React, { useEffect, useState } from "react";
import { Animated, FlatList, Pressable, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Inbox from "lucide-react-native/icons/inbox";
import Minus from "lucide-react-native/icons/minus";
import TrendingDown from "lucide-react-native/icons/trending-down";
import TrendingUp from "lucide-react-native/icons/trending-up";
import { deleteTransaction, restoreTransaction, saveCellNote } from "../../../data/repo";
import { monthFlowTotals } from "../../../domain/balance";
import { firstDayOf, isMonthKey, lastDayOf, monthKeyOf, todayISO, yearOf } from "../../../domain/dates";
import {
  useAttachmentsState,
  useCategoriesState,
  useCellNotesState,
  useLedgerState,
  usePersonsState,
  usePlansState,
  useTransactionsBetweenState,
  useUserId,
} from "../../../data/hooks";
import { combineLiveStates } from "../../../data/live-state";
import { installmentDisplayTitle } from "../../../domain/installments";
import { formatMinorCompact } from "../../../domain/money";
import { signedBalanceEffectOf } from "../../../domain/transactions";
import { transactionDateText } from "../../../ui/transaction-date";
import { categoryIcon } from "../../../domain/category-icons";
import { monthLabel, tr } from "../../../i18n/tr";
import { Amount, Body, Button, Card, DataStateNotice, DisclosureChevron, EmptyState, Field, Heading, Row, Screen, Spread } from "../../../ui/components";
import { useDrawIn } from "../../../ui/motion-primitives";
import { TransactionRow } from "../../../ui/transaction-row";
import { useUndo } from "../../../ui/undo";
import { selectionTapIfChanged } from "../../../ui/haptics";
import { interactionSurface } from "../../../ui/interaction";
import { controlSize, motion, radius, spacing, type, useTheme } from "../../../ui/theme";
import { navigateBack } from "../../../ui/navigation";
import { useDirtyExitGuard } from "../../../ui/dirty-exit";
import { appAlert } from "../../../ui/dialog";
import { renderKeyboardSafeListScroll } from "../../../ui/keyboard-safe";

type Categories = ReturnType<typeof useCategoriesState>["data"];
type MonthTransactions = ReturnType<typeof useTransactionsBetweenState>["data"];

type MonthListItem =
  | { kind: "summary" }
  | { kind: "empty" }
  | { kind: "group-header"; categoryId: string; category: Categories[number] | undefined; txs: MonthTransactions; open: boolean }
  | { kind: "tx"; categoryId: string; category: Categories[number] | undefined; tx: MonthTransactions[number]; last: boolean }
  | { kind: "group-footer"; categoryId: string; category: Categories[number] | undefined };

/**
 * A balance-change marker: the trend is the meaning, not a decorative rule
 * between two figures. It enters in the same direction as the month's net
 * change, so the motion reinforces what the icon already says.
 */
function BalanceBridge({ token, deltaMinor }: { token: string; deltaMinor: number }) {
  const { palette } = useTheme();
  const draw = useDrawIn(true, motion.draw, token);
  const DirectionIcon = deltaMinor > 0 ? TrendingUp : deltaMinor < 0 ? TrendingDown : Minus;
  const directionColor = deltaMinor > 0
    ? palette.positiveText
    : deltaMinor < 0
      ? palette.negativeText
      : palette.textSecondary;
  const opacity = draw.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] });
  const scale = draw.interpolate({ inputRange: [0, 1], outputRange: [0.84, 1] });
  const directionOffset = draw.interpolate({
    inputRange: [0, 1],
    outputRange: [deltaMinor > 0 ? 5 : deltaMinor < 0 ? -5 : 0, 0],
  });
  return (
    <View
      testID="month-balance-transition"
      accessible={false}
      style={{
        width: 64,
        height: 40,
        flexShrink: 0,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Animated.View
        accessible={false}
        style={{
          opacity,
          transform: [{ scale }],
        }}
      >
        <View
          accessible={false}
          style={{
            width: 38,
            height: 38,
            borderRadius: radius.md,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: directionColor + "18",
            borderWidth: 1,
            borderColor: directionColor + "75",
          }}
        >
          <Animated.View style={{ transform: [{ translateY: directionOffset }] }}>
            <DirectionIcon accessible={false} size={19} color={directionColor} strokeWidth={2.35} />
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
}

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
          `${tr.cashflow.opening}: ${formatMinorCompact(flows.openingMinor)}`,
          ...deltas.map((delta) => `${delta.label}: ${formatMinorCompact(delta.minor)}`),
          `${tr.cashflow.closing}: ${formatMinorCompact(flows.closingMinor)}`,
        ].join(". ")}
      >
        <View>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
            <View testID="month-opening-balance" style={{ flex: 1, minWidth: 0 }}>
              <Body muted style={{ fontSize: type.caption.fontSize, textAlign: "left" }}>{tr.cashflow.opening}</Body>
            </View>
            <View style={{ width: 64, flexShrink: 0 }} />
            <View testID="month-closing-balance" style={{ flex: 1, minWidth: 0, alignItems: "flex-end" }}>
              <Body muted style={{ fontSize: type.caption.fontSize, textAlign: "right" }}>{tr.cashflow.closing}</Body>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.xs }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Amount testID="month-opening-amount" minor={flows.openingMinor} large colorized={false} style={{ maxWidth: "100%", textAlign: "left" }} />
            </View>
            <BalanceBridge token={`${flows.openingMinor}|${flows.closingMinor}`} deltaMinor={flows.closingMinor - flows.openingMinor} />
            <View style={{ flex: 1, minWidth: 0, alignItems: "flex-end" }}>
              <Amount testID="month-closing-amount" minor={flows.closingMinor} large style={{ maxWidth: "100%", textAlign: "right" }} />
            </View>
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
              <Body muted style={{ fontSize: type.micro.fontSize, marginBottom: 2 }}>{delta.label}</Body>
              <Amount minor={delta.minor} colorized={false} color={delta.color} style={{ fontSize: type.label.fontSize, textAlign: "left" }} />
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
  const attachmentsState = useAttachmentsState();
  // Which rows in this list carry a document. One pass over the account's
  // attachments rather than a query per row: the list is virtualized and a
  // per-row lookup would run on every scroll frame.
  const documented = React.useMemo(
    () => new Set(attachmentsState.data.map((attachment) => attachment.transactionId)),
    [attachmentsState.data],
  );
  const cellNotes = cellNotesState.data.filter((note) => note.month === rangeMonth);
  const noteDirty = Object.entries(noteDrafts).some(
    ([categoryId, body]) => body !== (cellNotes.find((note) => note.categoryId === categoryId)?.body ?? ""),
  );
  useDirtyExitGuard(noteDirty);
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([categoriesState, personsState, plansState, transactionsState, ledgerState, cellNotesState]);

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
              accessibilityLabel={tr.a11y.categorySummary(title, formatMinorCompact(selfSum), Boolean(note))}
              onPress={() => {
                selectionTapIfChanged(expanded, open ? "" : categoryId);
                setExpanded(open ? null : categoryId);
              }}
              // The row expands a category and is the main way into a month, so
              // it owes the platform minimum. It measured 28pt tall — the exact
              // height of its own heading — which on a phone is a target you
              // have to aim at.
              style={(state) => ({
                minHeight: controlSize.minimumTarget,
                justifyContent: "center",
                marginHorizontal: -spacing.sm,
                paddingHorizontal: spacing.sm,
                borderRadius: radius.sm,
                ...interactionSurface(palette, state),
              })}
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
                      <Body muted style={{ fontSize: type.small.fontSize }}>{note.body}</Body>
                    </View>
                  ) : null}
                </View>
                <Row gap={spacing.sm}>
                  <Amount minor={selfSum} />
                  <DisclosureChevron open={open} size={16} />
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
              hasDocuments={documented.has(t.id)}
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
    // A month is a summary and a list of single-line category rows: a name on
    // the left and an amount on the right. Given a workspace column those two
    // ends stood 500px apart with nothing between them, which is a phone row
    // stretched, not a desktop layout. The reading measure is the honest width.
    <Screen scroll={false} width="form">
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
        renderScrollComponent={renderKeyboardSafeListScroll}
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
