/**
 * Spreadsheet import wizard: pick an .xlsx/.xlsm/.csv → see a visual, example-
 * rich format guide → choose which years/columns to bring → import 1:1 into the
 * Mali Tablo (spec §3.1e). Handles multi-year workbooks (each year keeps its
 * own columns), formula/comment breakdowns, opening balance, and re-import of a
 * year that already has data. Parsing/mapping lives in
 * services/spreadsheet-import + data/repo; this screen only guides and
 * confirms.
 */

import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import CheckCircle2 from "lucide-react-native/icons/circle-check";
import FileSpreadsheet from "lucide-react-native/icons/file-spreadsheet";
import Scale from "lucide-react-native/icons/scale";
import { ImportArtwork, ImportJourney } from "../ui/import-journey";
import TableProperties from "lucide-react-native/icons/table-properties";
import Download from "lucide-react-native/icons/download";
import Upload from "lucide-react-native/icons/upload";
import * as Sharing from "expo-sharing";
import { saveBinaryFile } from "../services/export-import";
import { buildTemplateBytes, WORKBOOK_MIME } from "../services/workbook-export";
import { appAlert } from "../ui/dialog";
import { ImportBatchUnreadableError, importSheets, importedYears, importWorkbookRecords, openingBalanceFromSheets, planWorkbookRecords, type RecordImportPlan } from "../data/repo";
import type { RecordProblem } from "../domain/workbook-format";
import { settingValue, usePersonsState, useSettingsMapState, useSourcesState, useUserId } from "../data/hooks";
import { combineLiveStates } from "../data/live-state";
import { isMonthDay, yearOf, type MonthKey } from "../domain/dates";
import { formatMinorCompact } from "../domain/money";
import { monthLabel, tr } from "../i18n/tr";
import { collectInstallmentPlans, MAX_WORKBOOK_BYTES, parseWorkbookBytes, type CellData, type ParsedSheet, type ParsedWorkbook } from "../services/spreadsheet-import";
import { scheduleSync } from "../sync/engine";
import { userMessage } from "../domain/user-error";
import { Amount, Body, Button, Card, DataGateScreen, DataStateNotice, FieldNote, OperationStatusNotice, PanelHeader, Row, Screen, SectionHeader, SelectionGrid, Spread, Toggle } from "../ui/components";
import { Select } from "../ui/selection-controls";
import { circle, font, radius, spacing, type, type Palette, useTheme } from "../ui/theme";
import { navigateBack } from "../ui/navigation";
import { OperationCancelledError, useTrackedOperation, type TrackedOperationContext } from "../ui/operation-guard";
import { useDirtyExitGuard } from "../ui/dirty-exit";
import { shouldUseWideImportGuide } from "../ui/responsive";
import { useContentWidth } from "../ui/viewport";
import { readPickedBytes } from "../services/picked-file";
import { CardCycleFields, cardCycleError } from "../ui/card-cycle-fields";
import { devError } from "../services/logger";

// --- visual format guide ---------------------------------------------------
function WorkbookArtwork({ ready }: { ready: boolean }) {
  const { palette } = useTheme();
  return (
    <ImportArtwork ready={ready} destinationIcon={TableProperties}>
      <View style={{ flexDirection: "row", gap: 3, marginBottom: 4 }}>
        {[palette.positive, palette.warning, palette.negative].map((color) => (
          <View key={color} style={{ width: 6, height: 6, borderRadius: circle(6), backgroundColor: color }} />
        ))}
      </View>
      {Array.from({ length: 4 }).map((_, row) => (
        <View key={row} style={{ flexDirection: "row" }}>
          {Array.from({ length: 3 }).map((__, column) => (
            <View
              key={column}
              style={{
                width: 22,
                height: 14,
                borderRightWidth: 1,
                borderBottomWidth: 1,
                borderColor: palette.border + "90",
                backgroundColor: row === 0 || column === 0 ? palette.surfaceAlt : "transparent",
              }}
            />
          ))}
        </View>
      ))}
    </ImportArtwork>
  );
}

function MiniCell({ text, tone, palette, big }: { text?: string; tone: "month" | "head" | "data"; palette: Palette; big: boolean }) {
  const bg = tone === "month" ? palette.primarySoft : tone === "head" ? palette.surfaceAlt : palette.surface;
  const color = tone === "month" ? palette.primaryText : palette.textSecondary;
  return (
    <View
      style={{
        width: big ? 74 : 46,
        height: big ? 40 : 26,
        borderWidth: 1,
        borderColor: palette.border,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg,
      }}
    >
      <Text style={{ fontSize: big ? type.label.fontSize : type.micro.fontSize, color, fontFamily: font.semibold }}>
        {text ?? "·"}
      </Text>
    </View>
  );
}

