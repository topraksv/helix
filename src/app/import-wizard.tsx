/**
 * Spreadsheet import wizard: pick an .xlsx/.xlsm/.csv → preview the detected
 * months/columns per sheet → import 1:1 into the Mali Tablo. Handles multi-year
 * workbooks (one sheet per year, each keeping its own columns), formula/comment
 * breakdowns, opening balance, and re-import of a year that already has data.
 *
 * NOTE: the richer visual format guide + per-sheet selection UI land in PKG 4;
 * this wires the full write path (importSheets) with a minimal re-import prompt.
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
import { parseWorkbookBytes, type ParsedSheet, type ParsedWorkbook } from "../services/spreadsheet-import";
import { scheduleSync } from "../sync/engine";
import { Body, Button, Card, ChipPicker, EmptyState, Row, Screen, SectionHeader } from "../ui/components";
import { spacing, type, useTheme } from "../ui/theme";

export default function ImportWizardModal() {
  const userId = useUserId();
  const persons = usePersons();
  const router = useRouter();
  const { palette } = useTheme();
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
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
      setExcluded([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Tap "import" → ask first if any year already has an import batch. */
  const startImport = async () => {
    if (!workbook) return;
    const years = [...new Set(workbook.sheets.map((s) => s.year))];
    const already = await importedYears(userId, years);
    if (already.length > 0) {
      setReimportYears(already.sort());
      return;
    }
    await doImport("add");
  };

  const doImport = async (mode: "replace" | "add") => {
    if (!workbook) return;
    const selfId = persons.find((p) => p.isSelf)?.id;
    if (!selfId) return;
    setReimportYears(null);
    setBusy(true);
    try {
      const { imported } = await importSheets(userId, {
        sheets: workbook.sheets,
        excludedLabels: excluded,
        selfId,
        mode,
      });
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

  const preview: ParsedSheet | undefined = workbook?.sheets[0];

  return (
    <Screen>
      <Body muted style={{ marginBottom: spacing.md }}>{tr.importer.intro}</Body>
      <Button icon={Upload} label={workbook ? tr.importer.pickAgain : tr.importer.pick} variant={workbook ? "secondary" : "primary"} onPress={() => void pick()} />
      {error ? (
        <Body style={{ color: palette.negative, marginTop: spacing.md }}>{error}</Body>
      ) : null}

      {workbook && preview ? (
        <>
          <SectionHeader>{tr.importer.previewTitle}</SectionHeader>
          <Body muted style={{ marginBottom: spacing.sm }}>
            {tr.importer.sheetsFound(workbook.sheets.map((s) => s.sheetName).join(", "))}
          </Body>
          <Body muted style={{ marginBottom: spacing.sm }}>
            {tr.importer.detected(preview.months.length, preview.columns.length)}
            {preview.skippedColumns.length > 0 ? ` ${tr.importer.skipped(preview.skippedColumns.join(", "))}` : ""}
          </Body>

          {/* column toggles (first sheet) */}
          <ChipPicker
            multi
            options={preview.columns.map((c) => ({ value: c.label, label: `${c.label}${c.kindGuess === "income" ? " ↑" : ""}` }))}
            values={preview.columns.map((c) => c.label).filter((l) => !excluded.includes(l))}
            onToggle={(label) =>
              setExcluded((xs) => (xs.includes(label) ? xs.filter((x) => x !== label) : [...xs, label]))
            }
          />

          {/* mini preview grid */}
          <Card padded={false}>
            <ScrollView horizontal>
              <View style={{ padding: spacing.md }}>
                <View style={{ flexDirection: "row" }}>
                  <Text style={[type.label, { color: palette.textMuted, width: 110 }]}>{tr.cashflow.monthHeader}</Text>
                  {preview.columns.slice(0, 6).map((c) => (
                    <Text key={c.label} style={[type.label, { color: palette.textMuted, width: 104, textAlign: "right" }]}>
                      {c.label}
                    </Text>
                  ))}
                </View>
                {preview.months.slice(0, 8).map((m, r) => (
                  <View key={m} style={{ flexDirection: "row", marginTop: spacing.sm }}>
                    <Text style={[type.small, { color: palette.text, width: 110 }]}>{monthLabel(m)}</Text>
                    {preview.columns.slice(0, 6).map((c, i) => (
                      <Text key={c.label} style={[type.amountSm, { color: palette.textMuted, width: 104, textAlign: "right" }]}>
                        {preview.cells[r][i].valueMinor != null ? formatMinor(preview.cells[r][i].valueMinor!) : "—"}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          </Card>

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
            <Button icon={FileSpreadsheet} label={tr.importer.confirm} onPress={() => void startImport()} loading={busy} />
          )}
        </>
      ) : null}
    </Screen>
  );
}
