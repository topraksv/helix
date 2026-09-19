/**
 * Reconcile the balance to reality. The primary tool is "set current balance":
 * the user types the real total in their account and the difference is stored
 * as one adjustment dated today — the month-by-month chain and every prior
 * month stay exactly as they were. Editing the START MONTH + opening balance
 * (which recomputes the WHOLE table) is demoted to a historical, collapsed
 * section, since doing that was what silently "blew up" the Mali Tablo values.
 *
 * Shared body used by the Settings sub-screen and a top-level modal opened from
 * Mali Tablo, so it always has a working back/close regardless of launch point.
 */

import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import ArrowRight from "lucide-react-native/icons/arrow-right";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import History from "lucide-react-native/icons/rotate-ccw-clock";
import Info from "lucide-react-native/icons/info";
import Scale from "lucide-react-native/icons/scale";
import Trash from "lucide-react-native/icons/trash";
import { declareMonthOpeningBalance, deleteBalanceAdjustment, restoreBalanceAdjustment, setBalanceDeclaration, setCurrentBalance, setOpeningBalance } from "../data/repo";
import { settingValue, useAdjustmentsState, useLedgerState, useSettingsMapState, useTxLike, useUserId } from "../data/hooks";
import { combineLiveStates } from "../data/live-state";
import { scheduleSync } from "../sync/engine";
import { addMonthsToKey, isCurrentOrFutureMonth, monthKeyOf, todayISO, yearOf, type MonthKey } from "../domain/dates";
import { balanceDeclarationDrift, driftCandidates, parseBalanceDeclaration } from "../domain/balance-declaration";
import { formatMinorCompact, formatMinorInput } from "../domain/money";
import { dateLabel, monthLabel, tr } from "../i18n/tr";
import { Amount, Badge, Body, Button, Card, CardList, DataStateNotice, EmptyState, FadeIn, IconButton, ListRow, MoneyField, MonthStepper, PanelHeader, Row, Screen, SectionHeader, Spread } from "./components";
import { appAlert } from "./dialog";
import { errorNotice, successNotice } from "./haptics";
import { userMessage } from "../domain/user-error";
import { devError } from "../services/logger";
import { circle, radius, spacing, type, useTheme } from "./theme";
import { useUndo } from "./undo";
import { navigateBack } from "./navigation";
import { useDirtyExitGuard } from "./dirty-exit";
import { WorkspaceSplit } from "./workspace-layout";

