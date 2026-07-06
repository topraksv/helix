/**
 * Spreadsheet import wizard: pick an .xlsx/.csv → preview the detected
 * months/columns → import as aggregate transactions (missing categories are
 * created as table columns). Covers "move my old Excel over 1:1".
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
import { formatMinor } from "../domain/money";
import { monthLabel, tr } from "../i18n/tr";
import { parseSheet, readWorkbook, type ParsedSheet } from "../services/spreadsheet-import";
import { scheduleSync } from "../sync/engine";
import { Body, Button, Card, ChipPicker, EmptyState, Screen, SectionHeader } from "../ui/components";
import { spacing, type, useTheme } from "../ui/theme";

export default function ImportWizardModal() {
  const userId = useUserId();
  const categories = useCategories();
  const persons = usePersons();
  const router = useRouter();
  const { palette } = useTheme();
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
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
      const parsed = parseSheet(readWorkbook(bytes));
      if (!parsed) {
        setError(tr.importer.parseError);
        return;
      }
      setSheet(parsed);
      setExcluded([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const runImport = async () => {
    if (!sheet) return;
    const selfId = persons.find((p) => p.isSelf)?.id;
    if (!selfId) return;
    setBusy(true);
    try {
      const active = sheet.columns
        .map((c, i) => ({ ...c, index: i }))
        .filter((c) => !excluded.includes(c.label));

      // 1) Ensure every imported column exists as a category (table column).
      const categoryIdByLabel = new Map<string, string>();
      const newCategories: RowWrite[] = [];
      for (const col of active) {
        const existing = categories.find((c) => c.name.toLocaleLowerCase("tr-TR") === col.label.toLocaleLowerCase("tr-TR"));
        if (existing) {
          categoryIdByLabel.set(col.label, existing.id);
        } else {
          const id = newId();
          categoryIdByLabel.set(col.label, id);
          newCategories.push({
            table: "categories",
            row: {
              id,
              name: col.label,
              kind: col.kindGuess,
              icon: null,
              color: null,
              sortOrder: categories.length + newCategories.length,
              isColumn: true,
              deletedAt: null,
            },
          });
        }
      }
      if (newCategories.length > 0) await writeRows(userId, newCategories);

      // 2) One aggregate entry per month × column with a value.
      let imported = 0;
      for (let r = 0; r < sheet.months.length; r++) {
        const entries = active
          .map((col) => ({
            categoryId: categoryIdByLabel.get(col.label)!,
            kind: col.kindGuess,
            amountMinor: sheet.cells[r][col.index] ?? 0,
            isInvestment: /yat[ıi]r[ıi]m/i.test(col.label),
          }))
          .filter((e) => e.amountMinor > 0);
        if (entries.length === 0) continue;
        await bulkMonthEntry(userId, sheet.months[r], selfId, entries);
        imported += entries.length;
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

  return (
    <Screen>
      <Body muted style={{ marginBottom: spacing.md }}>{tr.importer.intro}</Body>
      <Button icon={Upload} label={sheet ? tr.importer.pickAgain : tr.importer.pick} variant={sheet ? "secondary" : "primary"} onPress={() => void pick()} />
      {error ? (
        <Body style={{ color: palette.negative, marginTop: spacing.md }}>{error}</Body>
      ) : null}

      {sheet ? (
        <>
          <SectionHeader>{tr.importer.previewTitle}</SectionHeader>
          <Body muted style={{ marginBottom: spacing.sm }}>
            {tr.importer.detected(sheet.months.length, sheet.columns.length)}
            {sheet.skippedColumns.length > 0 ? ` ${tr.importer.skipped(sheet.skippedColumns.join(", "))}` : ""}
          </Body>

          {/* column toggles */}
          <ChipPicker
            multi
            options={sheet.columns.map((c) => ({ value: c.label, label: `${c.label}${c.kindGuess === "income" ? " ↑" : ""}` }))}
            values={sheet.columns.map((c) => c.label).filter((l) => !excluded.includes(l))}
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
                  {sheet.columns.slice(0, 6).map((c) => (
                    <Text key={c.label} style={[type.label, { color: palette.textMuted, width: 104, textAlign: "right" }]} numberOfLines={1}>
                      {c.label}
                    </Text>
                  ))}
                </View>
                {sheet.months.slice(0, 8).map((m, r) => (
                  <View key={m} style={{ flexDirection: "row", marginTop: spacing.sm }}>
                    <Text style={[type.small, { color: palette.text, width: 110 }]}>{monthLabel(m)}</Text>
                    {sheet.columns.slice(0, 6).map((c, i) => (
                      <Text key={c.label} style={[type.amountSm, { color: palette.textMuted, width: 104, textAlign: "right" }]}>
                        {sheet.cells[r][i] != null ? formatMinor(sheet.cells[r][i]!) : "—"}
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
