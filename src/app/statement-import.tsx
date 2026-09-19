/**
 * Importing a credit-card statement PDF.
 *
 * Three properties hold the whole screen together:
 *
 * - **Local.** The bytes are read through the same bounded picker the workbook
 *   importer uses and parsed in process. Nothing is uploaded, nothing is
 *   stored: the PDF is read once and dropped.
 * - **Nothing is written until a person says so.** Extraction produces
 *   candidates; the ledger is untouched until Aktar is pressed, and then the
 *   whole accepted set is written in one atomic batch.
 * - **The safe default is the one that happens if nobody reads carefully.**
 *   Rows the ledger already has, and instalments an existing plan already
 *   produces, start unticked.
 *
 * It deliberately wears the workbook importer's shape — the same hero, the same
 * three-step journey, the same guide before a file is chosen. The two are one
 * promise about two file types, and this is the more dangerous of them.
 */

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import FileText from "lucide-react-native/icons/file-text";
import Check from "lucide-react-native/icons/check";
import ReceiptText from "lucide-react-native/icons/receipt-text";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { useAllTransactionsState, useCategoriesState, usePendingExpectedState, usePersonsState, usePlansState, useSourcesState, useSubscriptionsState, useUserId } from "../data/hooks";
import { combineLiveStates } from "../data/live-state";
import { commitStatementRows, type AcceptedStatementRow } from "../data/repo";
import type { PdfFailure } from "../services/pdf-text";
import { readPickedBytes } from "../services/picked-file";
import {
  billedMonthFromDates,
  cardFromPlans,
  defaultSelection,
  parseStatement,
  periodFromDates,
  matchStatementCategory,
  reviewCandidates,
  statementPlanSpec,
  type CandidateVerdict,
  type StatementCandidate,
  type StatementParseResult,
  type StatementPlanSpec,
  statementDifferenceMinor,
} from "../domain/statement-import";
import { isValidCardCycle, statementPeriod } from "../domain/card-statements";
import { lastDayOf, monthDiff, monthKeyOf, todayISO, type MonthKey } from "../domain/dates";
import { formatMinorCompact, formatMinorInput } from "../domain/money";
import { userMessage } from "../domain/user-error";
import { dateLabel, monthLabel, tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { devError } from "../services/logger";
import {
  Badge,
  Body,
  Button,
  Card,
  DataStateNotice,
  EmptyState,
  Field,
  MoneyField,
  PanelHeader,
  Row,
  MonthStepper,
  Screen,
  SectionHeader,
} from "../ui/components";
import { ImportArtwork, ImportJourney } from "../ui/import-journey";
import { Select } from "../ui/selection-controls";
import { interactionBleed, interactionSurface } from "../ui/interaction";
import { appConfirm, appAlert } from "../ui/dialog";
import { useUndo } from "../ui/undo";
import { useOperationGuard } from "../ui/operation-guard";
import { shouldUseWideImportGuide } from "../ui/responsive";
import { useContentWidth } from "../ui/viewport";
import { borderWidth, radius, spacing, type, useTheme } from "../ui/theme";

/** A candidate as the owner may have edited it. */
interface Draft {
  description: string;
  amountRaw: string;
  amountMinor: number;
  categoryId: string | null;
}

/**
 * The same picture the workbook importer draws, told with a statement.
 *
 * A page of printed lines on the left, the ledger on the right, and the arrow
 * between them that says which way this goes. Purely decorative: everything it
 * depicts is also said in words beside it.
 */
function StatementArtwork({ ready }: { ready: boolean }) {
  const { palette } = useTheme();
  return (
    <ImportArtwork ready={ready} destinationIcon={ReceiptText}>
      <View style={{ width: 30, height: 5, borderRadius: 3, backgroundColor: palette.primary, marginBottom: 7 }} />
      {[46, 60, 38, 54, 44].map((width, row) => (
        <View key={row} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 5 }}>
          <View style={{ width: 12, height: 4, borderRadius: 2, backgroundColor: palette.border + "90" }} />
          <View style={{ width: width * 0.6, height: 4, borderRadius: 2, backgroundColor: palette.border + "60" }} />
        </View>
      ))}
    </ImportArtwork>
  );
}

