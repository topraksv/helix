/**
 * Spreadsheet import wizard: pick an .xlsx/.xlsm/.csv → see a visual, example-
 * rich format guide → choose which years/columns to bring → import 1:1 into the
 * Mali Tablo. Handles multi-year workbooks (each year keeps its own columns),
 * formula/comment breakdowns, opening balance, and re-import of a year that
 * already has data. Parsing/mapping lives in services/spreadsheet-import +
 * data/repo; this screen only guides and confirms.
 */

import React, { useEffect, useRef, useState } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react-native";
import { ImportBatchUnreadableError, importSheets, importedYears } from "../data/repo";
import { usePersonsState, useSourcesState, useUserId } from "../data/hooks";
import { combineLiveQueryStatus } from "../data/live-state";
import { isMonthDay, yearOf } from "../domain/dates";
import { formatMinor } from "../domain/money";
import { monthLabel, tr } from "../i18n/tr";
import { collectInstallmentPlans, MAX_WORKBOOK_BYTES, parseWorkbookBytes, type CellData, type ParsedSheet, type ParsedWorkbook } from "../services/spreadsheet-import";
import { scheduleSync } from "../sync/engine";
import { Body, Button, Card, ChipPicker, DataStateNotice, Row, Screen, SectionHeader } from "../ui/components";
import { radius, spacing, type, useTheme, type Palette } from "../ui/theme";
import { navigateBack } from "../ui/navigation";
import { useOperationGuard } from "../ui/operation-guard";
import { useDirtyExitGuard } from "../ui/dirty-exit";
import { readPickedBytes } from "../services/picked-file";
import { MonthDayField } from "../ui/month-day-field";

// --- visual format guide ---------------------------------------------------
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
      <Text style={{ fontSize: big ? 13 : 10, color, fontFamily: "Inter_600SemiBold" }}>
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
    <View style={{ alignItems: "center", gap: spacing.sm }}>
      <View style={{ borderRadius: radius.sm, overflow: "hidden" }}>
        {grid.map((r, ri) => (
          <View key={ri} style={{ flexDirection: "row" }}>
            {r.map((cell, ci) => (
              <MiniCell key={ci} text={"text" in cell ? cell.text : undefined} tone={cell.tone} palette={palette} big={big} />
            ))}
          </View>
        ))}
      </View>
      <Text style={[big ? type.body : type.small, { color: palette.text, textAlign: "center", fontFamily: "Inter_500Medium" }]}>{caption}</Text>
    </View>
  );
}

