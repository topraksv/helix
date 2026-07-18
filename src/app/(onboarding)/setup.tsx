import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { CalendarPlus, ChevronLeft, ChevronRight, FileSpreadsheet, FileUp, Pencil, Trash2 } from "lucide-react-native";
import { finalizeOnboarding, hasImportedData, seedWorkspace, TEMPLATE_CATEGORIES, TEMPLATE_EXTRA_CATEGORIES, type TemplateCategory } from "../../data/repo";
import { importBundle, MAX_BACKUP_BYTES, parseExportBundleText } from "../../services/export-import";
import { useSession } from "../../auth/session";
import { useSettingsMap } from "../../data/hooks";
import { addMonthsToKey, isCurrentOrFutureMonth, monthKeyOf, todayISO } from "../../domain/dates";
import { remapDraftOwnerIndex } from "../../domain/onboarding";
import { PAYMENT_SOURCE_TYPES, type PaymentSourceType } from "../../domain/types";
import { monthLabel, tr } from "../../i18n/tr";
import { Body, Button, Card, ChipPicker, Field, Heading, IconButton, ListRow, MoneyField, Row, Screen, Spread } from "../../ui/components";
import { appAlert } from "../../ui/dialog";
import { BrandMark } from "../../ui/brand";
import { placeholderPools, useRotatingPlaceholder } from "../../ui/placeholders";
import { spacing, type, useTheme } from "../../ui/theme";
import { useOperationGuard } from "../../ui/operation-guard";

const SOURCE_TYPES = PAYMENT_SOURCE_TYPES.map((value) => ({ value, label: tr.sources[value] }));
const ALL_TEMPLATES: TemplateCategory[] = [...TEMPLATE_CATEGORIES, ...TEMPLATE_EXTRA_CATEGORIES];
const templateLabel = (c: TemplateCategory) => `${c.icon ?? ""} ${c.name}`.trim();

interface DraftSource {
  name: string;
  type: PaymentSourceType;
  personIndex: number;
  statementDay: number | null;
  dueDay: number | null;
}

type HistoryChoice = "manual" | "excel" | "json";