function SheetLayoutDiagram({ orientation, caption, big }: { orientation: "vertical" | "horizontal"; caption: string; big: boolean }) {
  const { palette } = useTheme();
  const M = (text: string) => ({ text, tone: "month" as const });
  const H = (text: string) => ({ text, tone: "head" as const });
  const D = { tone: "data" as const };
  const grid =
    orientation === "vertical"
      ? [
          [{ tone: "data" as const }, H(tr.importer.diagram.rent), H(tr.importer.diagram.salary)],
          [M(tr.importer.diagram.january), D, D],
          [M(tr.importer.diagram.february), D, D],
        ]
      : [
          [{ tone: "data" as const }, M(tr.importer.diagram.january), M(tr.importer.diagram.february)],
          [H(tr.importer.diagram.rent), D, D],
          [H(tr.importer.diagram.salary), D, D],
        ];
  return (
    <View
      style={{
        flex: big ? 1 : undefined,
        width: big ? undefined : "100%",
        alignItems: "center",
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: radius.md,
        backgroundColor: palette.surfaceAlt,
        borderWidth: 1,
        borderColor: palette.border + "70",
      }}
    >
      <View style={{ borderRadius: radius.sm, overflow: "hidden" }}>
        {grid.map((r, ri) => (
          <View key={ri} style={{ flexDirection: "row" }}>
            {r.map((cell, ci) => (
              <MiniCell key={ci} text={"text" in cell ? cell.text : undefined} tone={cell.tone} palette={palette} big={big} />
            ))}
          </View>
        ))}
      </View>
      <Text style={[big ? type.body : type.small, { color: palette.text, textAlign: "center", fontFamily: font.medium }]}>{caption}</Text>
    </View>
  );
}

function ExampleRow({ label, value }: { label: string; value: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", marginBottom: spacing.xs, flexWrap: "wrap" }}>
      <Text style={[type.small, { color: palette.primaryText, fontFamily: font.semibold, width: 78 }]}>{label}</Text>
      <Text style={[type.small, { color: palette.textSecondary, flex: 1, minWidth: 180 }]}>{value}</Text>
    </View>
  );
}

function FormatGuide({ wide }: { wide: boolean }) {
  const { palette } = useTheme();
  return (
    <Card>
      <SectionHeader>{tr.importer.guideTitle}</SectionHeader>
      <Body muted style={{ marginBottom: spacing.lg }}>{tr.importer.guideLead}</Body>
      <View style={{ flexDirection: wide ? "row" : "column", gap: spacing.xl, justifyContent: "center", alignItems: "center", marginBottom: spacing.xl }}>
        <SheetLayoutDiagram orientation="vertical" caption={tr.importer.layoutVertical} big={wide} />
        <SheetLayoutDiagram orientation="horizontal" caption={tr.importer.layoutHorizontal} big={wide} />
      </View>

      <View style={{ flexDirection: wide ? "row" : "column", gap: spacing.xl }}>
        <View style={{ flex: wide ? 1 : undefined }}>
          <Text style={[type.label, { color: palette.text, marginBottom: spacing.sm }]}>{tr.importer.examplesTitle}</Text>
          <ExampleRow label={tr.importer.exMonthsLabel} value={tr.importer.exMonths} />
          <ExampleRow label={tr.importer.exAmountsLabel} value={tr.importer.exAmounts} />
          <ExampleRow label={tr.importer.exFormulaLabel} value={tr.importer.exFormula} />
        </View>
        <View style={{ flex: wide ? 1 : undefined }}>
          <Text style={[type.label, { color: palette.text, marginBottom: spacing.sm }]}>{tr.importer.autoTitle}</Text>
          {[tr.importer.auto1, tr.importer.auto2, tr.importer.auto3].map((line) => (
            <View key={line} style={{ flexDirection: "row", marginBottom: spacing.xs }}>
              <Text style={[type.small, { color: palette.primaryText, marginRight: spacing.xs }]}>•</Text>
              <Text style={[type.small, { color: palette.textSecondary, flex: 1 }]}>{line}</Text>
            </View>
          ))}
        </View>
      </View>
    </Card>
  );
}

/**
 * The way in for someone who has no spreadsheet to import yet.
 *
 * The wizard's whole guide above is about recognising a budget sheet the owner
 * ALREADY keeps. That leaves the other half of the room with nothing to do,
 * and "make a table we will accept" is not an instruction anyone can follow
 * from prose. So the shape is handed over as a file instead: three named
 * sheets, a hint under every heading, and one worked row.
 *
 * It is deliberately three lines and a button. The file explains itself once
 * it is open, so explaining it twice here would be the longer, worse version
 * of the same thing.
 */