function ExampleRow({ label, value }: { label: string; value: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", marginBottom: spacing.xs, flexWrap: "wrap" }}>
      <Text style={[type.small, { color: palette.primaryText, fontFamily: "Inter_600SemiBold", width: 78 }]}>{label}</Text>
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

const hasBreakdown = (c: CellData) => Boolean(c.formulaParts || c.comment);

// --- screen ----------------------------------------------------------------
export default function ImportWizardModal() {
  const userId = useUserId();
  const personsState = usePersonsState();
  const sourcesState = useSourcesState();
  const persons = personsState.data;
  const sources = sourcesState.data;
  const router = useRouter();
  const { palette } = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reimportYears, setReimportYears] = useState<number[] | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);
  const [cardCycleDrafts, setCardCycleDrafts] = useState<Record<string, { statementDay: string; dueDay: string }>>({});
  const scrollRef = useRef<ScrollView>(null);
  const operationGuard = useOperationGuard();
  useDirtyExitGuard(workbook != null && doneCount == null && !busy);
  const liveStates = [personsState, sourcesState];
  const dataStatus = combineLiveQueryStatus(liveStates);
  const dataReady = liveStates.every((state) => state.updatedAt != null);
  const retryData = () => {
    personsState.retry();
    sourcesState.retry();
  };

  useEffect(() => {
    if (doneCount == null) return;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
  }, [doneCount]);

  const pick = async () => {
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        setError(null);
        setReimportYears(null);
        const picked = await DocumentPicker.getDocumentAsync({
          type: [
            "text/csv",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel.sheet.macroEnabled.12", // xlsm
            "application/vnd.ms-excel.sheet.binary.macroEnabled.12", // xlsb
            "application/vnd.oasis.opendocument.spreadsheet", // ods
          ],
          copyToCacheDirectory: true,
        });
        if (picked.canceled || !picked.assets[0]) return;
        if ((picked.assets[0].size ?? 0) > MAX_WORKBOOK_BYTES) throw new Error(tr.importer.fileTooLarge);
        const bytes = await readPickedBytes(picked.assets[0]);
        const parsed = await parseWorkbookBytes(bytes);
        if (parsed.sheets.length === 0) {
          setError(parsed.unparsed[0]?.reason ?? tr.importer.parseError);
          setWorkbook(null);
          return;
        }
        setWorkbook(parsed);
        setSelectedYears(yearsOf(parsed));
        setExcluded([]);
        setCardCycleDrafts({});
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    });
  };

  // Sheets that contribute at least one month in a selected year.
  const activeSheets = (workbook?.sheets ?? []).filter((s) => s.months.some((m) => selectedYears.includes(yearOf(m))));
  const normalizeCard = (name: string) => name.trim().toLocaleLowerCase("tr-TR");
  const installmentCards = [...new Set(
    collectInstallmentPlans(activeSheets, {
      excludedLabels: excluded,
      informationalCards: workbook?.informationalCards ?? [],
      yearAllowed: (year) => selectedYears.includes(year),
    }).map((plan) => plan.card),
  )];
  const cycleDraft = (card: string) => {
    const explicit = cardCycleDrafts[card];
    if (explicit) return explicit;
    const existing = sources.find((source) => source.type === "credit_card" && normalizeCard(source.name) === normalizeCard(card));
    return {
      statementDay: existing?.statementDay == null ? "" : String(existing.statementDay),
      dueDay: existing?.dueDay == null ? "" : String(existing.dueDay),
    };
  };
  const cardCyclesValid = installmentCards.every((card) => {
    const cycle = cycleDraft(card);
    return isMonthDay(cycle.statementDay) && isMonthDay(cycle.dueDay);
  });

  const startImport = async () => {
    if (selectedYears.length === 0) return;
    await operationGuard.run(async () => {
      setBusy(true);
      setError(null);
      try {
        const already = await importedYears(userId, selectedYears);
        if (already.length > 0) {
          setReimportYears(already.sort((a, b) => a - b));
          return;
        }
        await performImport("add");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    });
  };

  const performImport = async (mode: "replace" | "add") => {
    const selfId = persons.find((p) => p.isSelf)?.id;
    if (!selfId) {
      setError(tr.importer.missingSelf);
      return;
    }
    if (selectedYears.length === 0) return;
    setReimportYears(null);
    const { imported } = await importSheets(userId, {
      sheets: activeSheets,
      excludedLabels: excluded,
      selectedYears,
      selfId,
      mode,
      informationalCards: workbook?.informationalCards ?? [],
      cardCycles: Object.fromEntries(
        installmentCards.map((card) => {
          const cycle = cycleDraft(card);
          return [card, { statementDay: Number(cycle.statementDay), dueDay: Number(cycle.dueDay) }];
        }),
      ),
    });
    scheduleSync(userId);
    setDoneCount(imported);
  };

  const doImport = async (mode: "replace" | "add") => {
    await operationGuard.run(async () => {
      setBusy(true);
      setError(null);
      try {
        await performImport(mode);
      } catch (e) {
        // A refused replace is a precise, actionable condition — never a raw
        // engine message, and never a silent downgrade to "add".
        setError(
          e instanceof ImportBatchUnreadableError
            ? tr.importer.batchUnreadable(e.years.join(", "))
            : e instanceof Error ? e.message : String(e),
        );
      } finally {
        setBusy(false);
      }
    });
  };

  if (!dataReady) {
    return (
      <Screen scrollRef={scrollRef}>
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  if (doneCount != null) {
    return (
      <Screen scrollRef={scrollRef}>
        <Card style={{ borderColor: palette.positive }}>
          <Row gap={spacing.md} style={{ alignItems: "center" }}>
            <CheckCircle2 accessible={false} size={26} color={palette.positive} />
            <View style={{ flex: 1 }}>
              <Text accessibilityRole="header" style={[type.heading, { color: palette.text }]}>{tr.importer.doneTitle(doneCount)}</Text>
              <Body muted style={{ marginTop: spacing.xs }}>{tr.importer.doneHint}</Body>
            </View>
          </Row>
        </Card>
        <Button icon={CheckCircle2} label={tr.common.done} onPress={() => navigateBack(router, "/(tabs)/cash-flow")} />
      </Screen>
    );
  }

  const years = workbook ? yearsOf(workbook) : [];
  // Column toggles: union of the active sheets' columns (first-seen kind).
  const unionColumns: { label: string; income: boolean }[] = [];
  const seenCol = new Set<string>();
  for (const s of activeSheets) {
    for (const col of s.columns) {
      if (!seenCol.has(col.label)) {
        seenCol.add(col.label);
        unionColumns.push({ label: col.label, income: col.kindGuess === "income" });
      }
    }
  }
  const preview: ParsedSheet | undefined = activeSheets[0];

  return (
    <Screen scrollRef={scrollRef}>
      <DataStateNotice status={dataStatus} retry={retryData} />
      <Body muted style={{ marginBottom: spacing.md }}>{tr.importer.intro}</Body>
      <Button
        icon={Upload}
        label={workbook ? tr.importer.pickAgain : tr.importer.pick}
        variant={workbook ? "secondary" : "primary"}
        onPress={() => void pick()}
        disabled={busy}
        loading={busy && workbook == null}
      />

      {error ? (
        <Card style={{ marginTop: spacing.md, borderColor: palette.negative }}>
          <SectionHeader>{tr.importer.errorTitle}</SectionHeader>
          <Body accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ color: palette.negativeText, marginBottom: spacing.sm }}>{error}</Body>
        </Card>
      ) : null}

      {!workbook ? (
        <View style={{ marginTop: spacing.md }}>
          <FormatGuide wide={wide} />
        </View>
      ) : (
        <>
          {/* which years to import */}
          <SectionHeader>{tr.importer.yearSelectTitle}</SectionHeader>
          <ChipPicker
            multi
            options={years.map((y) => ({
              value: String(y),
              label: tr.importer.yearChip(y, monthCount(workbook, y)),
            }))}
            values={selectedYears.map(String)}
            onToggle={(v) => {
              const y = Number(v);
              setSelectedYears((xs) => (xs.includes(y) ? xs.filter((x) => x !== y) : [...xs, y]));
            }}
          />
          {workbook.unparsed.length > 0 ? (
            <Body muted style={{ marginBottom: spacing.md }}>
              {tr.importer.unparsedNote(workbook.unparsed.map((s) => s.sheetName).join(", "))}
            </Body>
          ) : null}

          {preview ? (
            <>
              {/* which columns */}
              <SectionHeader>{tr.importer.columnsTitle}</SectionHeader>
              <Body muted style={{ marginBottom: spacing.sm }}>{tr.importer.columnsLead}</Body>
              <Row gap={spacing.sm} style={{ marginBottom: spacing.sm, alignItems: "center" }}>
                <Button label={tr.common.selectAll} variant="ghost" size="sm" disabled={excluded.length === 0} onPress={() => setExcluded([])} />
                <Button
                  label={tr.common.clearAll}
                  variant="ghost"
                  size="sm"
                  disabled={excluded.length >= unionColumns.length}
                  onPress={() => setExcluded(unionColumns.map((c) => c.label))}
                />
              </Row>
              <ChipPicker
                multi
                options={unionColumns.map((c) => ({ value: c.label, label: `${c.label}${c.income ? " ↑" : ""}` }))}
                values={unionColumns.map((c) => c.label).filter((l) => !excluded.includes(l))}
                onToggle={(label) => setExcluded((xs) => (xs.includes(label) ? xs.filter((x) => x !== label) : [...xs, label]))}
              />

              {installmentCards.length > 0 ? (
                <Card>
                  <SectionHeader>{tr.importer.cardCyclesTitle}</SectionHeader>
                  <Body muted style={{ marginBottom: spacing.md }}>{tr.importer.cardCyclesHint}</Body>
                  {installmentCards.map((card) => {
                    const cycle = cycleDraft(card);
                    return (
                      <View key={card} style={{ marginBottom: spacing.sm }}>
                        <Body style={{ marginBottom: spacing.xs }}>{card}</Body>
                        <Row>
                          <View style={{ flex: 1 }}>
                            <MonthDayField
                              label={tr.sources.statementDay}
                              value={cycle.statementDay}
                              onChange={(statementDay) => setCardCycleDrafts((current) => ({
                                ...current,
                                [card]: { ...cycleDraft(card), statementDay },
                              }))}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <MonthDayField
                              label={tr.sources.dueDay}
                              value={cycle.dueDay}
                              onChange={(dueDay) => setCardCycleDrafts((current) => ({
                                ...current,
                                [card]: { ...cycleDraft(card), dueDay },
                              }))}
                            />
                          </View>
                        </Row>
                      </View>
                    );
                  })}
                </Card>
              ) : null}

              {/* preview grid (first active sheet) */}
              <Body muted style={{ marginBottom: spacing.sm }}>
                {tr.importer.detected(preview.months.length, preview.columns.length)}
                {preview.skippedColumns.length > 0 ? ` ${tr.importer.skipped(preview.skippedColumns.join(", "))}` : ""}
              </Body>
              <Card padded={false}>
                <ScrollView horizontal>
                  <View style={{ padding: spacing.md }}>
                    <View style={{ flexDirection: "row" }}>
                      <Text style={[type.label, { color: palette.textSecondary, width: 96 }]}>{tr.cashflow.monthHeader}</Text>
                      {preview.columns.map((c) => (
                        <Text key={c.label} style={[type.label, { color: palette.textSecondary, width: 108, textAlign: "right" }]}>
                          {c.label}
                        </Text>
                      ))}
                    </View>
                    {preview.months.map((m, r) => (
                      <View key={m} style={{ flexDirection: "row", marginTop: spacing.sm }}>
                        <Text style={[type.small, { color: palette.text, width: 96 }]}>{monthLabel(m)}</Text>
                        {preview.columns.map((c, i) => {
                          const cell = preview.cells[r]?.[i];
                          if (!cell) return null;
                          return (
                            <Text key={c.label} style={[type.amountSm, { color: palette.textSecondary, width: 108, textAlign: "right" }]}>
                              {hasBreakdown(cell) ? <Text style={{ color: palette.primaryText }}>• </Text> : null}
                              {cell.valueMinor != null ? formatMinor(cell.valueMinor) : ""}
                            </Text>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </Card>
              <Body muted style={{ marginTop: spacing.xs, marginBottom: spacing.md, fontSize: 12 }}>
                {tr.importer.breakdownHint}
              </Body>

              {reimportYears ? (
                <Card>
                  <Body style={{ marginBottom: spacing.sm }}>{tr.importer.reimportPrompt(reimportYears.join(", "))}</Body>
                  <Row gap={spacing.sm}>
                    <View style={{ flex: 1 }}>
                      <Button label={tr.importer.reimportReplace} onPress={() => void doImport("replace")} loading={busy} disabled={busy || !cardCyclesValid} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button label={tr.importer.reimportAdd} variant="secondary" onPress={() => void doImport("add")} loading={busy} disabled={busy || !cardCyclesValid} />
                    </View>
                  </Row>
                  <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={() => setReimportYears(null)} disabled={busy} />
                </Card>
              ) : (
                <Button icon={FileSpreadsheet} label={tr.importer.confirm} onPress={() => void startImport()} loading={busy} disabled={busy || selectedYears.length === 0 || !cardCyclesValid} />
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