/** What this reads, and what it refuses — before a file is chosen, not after. */
function StatementGuide({ wide }: { wide: boolean }) {
  const { palette } = useTheme();
  const bullet = (line: string) => (
    <View key={line} style={{ flexDirection: "row", marginBottom: spacing.xs }}>
      <Text style={[type.small, { color: palette.primaryText, marginRight: spacing.xs }]}>•</Text>
      <Text style={[type.small, { color: palette.textSecondary, flex: 1 }]}>{line}</Text>
    </View>
  );
  return (
    <Card>
      <SectionHeader>{tr.statement.guideTitle}</SectionHeader>
      <Body muted style={{ marginBottom: spacing.lg }}>{tr.statement.guideLead}</Body>
      <View style={{ flexDirection: wide ? "row" : "column", gap: spacing.xl }}>
        <View style={{ flex: wide ? 1 : undefined }}>
          <Text style={[type.label, { color: palette.text, marginBottom: spacing.sm }]}>{tr.statement.guideReadsTitle}</Text>
          {[tr.statement.guideReads1, tr.statement.guideReads2, tr.statement.guideReads3].map(bullet)}
        </View>
        <View style={{ flex: wide ? 1 : undefined }}>
          <Text style={[type.label, { color: palette.text, marginBottom: spacing.sm }]}>{tr.statement.guideRefusesTitle}</Text>
          {[tr.statement.guideRefuses1, tr.statement.guideRefuses2, tr.statement.guideRefuses3].map(bullet)}
        </View>
      </View>
    </Card>
  );
}

/** Whether a line still says what it is and what it cost; neither can be written without. */
const draftComplete = (draft: Draft | undefined): draft is Draft => draft != null && draft.description.trim() !== "" && draft.amountMinor > 0;

const without = (set: ReadonlySet<string>, key: string) => {
  const next = new Set(set);
  next.delete(key);
  return next;
};

/** What the ledger already holds a line as, said on the line. */
function verdictLabel(verdict: CandidateVerdict | undefined): string {
  switch (verdict?.state) {
    case "imported": return tr.statement.verdicts.imported;
    case "plan": return tr.statement.verdicts.plan(verdict.planTitle, verdict.differenceMinor === 0 ? null : formatMinorCompact(Math.abs(verdict.differenceMinor)));
    case "similar": return tr.statement.verdicts.similar;
    case "expected": return tr.statement.verdicts.expected(verdict.title);
    default: return "";
  }
}

/** The badges above a line: its instalment, a refund, and what the ledger already holds it as. */
function CandidateMarks({ candidate, verdictText }: { candidate: StatementCandidate; verdictText: string }) {
  if (candidate.kind !== "installment" && !candidate.isRefund && !verdictText) return null;
  return (
    <Row gap={spacing.sm} style={{ flexWrap: "wrap", marginBottom: spacing.xs }}>
      {candidate.installmentNo && candidate.installmentCount ? (
        <Badge text={tr.statement.installmentOf(candidate.installmentNo, candidate.installmentCount)} tone="primary" />
      ) : null}
      {candidate.isRefund ? <Badge text={tr.statement.refund} tone="positive" /> : null}
      {verdictText ? <Badge text={verdictText} tone="warning" /> : null}
    </Row>
  );
}

function CandidateEditor({ draft, categories, onChange, onDone }: {
  draft: Draft;
  categories: { id: string; name: string }[];
  onChange: (next: Partial<Draft>) => void;
  onDone: () => void;
}) {
  return (
    <View style={{ marginTop: spacing.md }}>
      <Field label={tr.statement.descriptionLabel} value={draft.description} onChangeText={(description) => onChange({ description })} />
      <MoneyField label={tr.tx.amount} value={draft.amountRaw} onChangeMinor={(amountRaw, amountMinor) => onChange({ amountRaw, amountMinor: amountMinor ?? 0 })} />
      <Select
        label={tr.statement.category}
        value={draft.categoryId ?? ""}
        options={[{ value: "", label: tr.statement.noCategory }, ...categories.map((category) => ({ value: category.id, label: category.name }))]}
        onChange={(categoryId) => onChange({ categoryId: categoryId === "" ? null : categoryId })}
      />
      <Row gap={spacing.sm}>
        <Button size="sm" label={tr.common.done} onPress={onDone} disabled={!draftComplete(draft)} />
      </Row>
    </View>
  );
}