function BalanceBridge({
  computedMinor,
  targetMinor,
}: {
  computedMinor: number;
  targetMinor: number;
}) {
  const { palette } = useTheme();
  const differenceMinor = targetMinor - computedMinor;
  const changed = differenceMinor !== 0;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${tr.settings.computedBalance}: ${formatMinorCompact(computedMinor)}. ${tr.settings.balanceDifference}: ${formatMinorCompact(differenceMinor)}. ${tr.settings.realBalance}: ${formatMinorCompact(targetMinor)}.`}
      style={{
        flexDirection: "row",
        alignItems: "stretch",
        gap: spacing.sm,
        marginBottom: spacing.lg,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, justifyContent: "center" }}>
        <Body muted style={{ fontSize: type.micro.fontSize, marginBottom: spacing.xs }}>{tr.settings.computedBalance}</Body>
        <Amount minor={computedMinor} colorized={false} style={{ fontSize: type.label.fontSize, textAlign: "left" }} />
      </View>
      <View
        style={{
          width: 82,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.md,
          backgroundColor: changed ? palette.warning + "14" : palette.surfaceAlt,
          paddingHorizontal: spacing.xs,
          paddingVertical: spacing.sm,
        }}
      >
        <ArrowRight accessible={false} size={15} color={changed ? palette.warningText : palette.textSecondary} />
        <Amount
          minor={differenceMinor}
          color={differenceMinor > 0 ? palette.positiveText : differenceMinor < 0 ? palette.negativeText : palette.text}
          style={{ fontSize: type.caption.fontSize, marginTop: 2 }}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0, justifyContent: "center", alignItems: "flex-end" }}>
        <Body muted style={{ fontSize: type.micro.fontSize, marginBottom: spacing.xs, textAlign: "right" }}>{tr.settings.realBalance}</Body>
        <Amount minor={targetMinor} colorized={false} style={{ fontSize: type.label.fontSize }} />
      </View>
    </View>
  );
}

type Bundle = NonNullable<ReturnType<typeof useLedgerState>["data"]>;
type Adjustment = ReturnType<typeof useAdjustmentsState>["data"][number];

/**
 * A money field that shows a stored figure until the owner types over it.
 * Pristine means mirroring the store, so the field never shows a stale
 * first-render snapshot of a figure that loads later.
 */
function useMirroredAmount(stored: number | null) {
  const [draft, setDraft] = useState<{ raw: string; minor: number | null } | null>(null);
  const minor = draft ? draft.minor : stored;
  return {
    value: draft?.raw ?? (stored == null ? "" : formatMinorInput(stored)),
    minor,
    touched: draft != null,
    changed: stored != null && minor != null && minor !== stored,
    onChange: (raw: string, next: number | null) => setDraft({ raw, minor: next }),
    reset: () => setDraft(null),
  };
}

/** The primary tool: type what the account really holds, stored as one adjustment dated today. */
function useCurrentBalanceForm(computed: number | null) {
  const userId = useUserId();
  const undo = useUndo();
  const target = useMirroredAmount(computed);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (computed == null || target.minor == null || !target.changed) return;
    setSaving(true);
    try {
      // The note carries what the delta cannot: an adjustment row stores only
      // the difference, so "+₺95.000,00" on its own never said what the balance
      // went from or to.
      await setCurrentBalance(userId, target.minor, computed, tr.settings.balanceAdjustmentNote(formatMinorCompact(computed), formatMinorCompact(target.minor)));
      // Remember what was confirmed, not just the delta that made it true. It
      // is the only way a later screen can say "you told me this on that day".
      await setBalanceDeclaration(userId, target.minor, todayISO());
      scheduleSync(userId);
      successNotice();
      // Stays put: correcting a balance is usually followed by looking at what
      // it did to the history right below. The field re-derives from the new
      // computed balance once the draft is dropped.
      target.reset();
      undo.show(tr.settings.balanceAdjustmentSaved, null, "success");
    } catch (e) {
      errorNotice();
      devError("balance.current", e);
      void appAlert(userMessage(e, tr.errors.saveFailed), tr.errors.title);
    } finally {
      setSaving(false);
    }
  };
  return { target, saving, save };
}

/** A month's opening, stated (spec §2.7). Unlike the reconciliation it holds: records entered later before that month leave it where it was. */
function useDeclarationForm(bundle: Bundle | null, adjustments: Adjustment[]) {
  const userId = useUserId();
  const undo = useUndo();
  const currentMonth = monthKeyOf(todayISO());
  const [monthChoice, setMonthChoice] = useState<MonthKey | null>(null);
  const month = monthChoice ?? currentMonth;
  const opening = bundle?.ledger.find((entry) => entry.month === month)?.openingMinor ?? null;
  const amount = useMirroredAmount(opening);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!bundle || !amount.changed || amount.minor == null || opening == null) return;
    setSaving(true);
    try {
      const existing = adjustments.find((row) => row.declaredMinor != null && declaredMonthOf(row.date) === month);
      // What the month opened with before any declaration of its own, which is
      // what the stored difference is measured from.
      const undeclared = opening - (existing ? bundle.declarationDeltaById.get(existing.id) ?? 0 : 0);
      const before = existing ? { declaredMinor: existing.declaredMinor!, amountMinor: existing.amountMinor } : null;
      const id = await declareMonthOpeningBalance(userId, month, amount.minor, amount.minor - undeclared);
      scheduleSync(userId);
      amount.reset();
      undo.show(tr.settings.declarationSaved, () => (before
        ? declareMonthOpeningBalance(userId, month, before.declaredMinor, before.amountMinor)
        : deleteBalanceAdjustment(userId, id)
      ).then(() => scheduleSync(userId)));
    } catch (e) {
      devError("balance.declaration", e);
      void appAlert(userMessage(e, tr.errors.saveFailed), tr.errors.title);
    } finally {
      setSaving(false);
    }
  };
  return {
    month,
    currentMonth,
    amount,
    saving,
    save,
    choose: (next: MonthKey) => {
      setMonthChoice(next);
      amount.reset();
    },
  };
}

/** The historical anchor: rarely needed, but necessary when the setup month or balance was wrong. Kept apart from today's reconciliation. */
function useOpeningForm(settings: ReturnType<typeof useSettingsMapState>["data"]) {
  const userId = useUserId();
  const currentStart = settingValue<string>(settings, "start_month", monthKeyOf(todayISO()));
  const currentOpening = settingValue<number>(settings, "opening_balance_minor", 0);
  const [startChoice, setStartChoice] = useState<string | null>(null);
  const opening = useMirroredAmount(currentOpening);
  const [saving, setSaving] = useState(false);
  const startMonth = startChoice ?? currentStart;
  /** Whether the anchor was written; the whole table recomputes from it, so the screen closes after. */
  const save = async (): Promise<boolean> => {
    if (opening.minor == null) return false;
    setSaving(true);
    try {
      await setOpeningBalance(userId, startMonth, opening.minor);
      scheduleSync(userId);
      return true;
    } catch (e) {
      devError("balance.opening", e);
      void appAlert(userMessage(e, tr.errors.saveFailed), tr.errors.title);
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { startMonth, setStartChoice, opening, saving, save, dirty: opening.minor !== currentOpening || startMonth !== currentStart };
}

const declaredMonthOf = (date: string) => addMonthsToKey(monthKeyOf(date), 1);

function CurrentBalanceCard({ form, bundle, settings }: { form: ReturnType<typeof useCurrentBalanceForm>; bundle: Bundle; settings: ReturnType<typeof useSettingsMapState>["data"] }) {
  const { palette } = useTheme();
  const router = useRouter();
  const computed = bundle.actualBalanceMinor;
  const { target } = form;
  // What the user last confirmed against a real account, and how far the ledger
  // has moved since. Every other surface links here when this is set.
  const declaration = parseBalanceDeclaration(settingValue<unknown>(settings, "balance_declared", null));
  const drift = balanceDeclarationDrift(declaration, computed);
  // Saying how far off the table is leaves the reason to memory. These are the
  // rows the app can see and a person cannot hold in their head: dated in the
  // past, still unconfirmed, and pointing the way the drift points.
  const transactions = useTxLike();
  const driftRows = drift == null ? [] : driftCandidates(drift, transactions, todayISO());
  return (
    <Card>
      <PanelHeader
        icon={Scale}
        title={tr.settings.realBalance}
        description={tr.settings.currentBalanceFormHint}
        right={(
          <Badge
            text={target.changed ? tr.settings.balanceChangeReady : drift != null ? tr.settings.balanceDriftShort : tr.settings.balanceMatchesShort}
            tone={target.changed || drift != null ? "warning" : "success"}
          />
        )}
      />
      {drift != null && declaration ? (
        // The whole point of keeping the declaration: say the two numbers out
        // loud, with the date the user confirmed one of them.
        <View style={{ marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.warning + "16", borderWidth: StyleSheet.hairlineWidth, borderColor: palette.warning + "70" }}>
          <Text style={[type.label, { color: palette.warningText }]}>{tr.settings.balanceDriftTitle}</Text>
          <Body muted style={{ marginTop: spacing.xs }}>
            {tr.settings.balanceDriftBody(formatMinorCompact(declaration.minor), formatMinorCompact(computed), dateLabel(declaration.at))}
          </Body>
        </View>
      ) : null}
      {driftRows.length > 0 ? (
        // In their own card rather than inside the warning: that block states the
        // problem and this one offers a way in, the pair every other surface makes.
        <>
          <SectionHeader>{tr.settings.balanceDriftCandidates}</SectionHeader>
          <Card>
            <Body muted style={{ fontSize: type.small.fontSize, marginBottom: spacing.sm }}>{tr.settings.balanceDriftCandidatesHint}</Body>
            <CardList
              items={driftRows}
              keyExtractor={(candidate) => candidate.id}
              renderItem={(candidate) => (
                <ListRow
                  title={dateLabel(candidate.date)}
                  right={<Amount minor={candidate.effectMinor} />}
                  chevron
                  onPress={() => router.push({ pathname: "/transaction", params: { id: candidate.id } })}
                />
              )}
            />
          </Card>
        </>
      ) : null}
      <MoneyField label={tr.settings.realBalance} value={target.value} onChangeMinor={target.onChange} />
      <BalanceBridge computedMinor={computed} targetMinor={target.minor ?? computed} />
      <Row gap={spacing.sm} style={{ alignItems: "flex-start", padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.surfaceAlt, marginBottom: spacing.md }}>
        <Info accessible={false} size={17} color={palette.primaryText} style={{ marginTop: 2 }} />
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Body muted style={{ fontSize: type.small.fontSize }}>{tr.settings.balanceScopeHint}</Body>
          <Body muted style={{ fontSize: type.small.fontSize }}>{tr.settings.balanceWillMark}</Body>
        </View>
      </Row>
      <Button label={tr.common.save} onPress={() => void form.save()} disabled={!target.changed} loading={form.saving} haptic="none" />
    </Card>
  );
}

function DeclarationCard({ form, bundle }: { form: ReturnType<typeof useDeclarationForm>; bundle: Bundle }) {
  // The start month's opening IS the anchor; the historical section edits it.
  const firstDeclarable = addMonthsToKey(bundle.startMonth, 1);
  return (
    <>
      <SectionHeader>{tr.settings.declarationTitle}</SectionHeader>
      <Card>
        <Body muted style={{ fontSize: type.small.fontSize, marginBottom: spacing.md }}>{tr.settings.declarationHint}</Body>
        {firstDeclarable <= form.currentMonth ? (
          <>
            <MonthStepper value={form.month} onChange={form.choose} min={firstDeclarable} max={form.currentMonth} />
            <MoneyField label={tr.settings.declarationAmount(monthLabel(form.month))} value={form.amount.value} onChangeMinor={form.amount.onChange} />
            <Button label={tr.settings.declarationSave} onPress={() => void form.save()} disabled={!form.amount.changed} loading={form.saving} />
          </>
        ) : (
          <Body muted>{tr.settings.declarationUnavailable}</Body>
        )}
      </Card>
    </>
  );
}

function AdjustmentList({ adjustments, bundle }: { adjustments: Adjustment[]; bundle: Bundle }) {
  const userId = useUserId();
  const undo = useUndo();
  const rows = [...adjustments].sort((a, b) => b.date.localeCompare(a.date));
  const remove = async (id: string) => {
    try {
      const snapshot = await deleteBalanceAdjustment(userId, id);
      if (!snapshot) return;
      scheduleSync(userId);
      undo.show(tr.settings.balanceAdjustmentDeleted, () => restoreBalanceAdjustment(userId, snapshot).then(() => scheduleSync(userId)), "warning");
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
  };
  return (
    <>
      <SectionHeader>{tr.settings.balanceAdjustmentsTitle}</SectionHeader>
      <Body muted style={{ fontSize: type.small.fontSize, marginBottom: spacing.md }}>{tr.settings.balanceAdjustmentsHint}</Body>
      <CardList
        items={rows}
        keyExtractor={(adjustment) => adjustment.id}
        renderItem={(adjustment) => {
          const declared = adjustment.declaredMinor;
          return (
            <Spread>
              <View style={{ flex: 1, paddingRight: spacing.md }}>
                <Body>{declared != null ? tr.settings.declarationRow(monthLabel(declaredMonthOf(adjustment.date))) : dateLabel(adjustment.date)}</Body>
                <Body muted style={{ fontSize: type.small.fontSize }}>
                  {declared != null
                    ? [tr.settings.declarationRowHint(formatMinorCompact(declared)), adjustment.note].filter(Boolean).join(" · ")
                    : adjustment.note ?? tr.settings.balanceAdjustmentFallback}
                </Body>
              </View>
              <Row gap={spacing.sm}>
                {/* A declaration's stored amount is the difference on the day it
                    was written; what it corrects now is recomputed. */}
                <Amount minor={declared != null ? bundle.declarationDeltaById.get(adjustment.id) ?? adjustment.amountMinor : adjustment.amountMinor} />
                <IconButton icon={Trash} tone="danger" label={`${tr.common.delete} · ${dateLabel(adjustment.date)}`} haptic="none" onPress={() => void remove(adjustment.id)} />
              </Row>
            </Spread>
          );
        }}
      />
      {rows.length === 0 ? <EmptyState icon={History} title={tr.settings.noBalanceAdjustments} hint={tr.settings.noBalanceAdjustmentsHint} /> : null}
    </>
  );
}

function HistoricalOpeningCard({ form, onSaved }: { form: ReturnType<typeof useOpeningForm>; onSaved: () => void }) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  const { startMonth } = form;
  return (
    <>
      <SectionHeader>{tr.settings.historyOpeningTitle}</SectionHeader>
      <Card>
        <Row gap={spacing.md} style={{ alignItems: "flex-start", marginBottom: open ? spacing.lg : spacing.md }}>
          <View accessible={false} style={{ width: 36, height: 36, borderRadius: circle(36), alignItems: "center", justifyContent: "center", backgroundColor: palette.surfaceAlt }}>
            <History accessible={false} size={18} color={palette.textSecondary} />
          </View>
          <Body muted style={{ flex: 1 }}>{open ? tr.settings.historyOpeningHint : tr.settings.historyOpeningSummary}</Body>
          {open ? <Button label={tr.common.close} variant="ghost" size="sm" onPress={() => setOpen(false)} /> : null}
        </Row>
        {open ? (
          <FadeIn>
            <Body muted style={{ marginBottom: spacing.sm }}>{tr.onboarding.startMonth}</Body>
            <Spread style={{ marginBottom: spacing.lg }}>
              <IconButton icon={ChevronLeft} label={tr.onboarding.startMonth} onPress={() => form.setStartChoice(addMonthsToKey(startMonth, -1))} />
              <Body style={{ fontSize: type.heading.fontSize }}>{monthLabel(startMonth)}</Body>
              <IconButton icon={ChevronRight} label={tr.onboarding.startMonth} disabled={isCurrentOrFutureMonth(startMonth)} onPress={() => form.setStartChoice(addMonthsToKey(startMonth, 1))} />
            </Spread>
            <MoneyField label={tr.onboarding.openingBalance} value={form.opening.value} onChangeMinor={form.opening.onChange} />
            <Button label={tr.common.save} onPress={() => void form.save().then((saved) => saved && onSaved())} disabled={!form.dirty || form.opening.minor == null} loading={form.saving} />
          </FadeIn>
        ) : (
          <Button label={tr.settings.historyOpeningAction} onPress={() => setOpen(true)} />
        )}
      </Card>
    </>
  );
}

export function OpeningBalanceEditor() {
  const router = useRouter();
  const settingsState = useSettingsMapState();
  const ledgerState = useLedgerState(yearOf(todayISO()));
  const adjustmentsState = useAdjustmentsState();
  const bundle = ledgerState.data;
  const { status, ready, retry } = combineLiveStates([settingsState, ledgerState, adjustmentsState]);
  const current = useCurrentBalanceForm(bundle?.actualBalanceMinor ?? null);
  const declaration = useDeclarationForm(bundle, adjustmentsState.data);
  const opening = useOpeningForm(settingsState.data);
  const { allowExit } = useDirtyExitGuard(
    (current.target.changed || opening.dirty || declaration.amount.touched) && !current.saving && !opening.saving && !declaration.saving,
  );

  // Never let the async ledger's pre-load fallback masquerade as a real zero
  // balance; the editor becomes actionable only after its accounting inputs load.
  //
  // What is NOT a reason to withhold it: an unset opening balance. This branch
  // used to synthesise an "error" status from a null computed balance and tell
  // the owner their finance data could not be read — on the one screen that can
  // set the anchor whose absence produced the null.
  if (!ready || bundle == null) {
    return (
      <Screen>
        <DataStateNotice status={status} retry={retry} />
      </Screen>
    );
  }
  return (
    <Screen width="workspace">
      <DataStateNotice status={status} retry={retry} />
      <WorkspaceSplit
        testID="balance-workspace"
        primary={<CurrentBalanceCard form={current} bundle={bundle} settings={settingsState.data} />}
        secondary={(
          <View>
            <DeclarationCard form={declaration} bundle={bundle} />
            <AdjustmentList adjustments={adjustmentsState.data} bundle={bundle} />
            <HistoricalOpeningCard form={opening} onSaved={() => allowExit(() => navigateBack(router, "/(tabs)/cash-flow"))} />
          </View>
        )}
      />
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}
