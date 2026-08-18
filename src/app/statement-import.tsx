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
 */

import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { Stack, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import FileText from "lucide-react-native/icons/file-text";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { useAllTransactionsState, useCategoriesState, usePersonsState, usePlansState, useUserId } from "../data/hooks";
import { combineLiveStates } from "../data/live-state";
import { commitStatementRows, type AcceptedStatementRow } from "../data/repo";
import { extractPdfText, MAX_PDF_BYTES, type PdfFailure } from "../services/pdf-text";
import { readPickedBytes } from "../services/picked-file";
import {
  defaultSelection,
  parseStatement,
  periodFromDates,
  reviewCandidates,
  type CandidateVerdict,
  type StatementCandidate,
  type StatementRejection,
} from "../domain/statement-import";
import { formatMinorCompact } from "../domain/money";
import { userMessage } from "../domain/user-error";
import { dateLabel, tr } from "../i18n/tr";
import { scheduleSync } from "../sync/engine";
import { devError } from "../services/logger";
import { Badge, Body, Button, Card, DataStateNotice, EmptyState, Row, Screen, SectionHeader, Spread } from "../ui/components";
import { Select } from "../ui/selection-controls";
import { appAlert } from "../ui/dialog";
import { useUndo } from "../ui/undo";
import { useOperationGuard } from "../ui/operation-guard";
import { spacing, useTheme } from "../ui/theme";

interface Extracted {
  candidates: StatementCandidate[];
  rejected: StatementRejection[];
}

/** A candidate as the owner may have edited it. */
interface Draft {
  amountMinor: number;
  categoryId: string | null;
}

export default function StatementImportScreen() {
  const userId = useUserId();
  const router = useRouter();
  const { palette } = useTheme();
  const undo = useUndo();
  const operation = useOperationGuard();

  const categoriesState = useCategoriesState();
  const personsState = usePersonsState();
  const transactionsState = useAllTransactionsState();
  const plansState = usePlansState();
  const { status, ready, retry } = combineLiveStates([categoriesState, personsState, transactionsState, plansState]);

  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [failure, setFailure] = useState<PdfFailure | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  const expenseCategories = useMemo(
    () => categoriesState.data.filter((category) => category.kind === "expense"),
    [categoriesState.data],
  );
  const selfPerson = personsState.data.find((person) => person.isSelf);

  const verdicts = useMemo(() => {
    if (!extracted) return new Map<string, CandidateVerdict>();
    return reviewCandidates({
      candidates: extracted.candidates,
      existing: transactionsState.data.map((transaction) => ({
        id: transaction.id,
        amountTryMinor: transaction.amountTryMinor,
        effectiveDate: transaction.effectiveDate,
        importKey: transaction.importKey,
        installmentPlanId: transaction.installmentPlanId,
      })),
      plans: plansState.data.map((plan) => ({
        id: plan.id,
        title: plan.title,
        installmentCount: plan.installmentCount,
        monthlyAmountMinor: plan.monthlyAmountMinor,
      })),
    });
  }, [extracted, transactionsState.data, plansState.data]);

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
        const period = periodFromDates(parseStatement(text.text, "unknown").candidates.map((candidate) => candidate.date));
        const parsed = parseStatement(text.text, period);
        setExtracted({ candidates: parsed.candidates, rejected: parsed.rejected });
        setDrafts(Object.fromEntries(parsed.candidates.map((candidate) => [
          candidate.importKey,
          { amountMinor: candidate.amountMinor, categoryId: expenseCategories[0]?.id ?? null },
        ])));
        setSelected(defaultSelection(reviewCandidates({
          candidates: parsed.candidates,
          existing: transactionsState.data.map((transaction) => ({
            id: transaction.id,
            amountTryMinor: transaction.amountTryMinor,
            effectiveDate: transaction.effectiveDate,
            importKey: transaction.importKey,
          })),
          plans: plansState.data.map((plan) => ({
            id: plan.id,
            title: plan.title,
            installmentCount: plan.installmentCount,
            monthlyAmountMinor: plan.monthlyAmountMinor,
          })),
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

  const commit = async () => {
    if (!extracted || !selfPerson || selected.size === 0) return;
    const rows: AcceptedStatementRow[] = [];
    for (const candidate of extracted.candidates) {
      if (!selected.has(candidate.importKey)) continue;
      const draft = drafts[candidate.importKey];
      if (!draft?.categoryId) {
        void appAlert(tr.statement.needsCategory, tr.errors.title);
        return;
      }
      rows.push({
        importKey: candidate.importKey,
        date: candidate.date,
        description: candidate.description,
        amountMinor: draft.amountMinor,
        isRefund: candidate.isRefund,
        categoryId: draft.categoryId,
        paymentSourceId: null,
      });
    }
    setBusy(true);
    try {
      const result = await commitStatementRows(userId, selfPerson.id, rows);
      scheduleSync(userId);
      undo.show([
        tr.statement.committed(result.writtenIds.length),
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

  return (
    <Screen width="workspace">
      <Stack.Screen options={{ title: tr.statement.title }} />
      <DataStateNotice status={status} retry={retry} />

      <Card>
        <Body>{tr.statement.intro}</Body>
        <Body muted style={{ marginTop: spacing.xs }}>{tr.statement.localOnly}</Body>
        <View style={{ marginTop: spacing.md }}>
          <Button
            testID="statement-pick"
            icon={FileText}
            label={picking ? tr.statement.picking : tr.statement.pick}
            onPress={() => void pick()}
            disabled={picking || busy}
          />
        </View>
      </Card>

      {/* A refusal names WHICH problem it is: a scan, a locked file and a
          wrong file each have a different next step for the owner. */}
      {failure ? (
        <Card testID="statement-failure" tone="warning">
          <Row gap={spacing.sm}>
            <TriangleAlert accessible={false} size={18} color={palette.warningText} />
            <Body style={{ flex: 1, minWidth: 0 }}>{tr.statement.failures[failure]}</Body>
          </Row>
        </Card>
      ) : null}

      {extracted && extracted.candidates.length === 0 && !failure ? (
        <EmptyState icon={FileText} title={tr.statement.empty} hint={tr.statement.emptyHint} />
      ) : null}

      {extracted && extracted.candidates.length > 0 ? (
        <>
          <SectionHeader>{tr.statement.reviewTitle}</SectionHeader>
          <Body muted style={{ marginBottom: spacing.sm }}>{tr.statement.reviewHint}</Body>
          <Body muted style={{ marginBottom: spacing.md }}>
            {tr.statement.readCount(extracted.candidates.length)}
            {extracted.rejected.length > 0 ? ` · ${tr.statement.rejectedCount(extracted.rejected.length)}` : ""}
          </Body>

          {extracted.candidates.map((candidate) => {
            const verdict = verdicts.get(candidate.importKey) ?? { state: "new" as const };
            const draft = drafts[candidate.importKey];
            const isSelected = selected.has(candidate.importKey);
            const verdictText = verdict.state === "imported"
              ? tr.statement.verdicts.imported
              : verdict.state === "plan"
                ? tr.statement.verdicts.plan(verdict.planTitle)
                : verdict.state === "similar"
                  ? tr.statement.verdicts.similar
                  : "";
            return (
              <Card key={candidate.importKey} testID={`statement-row-${candidate.importKey}`}>
                <Spread style={{ alignItems: "flex-start", gap: spacing.sm }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Row gap={spacing.sm} style={{ flexWrap: "wrap" }}>
                      {candidate.kind === "installment" && candidate.installmentNo && candidate.installmentCount ? (
                        <Badge text={tr.statement.installmentOf(candidate.installmentNo, candidate.installmentCount)} tone="primary" />
                      ) : null}
                      {candidate.isRefund ? <Badge text={tr.statement.refund} tone="positive" /> : null}
                      {verdictText ? <Badge text={verdictText} tone={verdict.state === "new" ? "muted" : "warning"} /> : null}
                    </Row>
                    <Body style={{ marginTop: spacing.xs }}>{candidate.description}</Body>
                    <Body
                      muted
                      accessibilityLabel={tr.statement.a11yRow(
                        candidate.description,
                        formatMinorCompact(candidate.amountMinor),
                        dateLabel(candidate.date),
                        verdictText,
                      )}
                      style={{ marginTop: 2 }}
                    >
                      {dateLabel(candidate.date)} · {formatMinorCompact(draft?.amountMinor ?? candidate.amountMinor)}
                    </Body>
                  </View>
                  <Button
                    size="sm"
                    testID={`statement-toggle-${candidate.importKey}`}
                    variant={isSelected ? "primary" : "ghost"}
                    label={tr.statement.accept}
                    accessibilityHint={verdictText || undefined}
                    onPress={() => toggle(candidate.importKey)}
                  />
                </Spread>
                {isSelected ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <Select
                      label={tr.statement.category}
                      value={draft?.categoryId ?? ""}
                      options={expenseCategories.map((category) => ({ value: category.id, label: category.name }))}
                      onChange={(value) => setDrafts((current) => ({
                        ...current,
                        [candidate.importKey]: {
                          amountMinor: current[candidate.importKey]?.amountMinor ?? candidate.amountMinor,
                          categoryId: value,
                        },
                      }))}
                    />
                  </View>
                ) : null}
              </Card>
            );
          })}

          {extracted.rejected.length > 0 ? (
            <>
              <SectionHeader>{tr.statement.rejectedTitle}</SectionHeader>
              <Body muted style={{ marginBottom: spacing.sm }}>{tr.statement.rejectedHint}</Body>
              {extracted.rejected.slice(0, 20).map((rejection, index) => (
                <Card key={`${rejection.reason}:${index}`} tone="warning">
                  <Body muted>{tr.statement.reasons[rejection.reason]}</Body>
                  <Body style={{ marginTop: 2 }}>{rejection.sourceLine}</Body>
                </Card>
              ))}
            </>
          ) : null}

          {/* Bulk actions do the SAME thing the defaults did, so a person who
              cleared the selection can get back to the safe set in one press
              rather than re-reading every row. */}
          <Row gap={spacing.sm} style={{ marginTop: spacing.md, flexWrap: "wrap" }}>
            <View>
              <Button
                size="sm"
                variant="ghost"
                testID="statement-select-new"
                label={tr.statement.selectAllNew}
                onPress={() => setSelected(defaultSelection(verdicts))}
              />
            </View>
            <View>
              <Button
                size="sm"
                variant="ghost"
                testID="statement-clear-selection"
                label={tr.statement.clearSelection}
                disabled={selected.size === 0}
                onPress={() => setSelected(new Set())}
              />
            </View>
          </Row>
          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <Button
              testID="statement-commit"
              label={tr.statement.acceptCount(selected.size)}
              onPress={() => void commit()}
              disabled={selected.size === 0 || busy || !selfPerson}
              loading={busy}
            />
          </View>
        </>
      ) : null}
    </Screen>
  );
}
