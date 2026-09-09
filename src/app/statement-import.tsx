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

import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import FileText from "lucide-react-native/icons/file-text";
import Check from "lucide-react-native/icons/check";
import ReceiptText from "lucide-react-native/icons/receipt-text";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { useAllTransactionsState, useCategoriesState, usePersonsState, usePlansState, useSourcesState, useUserId } from "../data/hooks";
import { combineLiveStates } from "../data/live-state";
import { commitStatementRows, type AcceptedStatementRow } from "../data/repo";
import { extractPdfText, MAX_PDF_BYTES, type PdfFailure } from "../services/pdf-text";
import { readPickedBytes } from "../services/picked-file";
import {
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
import { isMonthKey, lastDayOf, monthKeyOf, todayISO, type MonthKey } from "../domain/dates";
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
          {/* Marks first, then the merchant, then the figure. The cluster used
              to share a row with the accept button, so a wrapped badge and a
              48pt control sat on two different baselines. */}
          {candidate.kind === "installment" || candidate.isRefund || verdictText ? (
            <Row gap={spacing.sm} style={{ flexWrap: "wrap", marginBottom: spacing.xs }}>
              {candidate.installmentNo && candidate.installmentCount ? (
                <Badge text={tr.statement.installmentOf(candidate.installmentNo, candidate.installmentCount)} tone="primary" />
              ) : null}
              {candidate.isRefund ? <Badge text={tr.statement.refund} tone="positive" /> : null}
              {verdictText ? <Badge text={verdictText} tone="warning" /> : null}
            </Row>
          ) : null}
          <Body>{draft.description}</Body>
          <Body muted style={{ marginTop: 2 }}>
            {dateLabel(candidate.date)} · {amountText}
          </Body>
        </View>
      </Pressable>

      {editing ? (
        <View style={{ marginTop: spacing.md }}>
          <Field
            label={tr.statement.descriptionLabel}
            value={draft.description}
            onChangeText={(description) => onChange({ description })}
          />
          <MoneyField
            label={tr.tx.amount}
            value={draft.amountRaw}
            onChangeMinor={(amountRaw, amountMinor) => onChange({ amountRaw, amountMinor: amountMinor ?? 0 })}
          />
          <Select
            label={tr.statement.category}
            value={draft.categoryId ?? ""}
            options={[
              { value: "", label: tr.statement.noCategory },
              ...categories.map((category) => ({ value: category.id, label: category.name })),
            ]}
            onChange={(categoryId) => onChange({ categoryId: categoryId === "" ? null : categoryId })}
          />
          <Row gap={spacing.sm}>
            <Button size="sm" label={tr.common.done} onPress={onCancelEdit} disabled={draft.description.trim() === "" || draft.amountMinor <= 0} />
          </Row>
        </View>
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

export default function StatementImportScreen() {
  const userId = useUserId();
  const router = useRouter();
  const { palette } = useTheme();
  const undo = useUndo();
  const operation = useOperationGuard();
  const wide = shouldUseWideImportGuide(useContentWidth());

  const categoriesState = useCategoriesState();
  const personsState = usePersonsState();
  const transactionsState = useAllTransactionsState();
  const plansState = usePlansState();
  const sourcesState = useSourcesState();
  const { status, ready, retry } = combineLiveStates([categoriesState, personsState, transactionsState, plansState, sourcesState]);

  const [extracted, setExtracted] = useState<StatementParseResult | null>(null);
  const [failure, setFailure] = useState<PdfFailure | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  /** Lines the owner removed from the review. Never written, never re-offered. */
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  /**
   * The period-charge figure printed on the paper, as the owner reads it.
   *
   * Typed rather than parsed on purpose. This screen's promise is that a
   * statement is a document the app cannot verify and therefore does not guess
   * at, and a total's wording is the most bank-specific thing on the page —
   * guessing it would be a guess about the one number whose whole job is to be
   * certain. Nothing is stored either: the check belongs to the moment the
   * paper is in hand.
   */
  const [declaredRaw, setDeclaredRaw] = useState("");
  const [declaredMinor, setDeclaredMinor] = useState<number | null>(null);
  /**
   * The period this statement bills, and the card it belongs to.
   *
   * Seeded from the dates on the paper and then owned by the reader, because
   * the period is the one fact that decides where every accepted line lands.
   * It used to be inferred per line — each row took the day printed beside it
   * — so one statement wrote into every month its purchases were made in.
   */
  const [period, setPeriod] = useState<MonthKey>(monthKeyOf(todayISO()));
  const [cardId, setCardId] = useState<string | null>(null);

  const expenseCategories = useMemo(
    () => categoriesState.data.filter((category) => category.kind === "expense"),
    [categoriesState.data],
  );
  const selfPerson = personsState.data.find((person) => person.isSelf);
  const cards = useMemo(
    () => sourcesState.data.filter((source) => source.type === "credit_card"),
    [sourcesState.data],
  );
  const card = cards.find((source) => source.id === cardId) ?? null;
  const cycle = card && isValidCardCycle({ statementDay: card.statementDay, dueDay: card.dueDay })
    ? { statementDay: card.statementDay!, dueDay: card.dueDay! }
    : null;
  // The same rule the writer applies, shown before it is applied. A screen that
  // moves every row to one day owes the reader that day up front.
  const chargeDate = cycle ? statementPeriod(period, cycle).dueDate : lastDayOf(period);

  const visibleCandidates = useMemo(
    () => (extracted?.candidates ?? []).filter((candidate) => !removed.has(candidate.importKey)),
    [extracted, removed],
  );

  /**
   * The read, as the owner has left it: their edits, minus what they removed.
   *
   * Not the raw parse. A line whose amount was corrected in review is worth
   * its corrected amount, and one that was removed is not part of what this
   * import claims to have read — checking the untouched parse would answer a
   * question nobody is asking.
   */
  const statementDifference = useMemo(
    () => statementDifferenceMinor(
      declaredMinor,
      visibleCandidates.map((candidate) => ({
        amountMinor: drafts[candidate.importKey]?.amountMinor ?? candidate.amountMinor,
        isRefund: candidate.isRefund,
      })),
    ),
    [declaredMinor, visibleCandidates, drafts],
  );

  const existingRows = useMemo(
    () => transactionsState.data.map((transaction) => ({
      id: transaction.id,
      amountTryMinor: transaction.amountTryMinor,
      effectiveDate: transaction.effectiveDate,
      importKey: transaction.importKey,
      installmentPlanId: transaction.installmentPlanId,
    })),
    [transactionsState.data],
  );
  const existingPlans = useMemo(
    () => plansState.data.map((plan) => ({
      id: plan.id,
      title: plan.title,
      installmentCount: plan.installmentCount,
      monthlyAmountMinor: plan.monthlyAmountMinor,
    })),
    [plansState.data],
  );

  const verdicts = useMemo(() => {
    if (!extracted) return new Map<string, CandidateVerdict>();
    return reviewCandidates({ candidates: extracted.candidates, existing: existingRows, plans: existingPlans });
  }, [extracted, existingRows, existingPlans]);

  const pick = async () => {
    await operation.run(async () => {
      setFailure(null);
      setPicking(true);
      try {
        const picked = await DocumentPicker.getDocumentAsync({
          type: "application/pdf",
          copyToCacheDirectory: true,
        });
        if (picked.canceled || !picked.assets[0]) return;
        const bytes = await readPickedBytes(picked.assets[0], MAX_PDF_BYTES, tr.statement.failures.too_large);
        const text = await extractPdfText(bytes);
        if (!text.ok) {
          setExtracted(null);
          setFailure(text.reason);
          return;
        }
        const readPeriod = periodFromDates(parseStatement(text.text, "unknown").candidates.map((candidate) => candidate.date));
        const parsed = parseStatement(text.text, readPeriod);
        if (isMonthKey(readPeriod)) setPeriod(readPeriod);
        setExtracted(parsed);
        setRemoved(new Set());
        setEditingKey(null);
        setDrafts(Object.fromEntries(parsed.candidates.map((candidate) => [
          candidate.importKey,
          {
            description: candidate.description,
            amountRaw: formatMinorInput(candidate.amountMinor),
            amountMinor: candidate.amountMinor,
            // The owner's own column, chosen from what the line says. It used
            // to be `expenseCategories[0]` — whichever column happened to sort
            // first — so a whole statement was filed under one arbitrary
            // heading and nothing on screen admitted the guess.
            categoryId: matchStatementCategory(candidate.description, expenseCategories),
          },
        ])));
        setSelected(defaultSelection(reviewCandidates({
          candidates: parsed.candidates,
          existing: existingRows,
          plans: existingPlans,
        })));
      } catch (error) {
        devError("statement.pick", error);
        void appAlert(userMessage(error, tr.statement.failures.unreadable), tr.errors.title);
      } finally {
        setPicking(false);
      }
    });
  };

  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const remove = async (candidate: StatementCandidate) => {
    const confirmed = await appConfirm(
      drafts[candidate.importKey]?.description ?? candidate.description,
      tr.statement.removeConfirm,
      { confirmLabel: tr.common.delete, danger: true },
    );
    if (!confirmed) return;
    setRemoved((current) => new Set(current).add(candidate.importKey));
    setSelected((current) => {
      const next = new Set(current);
      next.delete(candidate.importKey);
      return next;
    });
    if (editingKey === candidate.importKey) setEditingKey(null);
  };

  const commit = async () => {
    if (!extracted || !selfPerson || selected.size === 0) return;
    const rows: AcceptedStatementRow[] = [];
    for (const candidate of visibleCandidates) {
      if (!selected.has(candidate.importKey)) continue;
      const draft = drafts[candidate.importKey];
      if (!draft || draft.description.trim() === "" || draft.amountMinor <= 0) {
        void appAlert(tr.statement.needsAmount, tr.errors.title);
        return;
      }
      rows.push({
        importKey: candidate.importKey,
        date: candidate.date,
        description: draft.description.trim(),
        amountMinor: draft.amountMinor,
        isRefund: candidate.isRefund,
        categoryId: draft.categoryId,
        // A refund printed with an instalment marker is not a plan being
        // opened; it is money coming back off one. It stays a single line.
        plan: candidate.isRefund ? null : statementPlanSpec(candidate, period),
      });
    }
    setBusy(true);
    try {
      const result = await commitStatementRows(userId, {
        personId: selfPerson.id,
        period,
        paymentSourceId: cardId,
        rows,
      });
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

  if (!ready) {
    return (
      <Screen>
        <Stack.Screen options={{ title: tr.statement.title }} />
        <DataStateNotice status={status} retry={retry} />
      </Screen>
    );
  }

  const hasCandidates = visibleCandidates.length > 0;

  return (
    <Screen width="workspace">
      <Stack.Screen options={{ title: tr.statement.title }} />
      <DataStateNotice status={status} retry={retry} />

      {/* The workbook importer's hero, told with a statement: the same picture,
          the same button, the same place on the page. */}
      <Card style={{ backgroundColor: palette.surfaceAlt }}>
        <View style={{ flexDirection: wide ? "row" : "column", alignItems: "center", gap: spacing.lg }}>
          <StatementArtwork ready={extracted != null} />
          <View style={{ flex: 1, minWidth: 0, alignSelf: "stretch", justifyContent: "center" }}>
            <Text style={[type.heading, { color: palette.textStrong }]}>{tr.statement.heroTitle}</Text>
            <Body muted style={{ marginTop: spacing.xs, marginBottom: spacing.md }}>
              {extracted ? tr.statement.heroReady(visibleCandidates.length) : tr.statement.intro}
            </Body>
            <Button
              testID="statement-pick"
              icon={FileText}
              label={extracted ? tr.statement.pickAgain : tr.statement.pick}
              variant={extracted ? "secondary" : "primary"}
              onPress={() => void pick()}
              disabled={picking || busy}
              loading={picking}
            />
          </View>
        </View>
      </Card>
      <ImportJourney stage={extracted ? 1 : 0} fileIcon={FileText} />

      {/* A refusal names WHICH problem it is: a scan, a locked file and a
          wrong file each have a different next step for the owner. */}
      {failure ? (
        <Card testID="statement-failure" tone="warning">
          <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
            <TriangleAlert accessible={false} size={18} color={palette.warningText} />
            <Body style={{ flex: 1, minWidth: 0 }}>{tr.statement.failures[failure]}</Body>
          </Row>
        </Card>
      ) : null}

      {!extracted && !failure ? <StatementGuide wide={wide} /> : null}

      {extracted && !hasCandidates && !failure ? (
        <EmptyState icon={FileText} title={tr.statement.empty} hint={tr.statement.emptyHint} />
      ) : null}

      {extracted && hasCandidates ? (
        <>
          {/* Before any row is read: which bill is this, and when is it paid.
              Both are answers the paper does not reliably print, and both
              decide where every accepted line lands — so they are asked once
              here rather than guessed once per row. */}
          <Card testID="statement-period">
            <PanelHeader icon={ReceiptText} title={tr.statement.periodTitle} description={tr.statement.periodHint} />
            <MonthStepper value={period} onChange={setPeriod} />
            <View style={{ marginTop: spacing.md }}>
              <Select
                label={tr.statement.periodCard}
                value={cardId ?? ""}
                options={[
                  { value: "", label: tr.statement.periodNoCard },
                  ...cards.map((source) => ({ value: source.id, label: source.name })),
                ]}
                onChange={(value) => setCardId(value === "" ? null : value)}
              />
            </View>
            <Body muted style={{ marginTop: spacing.sm }}>{tr.statement.periodChargeDate(dateLabel(chargeDate))}</Body>
            {cardId == null ? (
              <Body muted style={{ marginTop: spacing.xs }}>{tr.statement.periodCardHint}</Body>
            ) : null}
          </Card>

          <SectionHeader description={tr.statement.reviewHint}>{tr.statement.reviewTitle}</SectionHeader>
          <Body muted style={{ marginBottom: spacing.md }}>
            {[
              tr.statement.readCount(visibleCandidates.length),
              extracted.skipped.length > 0 ? tr.statement.skippedCount(extracted.skipped.length) : null,
              extracted.rejected.length > 0 ? tr.statement.rejectedCount(extracted.rejected.length) : null,
            ].filter(Boolean).join(" · ")}
          </Body>

          {/* Bulk actions do the SAME thing the defaults did, so a person who
              cleared the selection can get back to the safe set in one press
              rather than re-reading every row. */}
          <Row gap={spacing.sm} style={{ marginBottom: spacing.md, flexWrap: "wrap" }}>
            <Button
              size="sm"
              variant="ghost"
              testID="statement-select-new"
              label={tr.statement.selectAllNew}
              onPress={() => setSelected(defaultSelection(verdicts))}
            />
            <Button
              size="sm"
              variant="ghost"
              testID="statement-clear-selection"
              label={tr.statement.clearSelection}
              disabled={selected.size === 0}
              onPress={() => setSelected(new Set())}
            />
          </Row>

          {visibleCandidates.map((candidate) => {
            const verdict = verdicts.get(candidate.importKey) ?? { state: "new" as const };
            const draft = drafts[candidate.importKey];
            if (!draft) return null;
            const verdictText = verdict.state === "imported"
              ? tr.statement.verdicts.imported
              : verdict.state === "plan"
                ? tr.statement.verdicts.plan(verdict.planTitle)
                : verdict.state === "similar"
                  ? tr.statement.verdicts.similar
                  : "";
            return (
              <CandidateRow
                key={candidate.importKey}
                candidate={candidate}
                draft={draft}
                planSpec={candidate.isRefund ? null : statementPlanSpec(candidate, period)}
                verdictText={verdictText}
                selected={selected.has(candidate.importKey)}
                editing={editingKey === candidate.importKey}
                categories={expenseCategories}
                onToggle={() => toggle(candidate.importKey)}
                onEdit={() => setEditingKey(candidate.importKey)}
                onCancelEdit={() => setEditingKey(null)}
                onChange={(next) => setDrafts((current) => ({
                  ...current,
                  [candidate.importKey]: { ...current[candidate.importKey]!, ...next },
                }))}
                onRemove={() => void remove(candidate)}
              />
            );
          })}

          {/* Read, understood, and deliberately left out. A statement importer
              that silently discards lines is one whose total can never be
              reconciled against the paper. */}
          {extracted.skipped.length > 0 ? (
            <Card>
              <PanelHeader
                icon={ReceiptText}
                title={tr.statement.skippedTitle}
                description={tr.statement.skippedHint}
                tone="secondary"
              />
              {extracted.skipped.slice(0, 20).map((skip, index) => (
                <Body key={`${skip.reason}:${index}`} muted style={{ marginTop: index === 0 ? 0 : spacing.xs }}>
                  {skip.sourceLine}
                </Body>
              ))}
            </Card>
          ) : null}

          {extracted.rejected.length > 0 ? (
            <>
              <SectionHeader description={tr.statement.rejectedHint}>{tr.statement.rejectedTitle}</SectionHeader>
              {extracted.rejected.slice(0, 20).map((rejection, index) => (
                <Card key={`${rejection.reason}:${index}`} tone="warning">
                  <Body muted>{tr.statement.reasons[rejection.reason]}</Body>
                  <Body style={{ marginTop: 2 }}>{rejection.sourceLine}</Body>
                </Card>
              ))}
            </>
          ) : null}

          {/* The comment above the skipped panel names the gap this closes: an
              importer that discards lines silently is one whose total can
              never be reconciled against the paper. The figures it read are
              here, so the one number that can prove the read was complete
              belongs here too — beside them, before Aktar, while the statement
              is still open. */}
          <SectionHeader description={tr.statement.checkHint}>{tr.statement.checkTitle}</SectionHeader>
          <Card tone={statementDifference == null ? (declaredMinor == null ? undefined : "success") : "warning"}>
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
              <Body muted={statementDifference == null}>
                {statementDifference == null
                  ? tr.statement.checkMatch
                  : statementDifference > 0
                    ? tr.statement.checkShort(formatMinorCompact(statementDifference))
                    : tr.statement.checkOver(formatMinorCompact(-statementDifference))}
              </Body>
            )}
          </Card>

          <Button
            testID="statement-commit"
            label={tr.statement.acceptCount(selected.size)}
            onPress={() => void commit()}
            disabled={selected.size === 0 || busy || !selfPerson || editingKey != null}
            loading={busy}
          />
        </>
      ) : null}
    </Screen>
  );
}