/**
 * One read line, and whether it is coming in.
 *
 * The tick is a real checkbox, not a button whose colour you have to learn.
 * Pressing anywhere on the line toggles it; the row's own controls sit BELOW
 * that pressable rather than inside it, because a button inside a button is
 * `nested-interactive` and unreachable for assistive technology.
 */
function CandidateRow({
  candidate,
  draft,
  planSpec,
  verdictText,
  selected,
  editing,
  categories,
  onToggle,
  onEdit,
  onCancelEdit,
  onChange,
  onRemove,
}: {
  candidate: StatementCandidate;
  draft: Draft;
  /** The plan this line will open, when it opens one. Said, never assumed. */
  planSpec: StatementPlanSpec | null;
  verdictText: string;
  selected: boolean;
  editing: boolean;
  categories: { id: string; name: string }[];
  onToggle: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onChange: (next: Partial<Draft>) => void;
  onRemove: () => void;
}) {
  const { palette } = useTheme();
  const amountText = formatMinorCompact(draft.amountMinor);
  return (
    <Card testID={`statement-row-${candidate.importKey}`}>
      <Pressable
        testID={`statement-toggle-${candidate.importKey}`}
        accessibilityRole="checkbox"
        aria-checked={selected}
        accessibilityState={{ checked: selected }}
        accessibilityLabel={tr.statement.a11yRow(draft.description, amountText, dateLabel(candidate.date), verdictText)}
        onPress={onToggle}
        style={(state) => ({
          flexDirection: "row",
          alignItems: "flex-start",
          gap: spacing.md,
          // The pressable owns its padding and bleeds to the card's edge, so
          // the lit area is the row rather than a band floating inside it.
          ...interactionBleed(),
          paddingVertical: spacing.sm,
          borderRadius: radius.sm,
          ...interactionSurface(palette, state),
        })}
      >
        <View
          accessible={false}
          style={{
            width: 22,
            height: 22,
            marginTop: 2,
            borderRadius: radius.sm,
            borderWidth: borderWidth.selected,
            borderColor: selected ? palette.primary : palette.controlBorder,
            backgroundColor: selected ? palette.primary : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {selected ? <Check accessible={false} size={14} color={palette.onPrimary} strokeWidth={3} /> : null}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          {/* Marks first, then the merchant, then the figure: sharing a row with
              the accept button put a wrapped badge and a 48pt control on two baselines. */}
          <CandidateMarks candidate={candidate} verdictText={verdictText} />
          <Body>{draft.description}</Body>
          <Body muted style={{ marginTop: 2 }}>
            {dateLabel(candidate.date)} · {amountText}
          </Body>
        </View>
      </Pressable>

      {editing ? (
        <CandidateEditor draft={draft} categories={categories} onChange={onChange} onDone={onCancelEdit} />
      ) : (
        <Row gap={spacing.sm} style={{ marginTop: spacing.md, flexWrap: "wrap" }}>
          <Button size="sm" variant="secondary" label={tr.common.edit} onPress={onEdit} />
          <Button size="sm" variant="ghost" label={tr.common.delete} onPress={onRemove} />
        </Row>
      )}
      {/* Said, not blocked. A line this cannot place is written without a
          column and shows up under Kalemsiz in the Mali Tablo, which is a
          thing the owner can find and fix in one place — unlike a hundred
          lines quietly filed under whichever column sorted first. */}
      {selected && !editing && !draft.categoryId ? (
        <Body muted style={{ marginTop: spacing.sm }}>{tr.statement.uncategorizedRow}</Body>
      ) : null}
      {selected && planSpec ? (
        <Body muted style={{ marginTop: spacing.sm }}>
          {tr.statement.planWillCreate(planSpec.installmentCount, monthLabel(planSpec.startMonth))}
        </Body>
      ) : null}
    </Card>
  );
}

/** What the ledger already holds that a statement line may be. */
function useStatementLedger() {
  const categoriesState = useCategoriesState();
  const personsState = usePersonsState();
  const transactionsState = useAllTransactionsState();
  const plansState = usePlansState();
  const sourcesState = useSourcesState();
  const expectedState = usePendingExpectedState();
  const subscriptionsState = useSubscriptionsState();
  const live = combineLiveStates([categoriesState, personsState, transactionsState, plansState, sourcesState, expectedState, subscriptionsState]);
  const subscriptions = new Map(subscriptionsState.data.map((subscription) => [subscription.id, subscription]));
  const expected = expectedState.data.flatMap((payment) => {
    const subscription = subscriptions.get(payment.refId);
    return payment.kind === "subscription" && (payment.status === "pending" || payment.status === "late") && subscription
      ? [{ id: payment.id, title: subscription.name, dueDate: payment.dueDate, amountMinor: payment.amountMinor, paymentSourceId: subscription.paymentSourceId }]
      : [];
  });
  const liraByInstalment = new Map(transactionsState.data.map((row) => [`${row.installmentPlanId}:${row.installmentNo}`, row.amountTryMinor]));
  // A foreign plan is known by what it bills in the statement's own month, so plans are read for the month under review.
  const plansFor = (period: MonthKey) => plansState.data.map((plan) => ({
    ...plan,
    billedTryMinor: liraByInstalment.get(`${plan.id}:${monthDiff(plan.startMonth, period) + 1}`) ?? null,
  }));
  const cards = sourcesState.data.filter((source) => source.type === "credit_card");
  const cardIds = new Set(cards.map((source) => source.id));
  return {
    ...live,
    cards,
    expenseCategories: categoriesState.data.filter((category) => category.kind === "expense"),
    selfPerson: personsState.data.find((person) => person.isSelf),
    review: (candidates: readonly StatementCandidate[], period: MonthKey, paymentSourceId: string | null) =>
      reviewCandidates({ candidates, existing: transactionsState.data, plans: plansFor(period), expected, period, paymentSourceId }),
    /** The card the statement's instalment lines were entered against. */
    cardOf: (candidates: readonly StatementCandidate[], period: MonthKey) =>
      cardFromPlans(candidates, plansFor(period).filter((plan) => plan.paymentSourceId != null && cardIds.has(plan.paymentSourceId)), period),
  };
}

/** The workbook importer's hero, told with a statement: the same picture, the same button, the same place on the page. */
function StatementHero({ wide, readCount, pending, picking, onPick }: { wide: boolean; readCount: number | null; pending: boolean; picking: boolean; onPick: () => void }) {
  const { palette } = useTheme();
  const read = readCount != null;
  return (
    <Card style={{ backgroundColor: palette.surfaceAlt }}>
      <View style={{ flexDirection: wide ? "row" : "column", alignItems: "center", gap: spacing.lg }}>
        <StatementArtwork ready={read} />
        <View style={{ flex: 1, minWidth: 0, alignSelf: "stretch", justifyContent: "center" }}>
          <Text style={[type.heading, { color: palette.textStrong }]}>{tr.statement.heroTitle}</Text>
          <Body muted style={{ marginTop: spacing.xs, marginBottom: spacing.md }}>
            {read ? tr.statement.heroReady(readCount) : tr.statement.intro}
          </Body>
          <Button
            testID="statement-pick"
            icon={FileText}
            label={read ? tr.statement.pickAgain : tr.statement.pick}
            variant={read ? "secondary" : "primary"}
            onPress={onPick}
            disabled={pending}
            loading={picking}
          />
        </View>
      </View>
    </Card>
  );
}

/**
 * Which bill this is, and when it is paid. The paper does not reliably print
 * either, and both decide where every accepted line lands, so they are asked
 * once here rather than guessed once per row.
 */
function StatementPeriodCard({ period, onPeriod, cards, cardId, onCard }: {
  period: MonthKey;
  onPeriod: (period: MonthKey) => void;
  cards: { id: string; name: string; statementDay: number | null; dueDay: number | null }[];
  cardId: string | null;
  onCard: (cardId: string | null) => void;
}) {
  const card = cards.find((source) => source.id === cardId);
  const cycle = { statementDay: card?.statementDay ?? null, dueDay: card?.dueDay ?? null };
  // The same rule the writer applies, shown before it is applied.
  const chargeDate = isValidCardCycle(cycle) ? statementPeriod(period, cycle).dueDate : lastDayOf(period);
  return (
    <Card testID="statement-period">
      <PanelHeader icon={ReceiptText} title={tr.statement.periodTitle} description={tr.statement.periodHint} />
      <MonthStepper value={period} onChange={onPeriod} />
      <View style={{ marginTop: spacing.md }}>
        <Select
          label={tr.statement.periodCard}
          value={cardId ?? ""}
          options={[{ value: "", label: tr.statement.periodNoCard }, ...cards.map((source) => ({ value: source.id, label: source.name }))]}
          onChange={(value) => onCard(value === "" ? null : value)}
        />
      </View>
      <Body muted style={{ marginTop: spacing.sm }}>{tr.statement.periodChargeDate(dateLabel(chargeDate))}</Body>
      {cardId == null ? <Body muted style={{ marginTop: spacing.xs }}>{tr.statement.periodCardHint}</Body> : null}
    </Card>
  );
}

/**
 * Read, understood, and deliberately left out. A statement importer that
 * silently discards lines is one whose total can never be reconciled against the paper.
 */
function StatementLeftOut({ parsed }: { parsed: StatementParseResult }) {
  return (
    <>
      {parsed.skipped.length > 0 ? (
        <Card>
          <PanelHeader icon={ReceiptText} title={tr.statement.skippedTitle} description={tr.statement.skippedHint} tone="secondary" />
          {parsed.skipped.slice(0, 20).map((skip, index) => (
            <Body key={`${skip.reason}:${index}`} muted style={{ marginTop: index === 0 ? 0 : spacing.xs }}>
              {skip.sourceLine}
            </Body>
          ))}
        </Card>
      ) : null}
      {parsed.rejected.length > 0 ? (
        <>
          <SectionHeader description={tr.statement.rejectedHint}>{tr.statement.rejectedTitle}</SectionHeader>
          {parsed.rejected.slice(0, 20).map((rejection, index) => (
            <Card key={`${rejection.reason}:${index}`} tone="warning">
              <Body muted>{tr.statement.reasons[rejection.reason]}</Body>
              <Body style={{ marginTop: 2 }}>{rejection.sourceLine}</Body>
            </Card>
          ))}
        </>
      ) : null}
    </>
  );
}

/**
 * The period-charge figure printed on the paper, checked against the lines as
 * the owner left them: edited amounts count, removed lines do not.
 *
 * Typed rather than parsed on purpose. A total's wording is the most
 * bank-specific thing on the page, and guessing it would be a guess about the
 * one number whose whole job is to be certain. Nothing is stored: the check
 * belongs to the moment the paper is in hand.
 */
function StatementCheck({ lines }: { lines: { amountMinor: number; isRefund: boolean }[] }) {
  const [declaredRaw, setDeclaredRaw] = useState("");
  const [declaredMinor, setDeclaredMinor] = useState<number | null>(null);
  const difference = statementDifferenceMinor(declaredMinor, lines);
  return (
    <>
      <SectionHeader description={tr.statement.checkHint}>{tr.statement.checkTitle}</SectionHeader>
      <Card tone={difference != null ? "warning" : declaredMinor == null ? undefined : "success"}>
        <MoneyField
          testID="statement-declared-total"
          label={tr.statement.checkLabel}
          value={declaredRaw}
          onChangeMinor={(raw, minor) => {
            setDeclaredRaw(raw);
            setDeclaredMinor(minor);
          }}
        />
        {declaredMinor == null ? null : (
          <Body muted={difference == null}>
            {difference == null
              ? tr.statement.checkMatch
              : difference > 0 ? tr.statement.checkShort(formatMinorCompact(difference)) : tr.statement.checkOver(formatMinorCompact(-difference))}
          </Body>
        )}
      </Card>
    </>
  );
}

/** A refusal names WHICH problem it is: a scan, a locked file and a wrong file each have a different next step. */
function StatementFailure({ failure }: { failure: PdfFailure }) {
  const { palette } = useTheme();
  return (
    <Card testID="statement-failure" tone="warning">
      <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
        <TriangleAlert accessible={false} size={18} color={palette.warningText} />
        <Body style={{ flex: 1, minWidth: 0 }}>{tr.statement.failures[failure]}</Body>
      </Row>
    </Card>
  );
}

const readSummary = (parsed: StatementParseResult, readCount: number) => [
  tr.statement.readCount(readCount),
  parsed.skipped.length > 0 ? tr.statement.skippedCount(parsed.skipped.length) : null,
  parsed.rejected.length > 0 ? tr.statement.rejectedCount(parsed.rejected.length) : null,
].filter(Boolean).join(" · ");

/** A read line as the review opens it, filed under the owner's column its words name rather than whichever sorted first. */
const draftOf = (candidate: StatementCandidate, categories: { id: string; name: string }[]): Draft => ({
  description: candidate.description,
  amountRaw: formatMinorInput(candidate.amountMinor),
  amountMinor: candidate.amountMinor,
  categoryId: matchStatementCategory(candidate.description, categories),
});

export default function StatementImportScreen() {
  const userId = useUserId();
  const router = useRouter();
  const undo = useUndo();
  const operation = useOperationGuard();
  const wide = shouldUseWideImportGuide(useContentWidth());
  const ledger = useStatementLedger();

  const [extracted, setExtracted] = useState<StatementParseResult | null>(null);
  const [failure, setFailure] = useState<PdfFailure | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  /** Lines the owner removed from the review. Never written, never re-offered. */
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  // Seeded from the paper and then the reader's: one statement bills one period on one card.
  const [period, setPeriod] = useState<MonthKey>(monthKeyOf(todayISO()));
  const [cardId, setCardId] = useState<string | null>(null);

  const visibleCandidates = (extracted?.candidates ?? []).filter((candidate) => !removed.has(candidate.importKey));
  const verdicts = extracted ? ledger.review(extracted.candidates, period, cardId) : new Map<string, CandidateVerdict>();

  const pick = () => operation.run(async () => {
    setFailure(null);
    setPicking(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets[0]) return;
      // Loaded with the first statement, as `xlsx` is with the first workbook: most sessions never read one.
      const { extractPdfText, MAX_PDF_BYTES } = await import("../services/pdf-text");
      const bytes = await readPickedBytes(picked.assets[0], MAX_PDF_BYTES, tr.statement.failures.too_large);
      const text = await extractPdfText(bytes);
      if (!text.ok) {
        setExtracted(null);
        setFailure(text.reason);
        return;
      }
      const readDates = parseStatement(text.text, "unknown").candidates.map((candidate) => candidate.date);
      const parsed = parseStatement(text.text, periodFromDates(readDates));
      const billedMonth = billedMonthFromDates(readDates) ?? period;
      const statementCard = cardId ?? ledger.cardOf(parsed.candidates, billedMonth);
      setPeriod(billedMonth);
      setCardId(statementCard);
      setExtracted(parsed);
      setRemoved(new Set());
      setEditingKey(null);
      setDrafts(Object.fromEntries(parsed.candidates.map((candidate) => [candidate.importKey, draftOf(candidate, ledger.expenseCategories)])));
      setSelected(defaultSelection(ledger.review(parsed.candidates, billedMonth, statementCard)));
    } catch (error) {
      devError("statement.pick", error);
      void appAlert(userMessage(error, tr.statement.failures.unreadable), tr.errors.title);
    } finally {
      setPicking(false);
    }
  });

  const toggle = (key: string) => setSelected((current) => current.has(key) ? without(current, key) : new Set(current).add(key));

  const remove = async (candidate: StatementCandidate) => {
    const confirmed = await appConfirm(drafts[candidate.importKey]?.description ?? candidate.description, tr.statement.removeConfirm, { confirmLabel: tr.common.delete, danger: true });
    if (!confirmed) return;
    setRemoved((current) => new Set(current).add(candidate.importKey));
    setSelected((current) => without(current, candidate.importKey));
    if (editingKey === candidate.importKey) setEditingKey(null);
  };

  const commit = async () => {
    const chosen = visibleCandidates.filter((candidate) => selected.has(candidate.importKey));
    if (!ledger.selfPerson || chosen.length === 0) return;
    if (!chosen.every((candidate) => draftComplete(drafts[candidate.importKey]))) {
      void appAlert(tr.statement.needsAmount, tr.errors.title);
      return;
    }
    const rows: AcceptedStatementRow[] = chosen.map((candidate) => {
      const draft = drafts[candidate.importKey]!;
      const verdict = verdicts.get(candidate.importKey);
      return {
        importKey: candidate.importKey,
        date: candidate.date,
        description: draft.description.trim(),
        amountMinor: draft.amountMinor,
        isRefund: candidate.isRefund,
        categoryId: draft.categoryId,
        // A refund printed with an instalment marker is money coming back off a plan, not a plan being opened.
        plan: candidate.isRefund ? null : statementPlanSpec(candidate, period),
        expectedId: verdict?.state === "expected" ? verdict.expectedId : null,
      };
    });
    setBusy(true);
    try {
      const result = await commitStatementRows(userId, { personId: ledger.selfPerson.id, period, paymentSourceId: cardId, rows });
      scheduleSync(userId);
      undo.show([
        tr.statement.committed(result.writtenIds.length),
        result.plansWritten > 0 ? tr.statement.plansCommitted(result.plansWritten) : null,
        result.skipped > 0 ? tr.statement.skipped(result.skipped) : null,
      ].filter(Boolean).join(" "));
      router.back();
    } catch (error) {
      devError("statement.commit", error);
      void appAlert(userMessage(error, tr.errors.saveFailed), tr.errors.title);
    } finally {
      setBusy(false);
    }
  };

  if (!ledger.ready) {
    return (
      <Screen>
        <Stack.Screen options={{ title: tr.statement.title }} />
        <DataStateNotice status={ledger.status} retry={ledger.retry} />
      </Screen>
    );
  }

  return (
    <Screen width="workspace">
      <Stack.Screen options={{ title: tr.statement.title }} />
      <DataStateNotice status={ledger.status} retry={ledger.retry} />
      <StatementHero wide={wide} readCount={extracted ? visibleCandidates.length : null} pending={picking || busy} picking={picking} onPick={() => void pick()} />
      <ImportJourney stage={extracted ? 1 : 0} fileIcon={FileText} />

      {failure ? <StatementFailure failure={failure} /> : null}

      {!extracted && !failure ? <StatementGuide wide={wide} /> : null}

      {extracted && visibleCandidates.length === 0 && !failure ? (
        <EmptyState icon={FileText} title={tr.statement.empty} hint={tr.statement.emptyHint} />
      ) : null}

      {extracted && visibleCandidates.length > 0 ? (
        <>
          <StatementPeriodCard period={period} onPeriod={setPeriod} cards={ledger.cards} cardId={cardId} onCard={setCardId} />

          <SectionHeader description={tr.statement.reviewHint}>{tr.statement.reviewTitle}</SectionHeader>
          <Body muted style={{ marginBottom: spacing.md }}>{readSummary(extracted, visibleCandidates.length)}</Body>

          {/* Bulk actions do the SAME thing the defaults did, so a person who
              cleared the selection can get back to the safe set in one press
              rather than re-reading every row. */}
          <Row gap={spacing.sm} style={{ marginBottom: spacing.md, flexWrap: "wrap" }}>
            <Button size="sm" variant="ghost" testID="statement-select-new" label={tr.statement.selectAllNew} onPress={() => setSelected(defaultSelection(verdicts))} />
            <Button size="sm" variant="ghost" testID="statement-clear-selection" label={tr.statement.clearSelection} disabled={selected.size === 0} onPress={() => setSelected(new Set())} />
          </Row>

          {visibleCandidates.map((candidate) => {
            const verdict = verdicts.get(candidate.importKey);
            const draft = drafts[candidate.importKey];
            return draft ? (
              <CandidateRow
                key={candidate.importKey}
                candidate={candidate}
                draft={draft}
                planSpec={candidate.isRefund || verdict?.state === "plan" ? null : statementPlanSpec(candidate, period)}
                verdictText={verdictLabel(verdict)}
                selected={selected.has(candidate.importKey)}
                editing={editingKey === candidate.importKey}
                categories={ledger.expenseCategories}
                onToggle={() => toggle(candidate.importKey)}
                onEdit={() => setEditingKey(candidate.importKey)}
                onCancelEdit={() => setEditingKey(null)}
                onChange={(next) => setDrafts((current) => ({ ...current, [candidate.importKey]: { ...current[candidate.importKey]!, ...next } }))}
                onRemove={() => void remove(candidate)}
              />
            ) : null;
          })}

          <StatementLeftOut parsed={extracted} />
          {/* Beside the figures it read and before Aktar, while the statement is still open. */}
          <StatementCheck lines={visibleCandidates.map((candidate) => ({ amountMinor: drafts[candidate.importKey]?.amountMinor ?? candidate.amountMinor, isRefund: candidate.isRefund }))} />

          <Button
            testID="statement-commit"
            label={tr.statement.acceptCount(selected.size)}
            onPress={() => void commit()}
            disabled={selected.size === 0 || busy || !ledger.selfPerson || editingKey != null}
            loading={busy}
          />
        </>
      ) : null}
    </Screen>
  );
}
