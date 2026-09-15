/**
 * Record a refund against an instalment purchase (spec §3.2).
 *
 * Two steps, because "which purchase?" has to be answered before "how much?"
 * can mean anything: the amount is checked against what is left of that
 * purchase, and whether it can be spread depends on how many instalments it
 * still has. Arriving from a plan's own screen skips the first step.
 */

import { useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import CreditCard from "lucide-react-native/icons/credit-card";
import Landmark from "lucide-react-native/icons/landmark";
import Search from "lucide-react-native/icons/search";
import Undo2 from "lucide-react-native/icons/undo-2";
import { addInstallmentRefund, FxRateUnavailableError, InstallmentRefundNothingLeftError, InstallmentRefundTooLargeError } from "../data/repo";
import { useAllTransactionsState, usePlansState, useSourcesState, useUserId } from "../data/hooks";
import { combineLiveStates } from "../data/live-state";
import { monthKeyOf, todayISO, type MonthKey } from "../domain/dates";
import { installmentDisplayTitle } from "../domain/installments";
import { formatMinorCompact, splitIntoInstallments } from "../domain/money";
import { tr } from "../i18n/tr";
import { Body, Button, Card, CardList, ChoiceTile, DataGateScreen, DataStateNotice, EmptyState, Field, ListRow, MoneyField, MonthStepper, PanelHeader, Screen } from "../ui/components";
import { appAlert } from "../ui/dialog";
import { scheduleSync } from "../sync/engine";
import { spacing } from "../ui/theme";
import { navigateBack } from "../ui/navigation";
import { devError } from "../services/logger";
import { useOperationGuard } from "../ui/operation-guard";
import { useDirtyExitGuard, useDraftDirty } from "../ui/dirty-exit";

type Plan = ReturnType<typeof usePlansState>["data"][number];
type Row = ReturnType<typeof useAllTransactionsState>["data"][number];

interface PlanSummary {
  plan: Plan;
  title: string;
  purchaseMinor: number;
  refundedMinor: number;
  /** The purchase less the refunds already recorded — the most a refund may be.
   *  Every figure here is in the plan's own currency, which is what a refund of
   *  a foreign purchase is entered in. */
  leftMinor: number;
  paid: number;
  pending: number;
}

/**
 * Every plan with what it has billed, refunded and still owes. One pass over
 * the ledger rather than one per plan: an imported workbook brings hundreds of
 * plans and thousands of rows.
 */
function summarizePlans(plans: Plan[], transactions: Row[]): PlanSummary[] {
  const rowsByPlan = new Map<string, Row[]>();
  for (const row of transactions) {
    if (!row.installmentPlanId) continue;
    const list = rowsByPlan.get(row.installmentPlanId) ?? [];
    list.push(row);
    rowsByPlan.set(row.installmentPlanId, list);
  }
  return plans.map((plan) => {
    const rows = rowsByPlan.get(plan.id) ?? [];
    const instalments = rows.filter((row) => row.installmentNo != null);
    const purchaseMinor = instalments.reduce((sum, row) => sum + row.amountMinor, 0);
    // A closed loan's payoff is the one unnumbered row that is not a refund.
    const refundedMinor = -rows.filter((row) => row.installmentNo == null && row.amountMinor < 0).reduce((sum, row) => sum + row.amountMinor, 0);
    const pending = instalments.filter((row) => row.status === "pending").length;
    return {
      plan,
      title: installmentDisplayTitle(plan.title, rows.find((row) => row.note)?.note, tr.installments.plan),
      purchaseMinor,
      refundedMinor,
      leftMinor: purchaseMinor - refundedMinor,
      paid: instalments.length - pending,
      pending,
    };
  });
}

function planLine(summary: PlanSummary, sourceName: Map<string, string>): string {
  return [
    tr.installments.refundPlanLine(
      sourceName.get(summary.plan.paymentSourceId ?? "") ?? tr.installments.noSource,
      formatMinorCompact(summary.purchaseMinor, summary.plan.currency),
      summary.paid,
      summary.paid + summary.pending,
    ),
    summary.refundedMinor > 0 ? tr.installments.refundedSoFar(formatMinorCompact(summary.refundedMinor, summary.plan.currency)) : null,
  ].filter(Boolean).join(" · ");
}

/** The line that says what the purchase comes to once this refund is in. */
function refundPreviewLine(summary: PlanSummary, amountMinor: number | null): string | null {
  if (amountMinor == null || amountMinor <= 0) return null;
  const currency = summary.plan.currency;
  return amountMinor > summary.leftMinor
    ? tr.installments.refundTooLarge(formatMinorCompact(summary.leftMinor, currency))
    : tr.installments.refundPreview(formatMinorCompact(summary.leftMinor, currency), formatMinorCompact(summary.leftMinor - amountMinor, currency));
}

/** Whether a refund of `amountMinor` fits what is left and can be spread the way chosen. */
function refundSaveable(summary: PlanSummary, amountMinor: number | null, spread: "remaining" | "once"): boolean {
  return amountMinor != null
    && amountMinor > 0
    && amountMinor <= summary.leftMinor
    && (spread === "once" || summary.pending > 0);
}

function refundErrorMessage(error: unknown, currency: string): string {
  if (error instanceof InstallmentRefundTooLargeError) return tr.installments.refundTooLarge(formatMinorCompact(error.remainingMinor, currency));
  if (error instanceof InstallmentRefundNothingLeftError) return tr.installments.refundNothingLeft;
  if (error instanceof FxRateUnavailableError) return tr.errors.fxUnavailable;
  return tr.errors.saveFailed;
}

function RefundPlanPicker({
  summaries,
  sourceName,
  onPick,
}: {
  summaries: PlanSummary[];
  sourceName: Map<string, string>;
  onPick: (planId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase("tr");
  // Purchases with something left to refund, running ones first and the most
  // recent of those on top — the one you are holding a receipt for.
  const candidates = summaries
    .filter((summary) => summary.leftMinor > 0)
    .filter((summary) =>
      !needle || `${summary.title} ${sourceName.get(summary.plan.paymentSourceId ?? "") ?? ""}`.toLocaleLowerCase("tr").includes(needle),
    )
    .sort((a, b) => Number(b.pending > 0) - Number(a.pending > 0) || b.plan.startMonth.localeCompare(a.plan.startMonth));
  return (
    <>
      <Card>
        <PanelHeader icon={Undo2} title={tr.installments.refundPickTitle} description={tr.installments.refundPickHint} />
        <Field label={tr.installments.refundSearch} value={query} onChangeText={setQuery} noMargin />
      </Card>
      {candidates.length === 0 ? (
        <EmptyState icon={Search} title={tr.installments.refundPickEmpty} hint={tr.installments.refundPickEmptyHint} />
      ) : (
        <CardList
          items={candidates}
          keyExtractor={(summary) => summary.plan.id}
          renderItem={(summary) => (
            <ListRow
              icon={summary.plan.kind === "loan" ? Landmark : CreditCard}
              title={summary.title}
              subtitle={planLine(summary, sourceName)}
              chevron
              onPress={() => onPick(summary.plan.id)}
            />
          )}
        />
      )}
    </>
  );
}

function RefundForm({
  summary,
  sourceName,
  onChangePlan,
}: {
  summary: PlanSummary;
  sourceName: Map<string, string>;
  /** Absent when the screen was opened from the plan itself. */
  onChangePlan: (() => void) | null;
}) {
  const userId = useUserId();
  const router = useRouter();
  const operationGuard = useOperationGuard();
  const [amountRaw, setAmountRaw] = useState("");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [spreadChoice, setSpreadChoice] = useState<"remaining" | "once" | null>(null);
  const [month, setMonth] = useState<MonthKey>(monthKeyOf(todayISO()));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { allowExit } = useDirtyExitGuard(useDraftDirty(JSON.stringify({ amountRaw, spreadChoice, month, note }), true) && !busy);

  // Spreading is the default whenever there is something to spread over: it is
  // how a partial refund of an instalment purchase usually reaches a statement.
  const spread = spreadChoice ?? (summary.pending > 0 ? "remaining" : "once");
  const share = summary.pending > 0 && amountMinor != null && amountMinor > 0
    ? formatMinorCompact(splitIntoInstallments(amountMinor, summary.pending).at(-1)!, summary.plan.currency)
    : null;
  const valid = refundSaveable(summary, amountMinor, spread);
  const preview = refundPreviewLine(summary, amountMinor);

  const save = async () => {
    if (!valid) return;
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        await addInstallmentRefund(userId, summary.plan.id, { amountMinor: amountMinor!, spread, month, note: note.trim() || null });
        scheduleSync(userId);
        allowExit(() => navigateBack(router, "/(tabs)/cash-flow/installments"));
      } catch (error) {
        devError("installment.refund", error);
        void appAlert(refundErrorMessage(error, summary.plan.currency), tr.errors.title);
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <Card>
      <PanelHeader icon={Undo2} title={summary.title} description={planLine(summary, sourceName)} />
      <MoneyField
        label={summary.plan.currency === "TRY" ? tr.installments.refundAmount : `${tr.installments.refundAmount} · ${summary.plan.currency}`}
        value={amountRaw}
        onChangeMinor={(raw, minor) => {
          setAmountRaw(raw);
          setAmountMinor(minor);
        }}
      />
      <Body muted style={{ marginBottom: spacing.md }}>{tr.installments.refundAmountNote}</Body>
      <Body style={{ marginBottom: spacing.sm }}>{tr.installments.refundSpreadLabel}</Body>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={tr.installments.refundSpreadLabel}
        style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md }}
      >
        <ChoiceTile
          label={tr.installments.refundSpreadRemaining}
          description={summary.pending > 0
            ? tr.installments.refundSpreadRemainingHint(summary.pending, share)
            : tr.installments.refundSpreadRemainingNone}
          selected={spread === "remaining"}
          disabled={summary.pending === 0}
          onPress={() => setSpreadChoice("remaining")}
        />
        <ChoiceTile
          label={tr.installments.refundSpreadOnce}
          description={tr.installments.refundSpreadOnceHint}
          selected={spread === "once"}
          onPress={() => setSpreadChoice("once")}
        />
      </View>
      {spread === "once" ? (
        <View style={{ marginBottom: spacing.md }}>
          <Body style={{ marginBottom: spacing.xs }}>{tr.installments.refundMonth}</Body>
          <MonthStepper value={month} onChange={setMonth} />
        </View>
      ) : null}
      <Field label={tr.installments.refundNote} value={note} onChangeText={setNote} />
      {preview ? <Body muted style={{ marginBottom: spacing.md }}>{preview}</Body> : null}
      <Button icon={Undo2} label={tr.installments.refundSave} onPress={() => void save()} disabled={!valid} loading={busy} />
      {onChangePlan ? (
        <View style={{ marginTop: spacing.sm }}>
          <Button label={tr.installments.refundChangePlan} variant="ghost" size="sm" onPress={onChangePlan} disabled={busy} />
        </View>
      ) : null}
    </Card>
  );
}

export default function InstallmentRefundScreen() {
  const { plan: planParam } = useLocalSearchParams<{ plan?: string }>();
  const plansState = usePlansState();
  const sourcesState = useSourcesState();
  const transactionsState = useAllTransactionsState();
  const { status, ready, retry } = combineLiveStates([plansState, sourcesState, transactionsState]);
  const [planChoice, setPlanChoice] = useState<string | null>(planParam ?? null);

  const title = <Stack.Screen options={{ title: tr.installments.refundTitle }} />;
  if (!ready) return <DataGateScreen status={status} retry={retry}>{title}</DataGateScreen>;

  const sourceName = new Map(sourcesState.data.map((source) => [source.id, source.name]));
  const summaries = summarizePlans(plansState.data, transactionsState.data);
  const selected = summaries.find((summary) => summary.plan.id === planChoice);
  return (
    <Screen width="focus">
      {title}
      <DataStateNotice status={status} retry={retry} />
      {selected ? (
        <RefundForm
          key={selected.plan.id}
          summary={selected}
          sourceName={sourceName}
          onChangePlan={planParam ? null : () => setPlanChoice(null)}
        />
      ) : (
        <RefundPlanPicker summaries={summaries} sourceName={sourceName} onPick={setPlanChoice} />
      )}
    </Screen>
  );
}
