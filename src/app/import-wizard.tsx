/**
 * Spreadsheet import wizard: pick an .xlsx/.xlsm/.csv → preview the detected
 * months/columns per sheet → import as aggregate transactions (missing
 * categories are created as table columns). Covers "move my old Excel over 1:1",
 * including multi-year workbooks (one sheet per year).
 *
 * NOTE: this is the PKG-1 baseline (multi-sheet parse + value import). The
 * richer write path (formula/comment split, per-year columns, opening balance,
 * re-import dedup) and the visual format guide land in later packages.
 */

import React, { useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react-native";
import { newId } from "../db/ids";
import { writeRows, type RowWrite } from "../db/mutations";
import { bulkMonthEntry } from "../data/repo";
import { useCategories, usePersons, useUserId } from "../data/hooks";
import { suggestCategoryIcon } from "../data/category-icons";
import { formatMinor } from "../domain/money";
import { monthLabel, tr } from "../i18n/tr";
import { parseWorkbookBytes, type ParsedSheet, type ParsedWorkbook } from "../services/spreadsheet-import";
import { scheduleSync } from "../sync/engine";
import { Body, Button, Card, ChipPicker, EmptyState, Screen, SectionHeader } from "../ui/components";
import { spacing, type, useTheme } from "../ui/theme";

export default function ImportWizardModal() {
  const userId = useUserId();
  const categories = useCategories();
  const persons = usePersons();
  const router = useRouter();
  const { palette } = useTheme();
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneCount, setDoneCount] = useState<number | null>(null);

  const pick = async () => {
    setError(null);
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

  const runImport = async () => {
    if (!workbook) return;
    const selfId = persons.find((p) => p.isSelf)?.id;
    if (!selfId) return;
    setBusy(true);
    try {
      // Category ids are shared across sheets: same-named column in 2025 and
      // 2026 maps to one category (matched case-insensitively).
      const categoryIdByLabel = new Map<string, string>();
      categories.forEach((c) => categoryIdByLabel.set(c.name.toLocaleLowerCase("tr-TR"), c.id));
      const newCategories: RowWrite[] = [];
      let sortSeed = categories.length;
      let imported = 0;

      for (const sheet of workbook.sheets) {
        const active = sheet.columns
          .map((c, i) => ({ ...c, index: i }))
          .filter((c) => !excluded.includes(c.label));

        for (const col of active) {
          const key = col.label.toLocaleLowerCase("tr-TR");
          if (categoryIdByLabel.has(key)) continue;
          const id = newId();
          categoryIdByLabel.set(key, id);
          newCategories.push({
            table: "categories",
            row: {
              id,
              name: col.label,
              kind: col.kindGuess,
              icon: suggestCategoryIcon(col.label, col.kindGuess),
              color: null,
              sortOrder: sortSeed++,
              isColumn: true,
              deletedAt: null,
            },
          });
        }
        if (newCategories.length > 0) await writeRows(userId, newCategories.splice(0));

        for (let r = 0; r < sheet.months.length; r++) {
          const entries = active
            .map((col) => ({
              categoryId: categoryIdByLabel.get(col.label.toLocaleLowerCase("tr-TR"))!,
              kind: col.kindGuess,
              amountMinor: sheet.cells[r][col.index].valueMinor ?? 0,
              isInvestment: col.isInvestment,
            }))
            .filter((e) => e.amountMinor !== 0);
          if (entries.length === 0) continue;
          await bulkMonthEntry(userId, sheet.months[r], selfId, entries);
          imported += entries.length;
        }
      }
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

          <Button icon={FileSpreadsheet} label={tr.importer.confirm} onPress={() => void runImport()} loading={busy} />
        </>
      ) : null}
    </Screen>
  );
}