function TemplateCard() {
  const { palette } = useTheme();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const path = await saveBinaryFile("helix-sablon.xlsx", await buildTemplateBytes(), WORKBOOK_MIME);
      if (path && (await Sharing.isAvailableAsync())) await Sharing.shareAsync(path, { mimeType: WORKBOOK_MIME });
    } catch (error) {
      devError("importer.template", error);
      void appAlert(tr.errors.requestFailed, tr.errors.title);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ marginTop: spacing.md }}>
      <SectionHeader>{tr.importer.templateTitle}</SectionHeader>
      <Body muted style={{ marginBottom: spacing.lg }}>{tr.importer.templateLead}</Body>
      <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
        {tr.importer.templateSteps.map((step, index) => (
          <Row key={step} gap={spacing.sm} style={{ alignItems: "flex-start" }}>
            <View
              style={{
                width: STEP_MARK,
                height: STEP_MARK,
                borderRadius: radius.full,
                backgroundColor: palette.primarySoft,
                alignItems: "center",
                justifyContent: "center",
                marginTop: 1,
              }}
            >
              <Text style={[type.small, { color: palette.primaryText }]}>{index + 1}</Text>
            </View>
            <Text style={[type.small, { color: palette.textSecondary, flex: 1 }]}>{step}</Text>
          </Row>
        ))}
      </View>
      <Body muted style={{ fontSize: type.small.fontSize, marginBottom: spacing.md }}>
        {tr.importer.templateNote}
      </Body>
      <Button
        icon={Download}
        label={tr.importer.templateDownload}
        variant="secondary"
        onPress={() => void download()}
        loading={busy}
        disabled={busy}
      />
    </Card>
  );
}

const STEP_MARK = 20;

const hasBreakdown = (c: CellData) => Boolean(c.formulaParts || c.comment);

/** How many unreadable rows are listed by name before the rest are counted. */
const LISTED_PROBLEMS = 5;

const hasRecords = (wb: ParsedWorkbook): boolean => wb.records.subscriptions.length + wb.records.investments.length > 0;

function RecordProblems({ problems }: { problems: RecordProblem[] }) {
  const { palette } = useTheme();
  if (problems.length === 0) return null;
  return (
    <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
      {problems.slice(0, LISTED_PROBLEMS).map((problem) => (
        <Text key={`${problem.sheet}-${problem.row}`} style={[type.small, { color: palette.errorText }]}>
          {tr.importer.recordsProblem(problem.sheet, problem.row, problem.column)}
        </Text>
      ))}
      {problems.length > LISTED_PROBLEMS ? (
        <Text style={[type.small, { color: palette.textSecondary }]}>{tr.importer.recordsMoreProblems(problems.length - LISTED_PROBLEMS)}</Text>
      ) : null}
    </View>
  );
}

/** What the record sheets will do, said before anything is written. */
function RecordsCard({ plan }: { plan: RecordImportPlan }) {
  return (
    <Card>
      <SectionHeader>{tr.importer.recordsTitle}</SectionHeader>
      <Body muted style={{ marginBottom: spacing.sm }}>{tr.importer.recordsHint}</Body>
      <Body>{tr.importer.recordsCounts(tr.importer.recordsSubscriptions, plan.subscriptions)}</Body>
      <Body>{tr.importer.recordsCounts(tr.importer.recordsInvestments, plan.investments)}</Body>
      {plan.walletMissing ? <Body muted style={{ marginTop: spacing.sm }}>{tr.importer.recordsWalletMissing}</Body> : null}
      <RecordProblems problems={plan.problems} />
    </Card>
  );
}

// --- screen ----------------------------------------------------------------
type CycleDraft = { statementDay: string; dueDay: string };

/**
 * The cards a workbook's instalment notes name, and the cycle the owner gives
 * each. A card the workspace already holds opens with its own days.
 */
