/**
 * Spreadsheet import wizard: pick an .xlsx/.xlsm/.csv → see a visual format
 * guide → choose which sheets/columns to bring → import 1:1 into the Mali
 * Tablo. Handles multi-year workbooks (one sheet per year, each keeping its own
 * columns), formula/comment breakdowns, opening balance, and re-import of a
 * year that already has data. Parsing/mapping lives in
 * services/spreadsheet-import + data/repo; this screen only guides and confirms.
 */

import React, { useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react-native";
import { importSheets, importedYears } from "../data/repo";
import { usePersons, useUserId } from "../data/hooks";
import { formatMinor } from "../domain/money";
import { monthLabel, tr } from "../i18n/tr";
import { parseWorkbookBytes, type CellData, type ParsedSheet, type ParsedWorkbook } from "../services/spreadsheet-import";
import { scheduleSync } from "../sync/engine";
import { Body, Button, Card, ChipPicker, EmptyState, Row, Screen, SectionHeader } from "../ui/components";
import { spacing, type, useTheme, type Palette } from "../ui/theme";

// --- visual format guide ---------------------------------------------------
function MiniCell({ text, tone, palette }: { text?: string; tone: "month" | "head" | "data"; palette: Palette }) {
  const bg = tone === "month" ? palette.primarySoft : tone === "head" ? palette.surfaceAlt : palette.surface;
  const color = tone === "month" ? palette.primary : palette.textMuted;
  return (
    <View style={{ width: 40, height: 22, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center", backgroundColor: bg }}>
      <Text style={{ fontSize: 9, color, fontFamily: "Inter_600SemiBold" }} numberOfLines={1}>
        {text ?? "·"}
      </Text>
    </View>
  );
}

function SheetLayoutDiagram({ orientation, caption }: { orientation: "vertical" | "horizontal"; caption: string }) {
  const { palette } = useTheme();
  const M = (text: string) => ({ text, tone: "month" as const });
  const H = (text: string) => ({ text, tone: "head" as const });
  const D = { tone: "data" as const };
  const grid =
    orientation === "vertical"
      ? [
          [{ tone: "data" as const }, H("Kira"), H("Maaş")],
          [M("Oca"), D, D],
          [M("Şub"), D, D],
        ]
      : [
          [{ tone: "data" as const }, M("Oca"), M("Şub")],
          [H("Kira"), D, D],
          [H("Maaş"), D, D],
        ];
  return (
    <View style={{ alignItems: "center", gap: spacing.xs }}>
      <View>
        {grid.map((r, ri) => (
          <View key={ri} style={{ flexDirection: "row" }}>
            {r.map((cell, ci) => (
              <MiniCell key={ci} text={"text" in cell ? cell.text : undefined} tone={cell.tone} palette={palette} />
            ))}
          </View>
        ))}
      </View>
      <Text style={[type.small, { color: palette.textMuted }]}>{caption}</Text>
    </View>
  );
}

function FormatGuide() {
  const { palette } = useTheme();
  return (
    <Card>
      <SectionHeader>{tr.importer.guideTitle}</SectionHeader>
      <Row gap={spacing.xl} style={{ justifyContent: "center", flexWrap: "wrap", marginBottom: spacing.md }}>
        <SheetLayoutDiagram orientation="vertical" caption={tr.importer.layoutVertical} />
        <SheetLayoutDiagram orientation="horizontal" caption={tr.importer.layoutHorizontal} />
      </Row>
      {[tr.importer.guide1, tr.importer.guide2, tr.importer.guide3, tr.importer.guide4, tr.importer.guide5].map((line) => (
        <View key={line} style={{ flexDirection: "row", marginBottom: spacing.xs }}>
          <Text style={[type.small, { color: palette.primary, marginRight: spacing.xs }]}>•</Text>
          <Text style={[type.small, { color: palette.textMuted, flex: 1 }]}>{line}</Text>
        </View>
      ))}
    </Card>
  );
}

const hasBreakdown = (c: CellData) => Boolean(c.formulaParts || c.comment);

// --- screen ----------------------------------------------------------------
export default function ImportWizardModal() {
  const userId = useUserId();
  const persons = usePersons();
  const router = useRouter();
  const { palette } = useTheme();
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reimportYears, setReimportYears] = useState<number[] | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);

  const pick = async () => {
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
    try {
      const uri = picked.assets[0].uri;
      const bytes =
        Platform.OS === "web"
          ? new Uint8Array(await (await fetch(uri)).arrayBuffer())
          : await new File(uri).bytes();
      const parsed = parseWorkbookBytes(bytes);
      if (parsed.sheets.length === 0) {
        setError(parsed.unparsed[0]?.reason ?? tr.importer.parseError);
        setWorkbook(null);
        return;
      }
      setWorkbook(parsed);
      setSelectedSheets(parsed.sheets.map((s) => s.sheetName));
      setExcluded([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const selected = (workbook?.sheets ?? []).filter((s) => selectedSheets.includes(s.sheetName));

  /** Tap "import" → ask first if any selected year already has an import batch. */
  const startImport = async () => {
    if (selected.length === 0) return;
    const already = await importedYears(userId, selected.map((s) => s.year));
    if (already.length > 0) {
      setReimportYears(already.sort());
      return;
    }
    await doImport("add");
  };

  const doImport = async (mode: "replace" | "add") => {
    const selfId = persons.find((p) => p.isSelf)?.id;
    if (!selfId || selected.length === 0) return;
    setReimportYears(null);
    setBusy(true);
    try {
      const { imported } = await importSheets(userId, { sheets: selected, excludedLabels: excluded, selfId, mode });
      scheduleSync(userId);
      setDoneCount(imported);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (doneCount != null) {
    return (
      <Screen>
        <EmptyState icon={CheckCircle2} title={tr.importer.doneTitle(doneCount)} hint={tr.importer.doneHint} />
        <Button label={tr.common.done} onPress={() => router.back()} />
      </Screen>
    );
  }

  // Column toggles: union of the selected sheets' columns (first-seen kind).
  const unionColumns: { label: string; income: boolean }[] = [];
  const seenCol = new Set<string>();
  for (const s of selected) {
    for (const col of s.columns) {
      if (!seenCol.has(col.label)) {
        seenCol.add(col.label);
        unionColumns.push({ label: col.label, income: col.kindGuess === "income" });
      }
    }
  }
  const preview: ParsedSheet | undefined = selected[0];

  return (
    <Screen>
      <Body muted style={{ marginBottom: spacing.md }}>{tr.importer.intro}</Body>
      <Button icon={Upload} label={workbook ? tr.importer.pickAgain : tr.importer.pick} variant={workbook ? "secondary" : "primary"} onPress={() => void pick()} />

      {error ? (
        <Card style={{ marginTop: spacing.md, borderColor: palette.negative }}>
          <SectionHeader>{tr.importer.errorTitle}</SectionHeader>
          <Body style={{ color: palette.negative, marginBottom: spacing.sm }}>{error}</Body>
        </Card>
      ) : null}

      {!workbook ? (
        <View style={{ marginTop: spacing.md }}>
          <FormatGuide />
        </View>
      ) : (
        <>
          {/* which sheets (years) to import */}
          <SectionHeader>{tr.importer.sheetSelectTitle}</SectionHeader>
          <ChipPicker
            multi
            options={workbook.sheets.map((s) => ({ value: s.sheetName, label: tr.importer.sheetChip(s.sheetName, s.months.length, s.columns.length) }))}
            values={selectedSheets}
            onToggle={(name) => setSelectedSheets((xs) => (xs.includes(name) ? xs.filter((x) => x !== name) : [...xs, name]))}
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
              <ChipPicker
                multi
                options={unionColumns.map((c) => ({ value: c.label, label: `${c.label}${c.income ? " ↑" : ""}` }))}
                values={unionColumns.map((c) => c.label).filter((l) => !excluded.includes(l))}
                onToggle={(label) => setExcluded((xs) => (xs.includes(label) ? xs.filter((x) => x !== label) : [...xs, label]))}
              />

              {/* preview grid (first selected sheet) */}
              <Body muted style={{ marginBottom: spacing.sm }}>
                {tr.importer.detected(preview.months.length, preview.columns.length)}
                {preview.skippedColumns.length > 0 ? ` ${tr.importer.skipped(preview.skippedColumns.join(", "))}` : ""}
              </Body>
              <Card padded={false}>
                <ScrollView horizontal>
                  <View style={{ padding: spacing.md }}>
                    <View style={{ flexDirection: "row" }}>
                      <Text style={[type.label, { color: palette.textMuted, width: 96 }]}>{tr.cashflow.monthHeader}</Text>
                      {preview.columns.map((c) => (
                        <Text key={c.label} style={[type.label, { color: palette.textMuted, width: 108, textAlign: "right" }]}>
                          {c.label}
                        </Text>
                      ))}
                    </View>
                    {preview.months.map((m, r) => (
                      <View key={m} style={{ flexDirection: "row", marginTop: spacing.sm }}>
                        <Text style={[type.small, { color: palette.text, width: 96 }]}>{monthLabel(m)}</Text>
                        {preview.columns.map((c, i) => {
                          const cell = preview.cells[r][i];
                          return (
                            <Text key={c.label} style={[type.amountSm, { color: palette.textMuted, width: 108, textAlign: "right" }]}>
                              {hasBreakdown(cell) ? <Text style={{ color: palette.primary }}>• </Text> : null}
                              {cell.valueMinor != null ? formatMinor(cell.valueMinor) : "—"}
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
                      <Button label={tr.importer.reimportReplace} onPress={() => void doImport("replace")} loading={busy} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button label={tr.importer.reimportAdd} variant="secondary" onPress={() => void doImport("add")} loading={busy} />
                    </View>
                  </Row>
                  <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={() => setReimportYears(null)} />
                </Card>
              ) : (
                <Button icon={FileSpreadsheet} label={tr.importer.confirm} onPress={() => void startImport()} loading={busy} disabled={selected.length === 0} />
              )}
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