export default function SetupScreen() {
  const { userId } = useSession();
  const router = useRouter();
  const { palette } = useTheme();
  // Detect a completed spreadsheet import (each imported year writes an
  // `import_batch:<year>` setting). When present, the workbook governs the
  // categories AND the opening balance, so the template + opening-balance
  // inputs become redundant — we clear the pre-ticked template once and tell
  // the user, instead of silently seeding duplicate/empty columns on top.
  const settings = useSettingsMap();
  const importedYears = [...settings.keys()]
    .filter((k) => k.startsWith("import_batch:"))
    .map((k) => k.slice("import_batch:".length))
    .sort();
  const hasImport = importedYears.length > 0;
  // Template: every recommended category is shown and pre-selected; the user
  // unticks the ones they don't want.
  const [selectedTemplate, setSelectedTemplate] = useState<string[]>(ALL_TEMPLATES.map((c) => c.name));
  const [startMonth, setStartMonth] = useState(monthKeyOf(todayISO()));
  const [openingRaw, setOpeningRaw] = useState("");
  const [openingMinor, setOpeningMinor] = useState<number | null>(0);
  const [persons, setPersons] = useState<string[]>([tr.onboarding.me]);
  const [newPerson, setNewPerson] = useState("");
  const [editingPerson, setEditingPerson] = useState<number | null>(null);
  const [editPersonName, setEditPersonName] = useState("");
  const [sources, setSources] = useState<DraftSource[]>([]);
  const [newSource, setNewSource] = useState("");
  const [newSourceType, setNewSourceType] = useState<PaymentSourceType>("credit_card");
  const [newSourcePerson, setNewSourcePerson] = useState(0);
  const [newSourceStatementDay, setNewSourceStatementDay] = useState("");
  const [newSourceDueDay, setNewSourceDueDay] = useState("");
  const [editingSource, setEditingSource] = useState<number | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [advancedSetup, setAdvancedSetup] = useState(false);
  const operationGuard = useOperationGuard();
  const personPlaceholder = useRotatingPlaceholder(placeholderPools.person);
  const sourcePlaceholder = useRotatingPlaceholder(placeholderPools.source);

  // Once an import lands, drop the pre-selected template so we don't seed empty
  // template columns beside the imported ones. Guarded so the user can still
  // re-tick extras afterwards without them being wiped again.
  const importClearedRef = useRef(false);
  useEffect(() => {
    if (hasImport && !importClearedRef.current) {
      importClearedRef.current = true;
      setSelectedTemplate([]);
    }
  }, [hasImport]);

  const toggleTemplate = (name: string) =>
    setSelectedTemplate((xs) => (xs.includes(name) ? xs.filter((x) => x !== name) : [...xs, name]));

  const resetSourceForm = () => {
    setNewSource("");
    setNewSourceType("credit_card");
    setNewSourcePerson(0);
    setNewSourceStatementDay("");
    setNewSourceDueDay("");
    setEditingSource(null);
  };

  const submitSource = () => {
    const draft: DraftSource = {
      name: newSource.trim(),
      type: newSourceType,
      personIndex: newSourcePerson,
      statementDay: newSourceType === "credit_card" ? Number(newSourceStatementDay) : null,
      dueDay: newSourceType === "credit_card" ? Number(newSourceDueDay) : null,
    };
    if (editingSource != null) {
      setSources((xs) => xs.map((s, i) => (i === editingSource ? draft : s)));
    } else {
      setSources((xs) => [...xs, draft]);
    }
    resetSourceForm();
  };

  const editSource = (i: number) => {
    const s = sources[i];
    if (!s) return;
    setNewSource(s.name);
    setNewSourceType(s.type);
    setNewSourcePerson(Math.min(s.personIndex, persons.length - 1));
    setNewSourceStatementDay(s.statementDay == null ? "" : String(s.statementDay));
    setNewSourceDueDay(s.dueDay == null ? "" : String(s.dueDay));
    setEditingSource(i);
  };

  const removePerson = (removedIndex: number) => {
    setPersons((current) => current.filter((_, index) => index !== removedIndex));
    setSources((current) =>
      current.map((source) => ({
        ...source,
        personIndex: remapDraftOwnerIndex(source.personIndex, removedIndex),
      })),
    );
    setNewSourcePerson((current) => remapDraftOwnerIndex(current, removedIndex));
    setEditingPerson((current) => {
      if (current == null || current < removedIndex) return current;
      return current === removedIndex ? null : current - 1;
    });
  };

  // Seed the workspace (persons/sources/categories/opening) from the CURRENT
  // form values. `seedWorkspace` is idempotent (deterministic ids), so calling
  // it again — when an importer is opened, and again on commit — upserts the
  // same rows and re-applies the latest opening balance instead of duplicating
  // the workspace or dropping edits made after the first seed. Onboarding is
  // finalized only by "save & start", so the user can import, come back, review,
  // and then commit.
  // Whether to seed the pre-ticked template categories. A spreadsheet/JSON
  // import brings its own columns, so seeding defaults beside them creates the
  // duplicate/stray columns the user sees. When `includeTemplates` isn't given
  // (the commit path), decide from PERSISTED import state — not the reactive
  // `hasImport` live query, which can still be false when commit fires right
  // after returning from the wizard, letting all 18 defaults slip through.
  const ensureSeeded = async (includeTemplates?: boolean): Promise<boolean> => {
    if (!userId) return false;
    let include: boolean;
    if (includeTemplates !== undefined) {
      include = includeTemplates; // openImporter is explicit (false for imports)
    } else {
      // Commit path. Seed the user's selected templates, UNLESS a spreadsheet
      // import governs the columns. If the import landed but the reactive
      // auto-clear hasn't yet dropped the pre-ticked defaults (live-query lag),
      // seed none — otherwise all 18 defaults leak in beside the imported
      // columns. Once the clear has run, `selectedTemplate` holds only what the
      // user re-ticked afterwards, so those are honoured.
      const imported = await hasImportedData(userId);
      include = imported ? importClearedRef.current : true;
    }
    await seedWorkspace(userId, {
      templateCategories: include ? ALL_TEMPLATES.filter((c) => selectedTemplate.includes(c.name)) : [],
      startMonth,
      openingBalanceMinor: openingMinor ?? 0,
      persons: persons.map((name, i) => ({ name, isSelf: i === 0 })),
      sources: sources.map((src) => ({
        name: src.name,
        type: src.type,
        personIndex: src.personIndex,
        statementDay: src.statementDay,
        dueDay: src.dueDay,
      })),
    });
    setSeeded(true);
    return true;
  };

  const openImporter = async (choice: HistoryChoice) => {
    if (!userId) return;
    await operationGuard.run(async () => {
      try {
        if (choice === "json") {
          // Pick the file FIRST, and only enter the loading state around the real
          // work (seed + import) — never around the picker itself. The document
          // picker's promise can fail to settle when the OS file dialog is
          // dismissed, and wrapping it in `busy` left the finish button's spinner
          // stuck forever (P1-1). Picking first also means only a real, processed
          // backup seeds the workspace and shows the "prepared" note (P1-2).
          const picked = await DocumentPicker.getDocumentAsync({ type: "application/json", copyToCacheDirectory: true });
          if (picked.canceled || !picked.assets[0]) return;
          if ((picked.assets[0].size ?? 0) > MAX_BACKUP_BYTES) throw new Error(tr.errors.backupTooLarge);
          setBusy(true);
          const content = await new File(picked.assets[0].uri).text();
          // Validate and restore the complete workspace atomically. Seeding first
          // would leave a partial starter workspace behind when a corrupt backup
          // is rejected or the restore write fails.
          await importBundle(userId, parseExportBundleText(content));
          setSeeded(true);
        } else {
          setBusy(true);
          // Manual history writes into the selected templates; a spreadsheet import
          // brings its own columns, so don't pre-seed defaults beside them.
          if (!(await ensureSeeded(choice === "manual"))) return;
          if (choice === "manual") router.push("/bulk-entry");
          else router.push("/import-wizard");
        }
      } catch (e) {
        void appAlert(e instanceof Error ? e.message : String(e), tr.errors.title);
      } finally {
        setBusy(false);
      }
    });
  };

  const commit = async () => {
    if (!userId) return;
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        await ensureSeeded();
        await finalizeOnboarding(userId);
        // Navigation is driven by the root route guard once the live `onboarded`
        // flag flips true (mirrors the sign-in screen). Replacing to "/(tabs)"
        // here fired while `onboarded` was still false in React state, so the
        // guard immediately redirected back to /(onboarding)/setup AND blanked the
        // Stack — the (tabs)→blank→setup→(tabs) bounce white-screened on iOS
        // (React #185). Keep the button in its loading state until the guard
        // unmounts this screen; only clear `busy` on failure.
      } catch (e) {
        void appAlert(e instanceof Error ? e.message : String(e), tr.errors.title);
        setBusy(false);
      }
    });
  };

  return (
    <Screen maxWidth={560}>
      <View>
        <Row gap={spacing.md} style={{ marginBottom: spacing.lg }}>
          <BrandMark size={44} />
          <View>
            <Text accessibilityRole="header" style={[type.title, { color: palette.text }]}>{tr.onboarding.welcome}</Text>
            <Body muted>{tr.onboarding.intro}</Body>
          </View>
        </Row>

        {hasImport ? (
          <Card style={{ borderColor: palette.positive, backgroundColor: palette.positive + "14" }}>
            <Body style={{ color: palette.positiveText }}>{tr.onboarding.importedBanner(importedYears.join(", "))}</Body>
          </Card>
        ) : null}

        {!advancedSetup ? (
          <Card>
            <Heading style={{ marginTop: 0 }}>{tr.onboarding.quickTitle}</Heading>
            <Body muted style={{ marginBottom: spacing.md }}>{tr.onboarding.quickHint}</Body>
            <MoneyField
              label={tr.onboarding.quickBalance}
              value={hasImport ? "" : openingRaw}
              disabled={hasImport}
              onChangeMinor={(raw, minor) => {
                setOpeningRaw(raw);
                setOpeningMinor(minor);
              }}
            />
            <Body muted style={{ fontSize: 12, marginBottom: spacing.md }}>
              {hasImport ? tr.onboarding.importedOpeningNote : tr.onboarding.quickDefaults(selectedTemplate.length)}
            </Body>
            <Button label={tr.onboarding.quickStart} onPress={() => void commit()} loading={busy} />
            <Button
              label={tr.onboarding.customizeSetup}
              variant="ghost"
              onPress={() => setAdvancedSetup(true)}
            />
            {!hasImport ? (
              <View style={{ marginTop: spacing.md }}>
                <Heading>{tr.onboarding.existingDataTitle}</Heading>
                <Body muted style={{ marginBottom: spacing.xs }}>{tr.onboarding.existingDataHint}</Body>
                <ListRow icon={FileSpreadsheet} title={tr.onboarding.historyExcel} subtitle={tr.onboarding.historyExcelDesc} chevron onPress={() => void openImporter("excel")} />
                <ListRow icon={FileUp} title={tr.onboarding.historyJson} subtitle={tr.onboarding.historyJsonDesc} chevron onPress={() => void openImporter("json")} />
              </View>
            ) : null}
          </Card>
        ) : (
          <>
        <Card>
          <Heading>1 · {tr.onboarding.templateTitle}</Heading>
          <Body muted style={{ marginBottom: spacing.sm }}>{hasImport ? tr.onboarding.importedTemplateNote : tr.onboarding.templateHint}</Body>
          <Row gap={spacing.sm} style={{ marginBottom: spacing.sm, alignItems: "center" }}>
            <Button
              label={tr.common.selectAll}
              variant="ghost"
              size="sm"
              disabled={selectedTemplate.length === ALL_TEMPLATES.length}
              onPress={() => setSelectedTemplate(ALL_TEMPLATES.map((c) => c.name))}
            />
            <Button
              label={tr.common.clearAll}
              variant="ghost"
              size="sm"
              disabled={selectedTemplate.length === 0}
              onPress={() => setSelectedTemplate([])}
            />
          </Row>
          <ChipPicker
            multi
            options={ALL_TEMPLATES.map((c) => ({ value: c.name, label: templateLabel(c) }))}
            values={selectedTemplate}
            onToggle={toggleTemplate}
          />
          {selectedTemplate.length === 0 ? (
            <Body muted style={{ fontSize: 12 }}>{tr.onboarding.templateBlankNote}</Body>
          ) : null}
        </Card>

        <Card>
          <Heading>2 · {tr.onboarding.startTitle}</Heading>
          <Body muted style={{ marginBottom: spacing.sm }}>{tr.onboarding.startMonth}</Body>
          <Spread style={{ marginBottom: spacing.md }}>
            <IconButton icon={ChevronLeft} label={tr.onboarding.startMonth} onPress={() => setStartMonth(addMonthsToKey(startMonth, -1))} />
            <Heading>{monthLabel(startMonth)}</Heading>
            <IconButton
              icon={ChevronRight}
              label={tr.onboarding.startMonth}
              disabled={isCurrentOrFutureMonth(startMonth)}
              onPress={() => setStartMonth(addMonthsToKey(startMonth, 1))}
            />
          </Spread>
          <MoneyField
            label={tr.onboarding.openingBalance}
            value={hasImport ? "" : openingRaw}
            disabled={hasImport}
            onChangeMinor={(raw, minor) => {
              setOpeningRaw(raw);
              setOpeningMinor(minor);
            }}
          />
          <Body muted>{hasImport ? tr.onboarding.importedOpeningNote : tr.onboarding.openingHint}</Body>
        </Card>

        <Card>
          <Heading>3 · {tr.onboarding.personsTitle}</Heading>
          <Body muted style={{ marginBottom: spacing.md }}>{tr.onboarding.personsHint}</Body>
          {persons.map((name, i) =>
            editingPerson === i ? (
              <Row key={`edit-${i}`} gap={spacing.sm} style={{ marginBottom: spacing.sm, alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Field accessibilityLabel={`${tr.common.edit} · ${tr.onboarding.addPerson}`} noMargin value={editPersonName} onChangeText={setEditPersonName} autoFocus />
                </View>
                <Button
                  label={tr.common.save}
                  variant="secondary"
                  disabled={!editPersonName.trim()}
                  onPress={() => {
                    setPersons(persons.map((p, j) => (j === i ? editPersonName.trim() : p)));
                    setEditingPerson(null);
                  }}
                />
                <Button label={tr.common.cancel} variant="ghost" onPress={() => setEditingPerson(null)} />
              </Row>
            ) : (
              <Spread key={`${name}-${i}`} style={{ marginBottom: spacing.sm, alignItems: "center" }}>
                <Body style={{ flex: 1, paddingRight: spacing.sm }}>{name}{i === 0 ? ` · ${tr.persons.selfBadge}` : ""}</Body>
                <Row gap={spacing.sm} style={{ alignItems: "center" }}>
                  <IconButton icon={Pencil} label={tr.common.edit} onPress={() => { setEditingPerson(i); setEditPersonName(name); }} />
                  {i > 0 ? (
                    <IconButton
                      icon={Trash2}
                      tone="danger"
                      label={tr.common.delete}
                      onPress={() => removePerson(i)}
                    />
                  ) : null}
                </Row>
              </Spread>
            ),
          )}
          <Row style={{ alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Field accessibilityLabel={tr.onboarding.addPerson} noMargin value={newPerson} onChangeText={setNewPerson} placeholder={personPlaceholder} />
            </View>
            <Button
              label={tr.onboarding.addPerson}
              variant="secondary"
              disabled={!newPerson.trim()}
              onPress={() => {
                setPersons([...persons, newPerson.trim()]);
                setNewPerson("");
              }}
            />
          </Row>
        </Card>

        <Card>
          <Heading>4 · {tr.onboarding.sourcesTitle}</Heading>
          <Body muted style={{ marginBottom: spacing.md }}>{tr.onboarding.sourcesHint}</Body>
          {sources.map((src, i) => (
            <Spread key={`${src.name}-${i}`} style={{ marginBottom: spacing.sm, alignItems: "center" }}>
              <View style={{ flex: 1, paddingRight: spacing.sm }}>
                <Body>
                  {src.name} · {SOURCE_TYPES.find((t) => t.value === src.type)?.label}
                  {src.type === "credit_card" ? ` · ${src.statementDay}/${src.dueDay}` : ""}
                  {persons.length > 1 ? ` · ${persons[src.personIndex] ?? persons[0]}` : ""}
                </Body>
              </View>
              <Row gap={spacing.sm} style={{ alignItems: "center" }}>
                <IconButton icon={Pencil} label={tr.common.edit} onPress={() => editSource(i)} />
                <IconButton
                  icon={Trash2}
                  tone="danger"
                  label={tr.common.delete}
                  onPress={() => {
                    setSources(sources.filter((_, j) => j !== i));
                    if (editingSource === i) resetSourceForm();
                  }}
                />
              </Row>
            </Spread>
          ))}
          <Field accessibilityLabel={tr.onboarding.addSource} value={newSource} onChangeText={setNewSource} placeholder={sourcePlaceholder} />
          <ChipPicker
            options={SOURCE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            value={newSourceType}
            onChange={setNewSourceType}
          />
          {newSourceType === "credit_card" ? (
            <>
              <Row>
                <View style={{ flex: 1 }}>
                  <Field
                    label={tr.sources.statementDay}
                    value={newSourceStatementDay}
                    onChangeText={setNewSourceStatementDay}
                    placeholder={tr.sources.dayPlaceholder}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label={tr.sources.dueDay}
                    value={newSourceDueDay}
                    onChangeText={setNewSourceDueDay}
                    placeholder={tr.sources.dayPlaceholder}
                    keyboardType="number-pad"
                  />
                </View>
              </Row>
              <Body muted style={{ marginBottom: spacing.md }}>{tr.sources.cycleHint}</Body>
            </>
          ) : null}
          {persons.length > 1 ? (
            <ChipPicker
              options={persons.map((p, i) => ({ value: String(i) as never, label: `${tr.sources.owner}: ${p}` }))}
              value={String(newSourcePerson) as never}
              onChange={(v) => setNewSourcePerson(Number(v))}
            />
          ) : null}
          <Row gap={spacing.sm} style={{ alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Button
                label={editingSource != null ? tr.onboarding.updateSource : tr.onboarding.addSource}
                variant="secondary"
                disabled={
                  !newSource.trim() ||
                  (newSourceType === "credit_card" &&
                    ![newSourceStatementDay, newSourceDueDay].every((value) => {
                      const day = Number(value);
                      return value.trim() !== "" && Number.isInteger(day) && day >= 1 && day <= 31;
                    }))
                }
                onPress={submitSource}
              />
            </View>
            {editingSource != null ? <Button label={tr.common.cancel} variant="ghost" onPress={resetSourceForm} /> : null}
          </Row>
        </Card>

        <Card>
          <Heading>5 · {tr.onboarding.historyPrompt}</Heading>
          <Body muted style={{ marginBottom: spacing.sm }}>{tr.onboarding.historyHint}</Body>
          <ListRow icon={CalendarPlus} title={tr.onboarding.historyManual} subtitle={tr.onboarding.historyManualDesc} chevron onPress={() => void openImporter("manual")} />
          <ListRow icon={FileSpreadsheet} title={tr.onboarding.historyExcel} subtitle={tr.onboarding.historyExcelDesc} chevron onPress={() => void openImporter("excel")} />
          <ListRow icon={FileUp} title={tr.onboarding.historyJson} subtitle={tr.onboarding.historyJsonDesc} chevron onPress={() => void openImporter("json")} />
          {seeded ? <Body muted style={{ fontSize: 12, marginTop: spacing.sm }}>{tr.onboarding.historySeeded}</Body> : null}
        </Card>

        <Button label={tr.onboarding.finishStart} onPress={() => void commit()} loading={busy} />
        <Button label={tr.onboarding.quickMode} variant="ghost" onPress={() => setAdvancedSetup(false)} />
          </>
        )}
        <View style={{ height: spacing.xl }} />
      </View>
    </Screen>
  );
}