function useCardCycles(sheets: ParsedSheet[], workbook: ParsedWorkbook | null, excluded: string[], selectedYears: number[]) {
  const sources = useSourcesState().data;
  const [drafts, setDrafts] = useState<Record<string, CycleDraft>>({});
  const normalized = (name: string) => name.trim().toLocaleLowerCase("tr-TR");
  const cards = [...new Set(
    collectInstallmentPlans(sheets, {
      excludedLabels: excluded,
      informationalCards: workbook?.informationalCards ?? [],
      yearAllowed: (year) => selectedYears.includes(year),
    }).map((plan) => plan.card),
  )];
  const draftOf = (card: string): CycleDraft => {
    const existing = sources.find((source) => source.type === "credit_card" && normalized(source.name) === normalized(card));
    return drafts[card] ?? { statementDay: existing?.statementDay == null ? "" : String(existing.statementDay), dueDay: existing?.dueDay == null ? "" : String(existing.dueDay) };
  };
  const filled = (cycle: CycleDraft) => cycle.statementDay.trim() !== "" && cycle.dueDay.trim() !== "";
  return {
    cards,
    draftOf,
    change: (card: string, next: Partial<CycleDraft>) => setDrafts((current) => ({ ...current, [card]: { ...draftOf(card), ...next } })),
    reset: () => setDrafts({}),
    // Blank is an answer: a card whose cycle nobody knows still imports, and its
    // instalments fall on their own months. A HALF-filled pair is not, and the
    // importer creates real cards, so a pair it accepts must be one the settings screen can reopen.
    valid: cards.every((card) => {
      const cycle = draftOf(card);
      if (cycle.statementDay.trim() === "" && cycle.dueDay.trim() === "") return true;
      return isMonthDay(cycle.statementDay) && isMonthDay(cycle.dueDay) && cardCycleError(Number(cycle.statementDay), Number(cycle.dueDay)) === null;
    }),
    requested: () => Object.fromEntries(cards.map((card) => [card, draftOf(card)] as const).filter(([, cycle]) => filled(cycle))
      .map(([card, cycle]) => [card, { statementDay: Number(cycle.statementDay), dueDay: Number(cycle.dueDay) }])),
  };
}

type CardCycles = ReturnType<typeof useCardCycles>;

/** Every column of the sheets being imported, by first-seen kind. */
function columnsOf(sheets: ParsedSheet[]) {
  const columns = new Map<string, { label: string; income: boolean; balanceLike: boolean }>();
  for (const column of sheets.flatMap((sheet) => sheet.columns)) {
    if (!columns.has(column.label)) columns.set(column.label, { label: column.label, income: column.kindGuess === "income", balanceLike: column.balanceLike });
  }
  return [...columns.values()];
}

function ImportDoneCard({ count, ledger, plans, records }: { count: number; ledger: boolean; plans: number; records: RecordImportPlan | null }) {
  const router = useRouter();
  const { palette } = useTheme();
  return (
    <>
      <ImportJourney stage={2} fileIcon={FileSpreadsheet} />
      <Card tone="success">
        <Row gap={spacing.md} style={{ alignItems: "center" }}>
          <CheckCircle2 accessible={false} size={26} color={palette.success} />
          <View style={{ flex: 1 }}>
            <Text accessibilityRole="header" style={[type.heading, { color: palette.text }]}>{ledger ? tr.importer.doneTitle(count) : tr.importer.recordsTitle}</Text>
            {ledger ? <Body muted style={{ marginTop: spacing.xs }}>{tr.importer.doneHint}</Body> : null}
            {/* Said out loud: the plans a workbook's instalment notes produce are
                the half of the import nobody can see from the table. */}
            {plans > 0 ? <Body muted style={{ marginTop: spacing.xs }}>{tr.importer.donePlans(plans)}</Body> : null}
            {records ? (
              <>
                <Body muted style={{ marginTop: spacing.xs }}>
                  {tr.importer.recordsDone(records.subscriptions.added + records.subscriptions.updated, records.investments.added + records.investments.updated)}
                </Body>
                {records.walletMissing ? <Body muted style={{ marginTop: spacing.xs }}>{tr.importer.recordsWalletMissing}</Body> : null}
                <RecordProblems problems={records.problems} />
              </>
            ) : null}
          </View>
        </Row>
      </Card>
      <Button icon={CheckCircle2} label={tr.common.done} onPress={() => navigateBack(router, "/(tabs)/cash-flow")} />
    </>
  );
}

function ColumnsPicker({ columns, excluded, onExcluded }: { columns: ReturnType<typeof columnsOf>; excluded: string[]; onExcluded: (next: string[]) => void }) {
  const balanceLike = columns.filter((column) => column.balanceLike);
  return (
    <>
      <SectionHeader>{tr.importer.columnsTitle}</SectionHeader>
      <Body muted style={{ marginBottom: spacing.sm }}>{tr.importer.columnsLead}</Body>
      <Row gap={spacing.sm} style={{ marginBottom: spacing.sm, alignItems: "center" }}>
        <Button label={tr.common.selectAll} variant="ghost" size="sm" disabled={excluded.length === 0} onPress={() => onExcluded([])} />
        <Button label={tr.common.clearAll} variant="ghost" size="sm" disabled={excluded.length >= columns.length} onPress={() => onExcluded(columns.map((c) => c.label))} />
      </Row>
      <SelectionGrid
        options={columns.map((c) => ({ value: c.label, label: `${c.label}${c.income ? " ↑" : ""}${c.balanceLike ? " Σ" : ""}` }))}
        values={columns.map((c) => c.label).filter((label) => !excluded.includes(label))}
        onToggle={(label) => onExcluded(excluded.includes(label) ? excluded.filter((x) => x !== label) : [...excluded, label])}
        searchable
      />
      {/* Said where the decision is made: a running total is off because importing
          it counts the month twice, and this is where a mis-read heading gets put right. */}
      {balanceLike.length > 0 ? (
        <Body muted style={{ marginBottom: spacing.md }}>{tr.importer.balanceColumnsNote(balanceLike.map((column) => column.label).join(", "))}</Body>
      ) : null}
    </>
  );
}

/**
 * The one figure the whole chained ledger hangs off, said out loud before it
 * is written: adopted silently and only on the first import, a wrong anchor
 * could never be put right by re-importing a corrected workbook.
 */
function OpeningCard({ sheets, selectedYears, column, onColumn, adopt, onAdopt }: {
  sheets: ParsedSheet[];
  selectedYears: number[];
  column: string | null;
  onColumn: (column: string | null) => void;
  adopt: boolean;
  onAdopt: (adopt: boolean) => void;
}) {
  const settings = useSettingsMapState().data;
  const choices = [...new Map(
    sheets.flatMap((sheet) => sheet.openingCandidates)
      .filter((candidate) => selectedYears.includes(yearOf(candidate.month)))
      .map((candidate) => [candidate.label, candidate]),
  ).values()];
  // Drawn whenever the sheet HAS columns, not only when the heading rule found
  // one: the workbook whose opening sits under an unreadable heading is the one
  // this choice exists for.
  if (choices.length === 0) return null;
  const opening = openingBalanceFromSheets(sheets, (year: number) => selectedYears.includes(year), column);
  const currentStart = settingValue<MonthKey | null>(settings, "start_month", null);
  // Earlier data wins without being asked, figure or no figure: the ledger
  // back-anchors to the earliest month it holds, and a balance typed at setup
  // is kept as that month's declared opening (spec §3.1e).
  const earlier = opening != null && (currentStart == null || opening.month < currentStart);
  return (
    <Card>
      <PanelHeader icon={Scale} title={tr.importer.openingTitle} description={tr.importer.openingHint} />
      <Select
        label={tr.importer.openingColumn}
        value={column ?? ""}
        // The figure each column would give, beside its name: a heading only its
        // author can read is picked by the number under it.
        options={[{ value: "", label: tr.importer.openingColumnAuto }, ...choices.map((candidate) => ({ value: candidate.label, label: `${candidate.label} · ${formatMinorCompact(candidate.minor)}` }))]}
        onChange={(value) => onColumn(value === "" ? null : value)}
      />
      {opening ? (
        <>
          <Spread style={{ marginTop: spacing.sm, marginBottom: spacing.sm }}>
            <Body>{monthLabel(opening.month)}</Body>
            <Amount minor={opening.minor ?? 0} colorized={false} />
          </Spread>
          {earlier ? (
            <Body muted>{tr.importer.openingEarlier}</Body>
          ) : (
            <FieldNote note={tr.importer.openingAdoptHint(monthLabel(currentStart ?? opening.month))}>
              <Toggle label={tr.importer.openingAdopt} value={adopt} onValueChange={onAdopt} />
            </FieldNote>
          )}
        </>
      ) : (
        <Body muted style={{ marginTop: spacing.sm }}>{tr.importer.openingNone}</Body>
      )}
    </Card>
  );
}

function CardCyclesCard({ cycles }: { cycles: CardCycles }) {
  if (cycles.cards.length === 0) return null;
  return (
    <Card>
      <SectionHeader>{tr.importer.cardCyclesTitle}</SectionHeader>
      <Body muted style={{ marginBottom: spacing.md }}>{tr.importer.cardCyclesHint}</Body>
      {cycles.cards.map((card) => {
        const cycle = cycles.draftOf(card);
        return (
          <View key={card} style={{ marginBottom: spacing.sm }}>
            <Body style={{ marginBottom: spacing.xs }}>{card}</Body>
            <CardCycleFields
              statementDayValue={cycle.statementDay}
              dueDayValue={cycle.dueDay}
              onStatementDayChange={(statementDay) => cycles.change(card, { statementDay })}
              onDueDayChange={(dueDay) => cycles.change(card, { dueDay })}
            />
          </View>
        );
      })}
    </Card>
  );
}

/** The first sheet being imported, as the importer read it. */
function SheetPreview({ sheet }: { sheet: ParsedSheet }) {
  const { palette } = useTheme();
  return (
    <>
      <Body muted style={{ marginBottom: spacing.sm }}>
        {tr.importer.detected(sheet.months.length, sheet.columns.length)}
        {sheet.skippedColumns.length > 0 ? ` ${tr.importer.skipped(sheet.skippedColumns.join(", "))}` : ""}
      </Body>
      <Card padded={false}>
        <ScrollView horizontal>
          <View style={{ padding: spacing.md }}>
            <View style={{ flexDirection: "row" }}>
              <Text style={[type.label, { color: palette.textSecondary, width: 96 }]}>{tr.cashflow.monthHeader}</Text>
              {sheet.columns.map((c) => (
                <Text key={c.label} style={[type.label, { color: palette.textSecondary, width: 108, textAlign: "right" }]}>{c.label}</Text>
              ))}
            </View>
            {sheet.months.map((m, r) => (
              <View key={m} style={{ flexDirection: "row", marginTop: spacing.sm }}>
                <Text style={[type.small, { color: palette.text, width: 96 }]}>{monthLabel(m)}</Text>
                {sheet.columns.map((c, i) => {
                  const cell = sheet.cells[r]?.[i];
                  return cell ? (
                    <View key={c.label} style={{ width: 108, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }}>
                      {hasBreakdown(cell) ? <Text style={{ color: palette.primaryText }}>• </Text> : null}
                      {cell.valueMinor != null ? (
                        <Amount minor={cell.valueMinor} colorized={false} color={palette.textSecondary} accessibilityLabel={formatMinorCompact(cell.valueMinor)} style={[type.amountSm, { textAlign: "right" }]} />
                      ) : null}
                    </View>
                  ) : null;
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </Card>
      <Body muted style={{ marginTop: spacing.xs, marginBottom: spacing.md, fontSize: type.small.fontSize }}>{tr.importer.breakdownHint}</Body>
    </>
  );
}

export default function ImportWizardModal() {
  const userId = useUserId();
  const personsState = usePersonsState();
  const sourcesState = useSourcesState();
  const { palette } = useTheme();
  const wide = shouldUseWideImportGuide(useContentWidth());
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reimportYears, setReimportYears] = useState<number[] | null>(null);
  const [recordPlan, setRecordPlan] = useState<RecordImportPlan | null>(null);
  // What was written: a records-only import has no ledger totals to split and no
  // notes to place, so the ledger's own summary would be untrue for it.
  const [done, setDone] = useState<{ count: number; ledger: boolean; plans: number; records: RecordImportPlan | null } | null>(null);
  /** Whether this import may move the ledger's anchor: stated, and a choice. */
  const [adoptOpening, setAdoptOpening] = useState(false);
  /** Which column the month-opening figure comes from; `null` is whatever the heading rule decided. */
  const [openingColumn, setOpeningColumn] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const operation = useTrackedOperation();
  const busy = operation.state.active;
  const { confirmDiscard } = useDirtyExitGuard(workbook != null && done == null && !busy);
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([personsState, sourcesState]);
  // Sheets that contribute at least one month in a selected year.
  const activeSheets = (workbook?.sheets ?? []).filter((s) => s.months.some((m) => selectedYears.includes(yearOf(m))));
  const cycles = useCardCycles(activeSheets, workbook, excluded, selectedYears);

  useEffect(() => {
    if (done == null) return;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
  }, [done]);

  /** One step of the wizard: a cancelled one says nothing, a failed one says why. */
  const attempt = (label: string, work: (context: TrackedOperationContext) => Promise<void>, message = (e: unknown) => userMessage(e, tr.errors.requestFailed)) =>
    operation.run(async (context) => {
      setError(null);
      try {
        await work(context);
      } catch (e) {
        if (e instanceof OperationCancelledError) return;
        devError(label, e);
        setError(message(e));
      }
    });

  const pick = () => attempt("import.pick", async ({ signal }) => {
    setReimportYears(null);
    const picked = await DocumentPicker.getDocumentAsync({
      // Excel only: the screen and its template are Excel's. The parser still
      // reads a CSV, so a file that arrives another way still works.
      type: [
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel.sheet.macroEnabled.12", // xlsm
        "application/vnd.ms-excel.sheet.binary.macroEnabled.12", // xlsb
        "application/vnd.oasis.opendocument.spreadsheet", // ods
      ],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const bytes = await readPickedBytes(picked.assets[0], MAX_WORKBOOK_BYTES, tr.importer.fileTooLarge);
    if (signal.aborted) throw signal.reason;
    const parsed = await parseWorkbookBytes(bytes);
    if (signal.aborted) throw signal.reason;
    if (parsed.sheets.length === 0 && !hasRecords(parsed)) {
      setError(parsed.unparsed[0]?.reason ?? tr.importer.parseError);
      setWorkbook(null);
      return;
    }
    // Said before anything is written, like the ledger's own preview.
    setRecordPlan(hasRecords(parsed) ? await planWorkbookRecords(userId, parsed.records) : null);
    setWorkbook(parsed);
    setSelectedYears(yearsOf(parsed));
    // Balances and running totals start OFF — importing a sum of the columns
    // beside it counts the month twice — and are offered rather than dropped.
    setExcluded([...new Set(parsed.sheets.flatMap((sheet) => sheet.skippedColumns))]);
    setAdoptOpening(false);
    cycles.reset();
  });

  const performImport = async (mode: "replace" | "add", context: TrackedOperationContext) => {
    const selfId = personsState.data.find((p) => p.isSelf)?.id;
    if (!selfId) {
      setError(tr.importer.missingSelf);
      return;
    }
    if (selectedYears.length === 0) return;
    setReimportYears(null);
    context.report(1, 4);
    const request = {
      sheets: activeSheets,
      excludedLabels: excluded,
      selectedYears,
      selfId,
      mode,
      informationalCards: workbook?.informationalCards ?? [],
      adoptOpeningBalance: adoptOpening,
      openingColumnLabel: openingColumn,
      cardCycles: cycles.requested(),
    };
    context.report(2, 4);
    if (context.signal.aborted) throw context.signal.reason;
    setCommitting(true);
    const { result, records } = await importSheets(userId, request)
      .then(async (result) => ({ result, records: workbook && hasRecords(workbook) ? await importWorkbookRecords(userId, workbook.records) : null }))
      .finally(() => setCommitting(false));
    context.report(3, 4);
    scheduleSync(userId);
    context.report(4, 4);
    setDone({ count: result.imported, ledger: true, plans: result.plans, records });
  };

  const startImport = () => attempt("import.start", async (context) => {
    if (selectedYears.length === 0) return;
    const already = await importedYears(userId, selectedYears);
    if (context.signal.aborted) throw context.signal.reason;
    if (already.length > 0) setReimportYears(already.sort((a, b) => a - b));
    else await performImport("add", context);
  });

  /** A workbook holding only the record sheets: no year to choose, nothing of the ledger to write. */
  const importRecordsOnly = () => attempt("import.records", async () => {
    if (!workbook || !hasRecords(workbook)) return;
    setCommitting(true);
    const outcome = await importWorkbookRecords(userId, workbook.records).finally(() => setCommitting(false));
    scheduleSync(userId);
    const written = outcome.subscriptions.added + outcome.subscriptions.updated + outcome.investments.added + outcome.investments.updated;
    setDone({ count: written, ledger: false, plans: 0, records: outcome });
  });

  // A refused replace is a precise, actionable condition — never a raw engine
  // message, and never a silent downgrade to "add".
  const doImport = (mode: "replace" | "add") => attempt("import.run", (context) => performImport(mode, context), (e) =>
    e instanceof ImportBatchUnreadableError ? tr.importer.batchUnreadable(e.years.join(", ")) : userMessage(e, tr.errors.requestFailed));

  if (!dataReady) return <DataGateScreen status={dataStatus} retry={retryData} scrollRef={scrollRef} width="workspace" />;
  if (done != null) {
    return (
      <Screen scrollRef={scrollRef} width="workspace">
        <ImportDoneCard count={done.count} ledger={done.ledger} plans={done.plans} records={done.records} />
      </Screen>
    );
  }

  const years = workbook ? yearsOf(workbook) : [];
  const preview: ParsedSheet | undefined = activeSheets[0];
  const importDisabled = busy || !cycles.valid;
  return (
    <Screen scrollRef={scrollRef} width="workspace">
      <DataStateNotice status={dataStatus} retry={retryData} />
      <Card style={{ backgroundColor: palette.surfaceAlt }}>
        <View style={{ flexDirection: wide ? "row" : "column", alignItems: "center", gap: spacing.lg }}>
          <WorkbookArtwork ready={workbook != null} />
          <View style={{ flex: 1, minWidth: 0, alignSelf: "stretch", justifyContent: "center" }}>
            <Text style={[type.heading, { color: palette.textStrong }]}>{tr.importer.heroTitle}</Text>
            <Body muted style={{ marginTop: spacing.xs, marginBottom: spacing.md }}>{workbook ? tr.importer.heroReady(workbook.sheets.length) : tr.importer.intro}</Body>
            <Button
              icon={Upload}
              label={workbook ? tr.importer.pickAgain : tr.importer.pick}
              variant={workbook ? "secondary" : "primary"}
              onPress={() => confirmDiscard(() => void pick())}
              disabled={busy}
              loading={busy && workbook == null}
            />
          </View>
        </View>
      </Card>
      <ImportJourney stage={workbook ? 1 : 0} fileIcon={FileSpreadsheet} />
      <OperationStatusNotice state={operation.state} label={workbook ? tr.operation.importing : tr.dataState.loading} onCancel={committing ? undefined : operation.cancel} />
      {error ? (
        <Card tone="error" style={{ marginTop: spacing.md }}>
          <SectionHeader>{tr.importer.errorTitle}</SectionHeader>
          <Body accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ color: palette.errorText, marginBottom: spacing.sm }}>{error}</Body>
        </Card>
      ) : null}
      {!workbook ? (
        <View style={{ marginTop: spacing.md }}>
          <FormatGuide wide={wide} />
          <TemplateCard />
        </View>
      ) : (
        <>
          {years.length > 0 ? (
            <>
              <SectionHeader>{tr.importer.yearSelectTitle}</SectionHeader>
              <SelectionGrid
                options={years.map((y) => ({ value: String(y), label: tr.importer.yearChip(y, monthCount(workbook, y)) }))}
                values={selectedYears.map(String)}
                onToggle={(v) => {
                  const y = Number(v);
                  setSelectedYears((xs) => (xs.includes(y) ? xs.filter((x) => x !== y) : [...xs, y]));
                }}
              />
            </>
          ) : null}
          {workbook.unparsed.length > 0 ? (
            <Body muted style={{ marginBottom: spacing.md }}>{tr.importer.unparsedNote(workbook.unparsed.map((s) => s.sheetName).join(", "))}</Body>
          ) : null}
          {recordPlan ? <RecordsCard plan={recordPlan} /> : null}
          {!preview && hasRecords(workbook) ? (
            <Button icon={FileSpreadsheet} label={tr.importer.recordsImport} onPress={() => void importRecordsOnly()} loading={busy} disabled={busy} />
          ) : null}
          {preview ? (
            <>
              <ColumnsPicker columns={columnsOf(activeSheets)} excluded={excluded} onExcluded={setExcluded} />
              <OpeningCard sheets={activeSheets} selectedYears={selectedYears} column={openingColumn} onColumn={setOpeningColumn} adopt={adoptOpening} onAdopt={setAdoptOpening} />
              <CardCyclesCard cycles={cycles} />
              <SheetPreview sheet={preview} />
              {reimportYears ? (
                <Card>
                  <Body style={{ marginBottom: spacing.sm }}>{tr.importer.reimportPrompt(reimportYears.join(", "))}</Body>
                  <Row gap={spacing.sm}>
                    <View style={{ flex: 1 }}>
                      <Button label={tr.importer.reimportReplace} onPress={() => void doImport("replace")} loading={busy} disabled={importDisabled} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button label={tr.importer.reimportAdd} variant="secondary" onPress={() => void doImport("add")} loading={busy} disabled={importDisabled} />
                    </View>
                  </Row>
                  <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={() => setReimportYears(null)} disabled={busy} />
                </Card>
              ) : (
                <Button icon={FileSpreadsheet} label={tr.importer.confirm} onPress={() => void startImport()} loading={busy} disabled={importDisabled || selectedYears.length === 0} />
              )}
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

/** Distinct years across every parsed sheet's months, ascending. */
function yearsOf(wb: ParsedWorkbook): number[] {
  const set = new Set<number>();
  for (const s of wb.sheets) for (const m of s.months) set.add(yearOf(m));
  return [...set].sort((a, b) => a - b);
}

// Distinct months in a year — a year has at most 12. Summing raw month cells
// across sheets double-counted when two sheets overlapped a year (a summary
// tab, or a workbook that repeats months), showing nonsense like "2026 · 24 ay".
function monthCount(wb: ParsedWorkbook, year: number): number {
  const seen = new Set<string>();
  for (const s of wb.sheets) for (const m of s.months) if (yearOf(m) === year) seen.add(m);
  return seen.size;
}
