import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import CalendarPlus from "lucide-react-native/icons/calendar-plus";
import ChartNoAxesCombined from "lucide-react-native/icons/chart-no-axes-combined";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import FileSpreadsheet from "lucide-react-native/icons/file-spreadsheet";
import FileUp from "lucide-react-native/icons/file-up";
import Pencil from "lucide-react-native/icons/pencil";
import Trash from "lucide-react-native/icons/trash";
import WalletCards from "lucide-react-native/icons/wallet-cards";
import { finalizeOnboarding, hasImportedData, seedWorkspace, TEMPLATE_CATEGORIES, TEMPLATE_EXTRA_CATEGORIES, type TemplateCategory } from "../../data/repo";
import { importBundle, MAX_BACKUP_BYTES, parseExportBundleText } from "../../services/export-import";
import { useSession } from "../../auth/session";
import { useSettingsMapState } from "../../data/hooks";
import { combineLiveStates } from "../../data/live-state";
import { addMonthsToKey, isCurrentOrFutureMonth, isMonthDay, monthKeyOf, todayISO } from "../../domain/dates";
import { remapDraftOwnerIndex } from "../../domain/onboarding";
import { PAYMENT_SOURCE_TYPES, type PaymentSourceType } from "../../domain/types";
import { monthLabel, tr } from "../../i18n/tr";
import { Body, Button, Card, ChipPicker, DataGateScreen, DataStateNotice, Field, Heading, IconButton, ListRow, MoneyField, Row, Screen, SelectionGrid, Spread } from "../../ui/components";
import { appAlert } from "../../ui/dialog";
import { BrandMark } from "../../ui/brand";
import { placeholderPools, useRotatingPlaceholder } from "../../ui/placeholders";
import { density, font, radius, spacing, type, useTheme } from "../../ui/theme";
import { useOperationGuard } from "../../ui/operation-guard";
import { readPickedText } from "../../services/picked-file";
import { monthDayLabel } from "../../ui/month-day-field";
import { CardCycleFields, cardCycleError } from "../../ui/card-cycle-fields";
import { useDirtyExitGuard } from "../../ui/dirty-exit";
import { userMessage } from "../../domain/user-error";
import { devError } from "../../services/logger";

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

function OnboardingJourney() {
  const { palette } = useTheme();
  const steps = [
    { icon: WalletCards, label: tr.onboarding.journeySetup, color: palette.primary, soft: palette.primarySoft },
    { icon: FileSpreadsheet, label: tr.onboarding.journeyImport, color: palette.secondary, soft: palette.secondarySoft },
    { icon: ChartNoAxesCombined, label: tr.onboarding.journeyFollow, color: palette.tertiary, soft: palette.tertiarySoft },
  ];
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={steps.map((step) => step.label).join(", ")}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        borderRadius: radius.lg,
        backgroundColor: palette.surfaceAlt,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border + "80",
        padding: spacing.md,
        marginBottom: spacing.md,
        overflow: "hidden",
      }}
    >
      {steps.map((step, index) => {
        const Icon = step.icon;
        return (
          <React.Fragment key={step.label}>
            <View style={{ flex: 1, minWidth: 0, alignItems: "center" }}>
              <View style={{ width: 42, height: 42, borderRadius: radius.lg, backgroundColor: step.soft, alignItems: "center", justifyContent: "center" }}>
                <Icon accessible={false} size={20} color={step.color} strokeWidth={1.9} />
              </View>
              <Text style={[type.small, { color: palette.text, fontFamily: font.semibold, textAlign: "center", marginTop: spacing.xs }]}>
                {step.label}
              </Text>
            </View>
            {index < steps.length - 1 ? (
              <View style={{ width: spacing.lg, height: 1, marginTop: 21, backgroundColor: palette.border }} />
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

/** The people a new workspace starts with; the first is the account holder. */
function usePersonDrafts(onRemoved: (index: number) => void) {
  const [persons, setPersons] = useState<string[]>([tr.onboarding.me]);
  const [newPerson, setNewPerson] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  return {
    persons, newPerson, setNewPerson, editing, editName, setEditName,
    dirty: JSON.stringify(persons) !== JSON.stringify([tr.onboarding.me]) || newPerson.trim() !== "" || (editing != null && editName.trim() !== (persons[editing] ?? "")),
    add: () => {
      setPersons([...persons, newPerson.trim()]);
      setNewPerson("");
    },
    startEdit: (index: number) => {
      setEditing(index);
      setEditName(persons[index] ?? "");
    },
    cancelEdit: () => setEditing(null),
    saveEdit: () => {
      setPersons(persons.map((name, index) => (index === editing ? editName.trim() : name)));
      setEditing(null);
    },
    remove: (removed: number) => {
      setPersons((current) => current.filter((_, index) => index !== removed));
      onRemoved(removed);
      setEditing((current) => (current == null || current < removed ? current : current === removed ? null : current - 1));
    },
  };
}

const EMPTY_SOURCE_FORM = { name: "", type: "credit_card" as PaymentSourceType, personIndex: 0, statementDay: "", dueDay: "" };

/** The payment sources a new workspace starts with, and the form that adds or edits one. */
function useSourceDrafts() {
  const [sources, setSources] = useState<DraftSource[]>([]);
  const [form, setForm] = useState(EMPTY_SOURCE_FORM);
  const [editing, setEditing] = useState<number | null>(null);
  const onCard = form.type === "credit_card";
  const reset = () => {
    setForm(EMPTY_SOURCE_FORM);
    setEditing(null);
  };
  return {
    sources, form, editing, reset,
    patch: (next: Partial<typeof EMPTY_SOURCE_FORM>) => setForm((current) => ({ ...current, ...next })),
    dirty: sources.length > 0 || editing != null || JSON.stringify({ ...form, name: form.name.trim(), statementDay: form.statementDay.trim(), dueDay: form.dueDay.trim() }) !== JSON.stringify(EMPTY_SOURCE_FORM),
    // The same rule the settings editor applies: a card created here must be one that screen can reopen.
    valid: form.name.trim() !== "" && (!onCard || ([form.statementDay, form.dueDay].every(isMonthDay) && cardCycleError(Number(form.statementDay), Number(form.dueDay)) === null)),
    submit: () => {
      const draft: DraftSource = {
        name: form.name.trim(),
        type: form.type,
        personIndex: form.personIndex,
        statementDay: onCard ? Number(form.statementDay) : null,
        dueDay: onCard ? Number(form.dueDay) : null,
      };
      setSources((current) => (editing != null ? current.map((source, index) => (index === editing ? draft : source)) : [...current, draft]));
      reset();
    },
    edit: (index: number, personCount: number) => {
      const source = sources[index];
      if (!source) return;
      setForm({
        name: source.name,
        type: source.type,
        personIndex: Math.min(source.personIndex, personCount - 1),
        statementDay: source.statementDay == null ? "" : String(source.statementDay),
        dueDay: source.dueDay == null ? "" : String(source.dueDay),
      });
      setEditing(index);
    },
    remove: (index: number) => {
      setSources(sources.filter((_, other) => other !== index));
      if (editing === index) reset();
    },
    /** A removed person's sources move to whoever takes their place in the list. */
    personRemoved: (removed: number) => {
      setSources((current) => current.map((source) => ({ ...source, personIndex: remapDraftOwnerIndex(source.personIndex, removed) })));
      setForm((current) => ({ ...current, personIndex: remapDraftOwnerIndex(current.personIndex, removed) }));
    },
  };
}

type PersonDrafts = ReturnType<typeof usePersonDrafts>;
type SourceDrafts = ReturnType<typeof useSourceDrafts>;

function TemplateStep({ selected, onSelected, hasImport }: { selected: string[]; onSelected: (next: string[]) => void; hasImport: boolean }) {
  return (
    <Card>
      <Heading>1 · {tr.onboarding.templateTitle}</Heading>
      <Body muted style={{ marginBottom: spacing.sm }}>{hasImport ? tr.onboarding.importedTemplateNote : tr.onboarding.templateHint}</Body>
      <Row gap={spacing.sm} style={{ marginBottom: spacing.sm, alignItems: "center" }}>
        <Button label={tr.common.selectAll} variant="ghost" size="sm" disabled={selected.length === ALL_TEMPLATES.length} onPress={() => onSelected(ALL_TEMPLATES.map((c) => c.name))} />
        <Button label={tr.common.clearAll} variant="ghost" size="sm" disabled={selected.length === 0} onPress={() => onSelected([])} />
      </Row>
      <SelectionGrid
        options={ALL_TEMPLATES.map((c) => ({ value: c.name, label: templateLabel(c) }))}
        values={selected}
        onToggle={(name) => onSelected(selected.includes(name) ? selected.filter((x) => x !== name) : [...selected, name])}
        searchable
      />
      {selected.length === 0 ? <Body muted style={{ fontSize: type.small.fontSize }}>{tr.onboarding.templateBlankNote}</Body> : null}
    </Card>
  );
}

function PersonsStep({ drafts }: { drafts: PersonDrafts }) {
  const placeholder = useRotatingPlaceholder(placeholderPools.person);
  return (
    <Card>
      <Heading>3 · {tr.onboarding.personsTitle}</Heading>
      <Body muted style={{ marginBottom: spacing.md }}>{tr.onboarding.personsHint}</Body>
      {drafts.persons.map((name, i) =>
        drafts.editing === i ? (
          <Row key={`edit-${i}`} gap={spacing.sm} style={{ marginBottom: spacing.sm, alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Field accessibilityLabel={`${tr.common.edit} · ${tr.onboarding.addPerson}`} noMargin value={drafts.editName} onChangeText={drafts.setEditName} autoFocus />
            </View>
            <Button label={tr.common.save} variant="secondary" disabled={!drafts.editName.trim()} onPress={drafts.saveEdit} />
            <Button label={tr.common.cancel} variant="ghost" onPress={drafts.cancelEdit} />
          </Row>
        ) : (
          <Spread key={`${name}-${i}`} style={{ marginBottom: spacing.sm, alignItems: "center" }}>
            <Body style={{ flex: 1, paddingRight: spacing.sm }}>{name}{i === 0 ? ` · ${tr.persons.selfBadge}` : ""}</Body>
            <Row gap={spacing.sm} style={{ alignItems: "center" }}>
              <IconButton icon={Pencil} label={`${tr.common.edit} · ${name}`} onPress={() => drafts.startEdit(i)} />
              {i > 0 ? <IconButton icon={Trash} tone="danger" label={`${tr.common.delete} · ${name}`} onPress={() => drafts.remove(i)} /> : null}
            </Row>
          </Spread>
        ),
      )}
      <Row style={{ alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Field accessibilityLabel={tr.onboarding.addPerson} noMargin value={drafts.newPerson} onChangeText={drafts.setNewPerson} placeholder={placeholder} />
        </View>
        <Button label={tr.onboarding.addPerson} variant="secondary" disabled={!drafts.newPerson.trim()} onPress={drafts.add} />
      </Row>
    </Card>
  );
}

function SourcesStep({ drafts, persons }: { drafts: SourceDrafts; persons: string[] }) {
  const placeholder = useRotatingPlaceholder(placeholderPools.source);
  const { form } = drafts;
  return (
    <Card>
      <Heading>4 · {tr.onboarding.sourcesTitle}</Heading>
      <Body muted style={{ marginBottom: spacing.md }}>{tr.onboarding.sourcesHint}</Body>
      {drafts.sources.map((src, i) => (
        <Spread key={`${src.name}-${i}`} style={{ marginBottom: spacing.sm, alignItems: "center" }}>
          <View style={{ flex: 1, paddingRight: spacing.sm }}>
            <Body>
              {src.name} · {SOURCE_TYPES.find((t) => t.value === src.type)?.label}
              {src.type === "credit_card" && src.statementDay != null && src.dueDay != null ? ` · ${monthDayLabel(src.statementDay)}/${monthDayLabel(src.dueDay)}` : ""}
              {persons.length > 1 ? ` · ${persons[src.personIndex] ?? persons[0]}` : ""}
            </Body>
          </View>
          <Row gap={spacing.sm} style={{ alignItems: "center" }}>
            <IconButton icon={Pencil} label={`${tr.common.edit} · ${src.name}`} onPress={() => drafts.edit(i, persons.length)} />
            <IconButton icon={Trash} tone="danger" label={`${tr.common.delete} · ${src.name}`} onPress={() => drafts.remove(i)} />
          </Row>
        </Spread>
      ))}
      <Field accessibilityLabel={tr.onboarding.addSource} value={form.name} onChangeText={(name) => drafts.patch({ name })} placeholder={placeholder} />
      <ChipPicker options={SOURCE_TYPES.map((t) => ({ value: t.value, label: t.label }))} value={form.type} onChange={(type) => drafts.patch({ type })} />
      {form.type === "credit_card" ? (
        <CardCycleFields
          statementDayValue={form.statementDay}
          dueDayValue={form.dueDay}
          onStatementDayChange={(statementDay) => drafts.patch({ statementDay })}
          onDueDayChange={(dueDay) => drafts.patch({ dueDay })}
        />
      ) : null}
      {persons.length > 1 ? (
        <ChipPicker
          options={persons.map((p, i) => ({ value: String(i) as never, label: `${tr.sources.owner}: ${p}` }))}
          value={String(form.personIndex) as never}
          onChange={(v) => drafts.patch({ personIndex: Number(v) })}
        />
      ) : null}
      <Row gap={spacing.sm} style={{ alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Button label={drafts.editing != null ? tr.onboarding.updateSource : tr.onboarding.addSource} variant="secondary" disabled={!drafts.valid} onPress={drafts.submit} />
        </View>
        {drafts.editing != null ? <Button label={tr.common.cancel} variant="ghost" onPress={drafts.reset} /> : null}
      </Row>
    </Card>
  );
}

function HistoryImportRows({ onOpen, manual }: { onOpen: (choice: HistoryChoice) => void; manual: boolean }) {
  return (
    <>
      {manual ? <ListRow icon={CalendarPlus} title={tr.onboarding.historyManual} subtitle={tr.onboarding.historyManualDesc} chevron onPress={() => onOpen("manual")} /> : null}
      <ListRow icon={FileSpreadsheet} title={tr.onboarding.historyExcel} subtitle={tr.onboarding.historyExcelDesc} chevron onPress={() => onOpen("excel")} />
      <ListRow icon={FileUp} title={tr.onboarding.historyJson} subtitle={tr.onboarding.historyJsonDesc} chevron onPress={() => onOpen("json")} />
    </>
  );
}

export default function SetupScreen() {
  const { userId } = useSession();
  const router = useRouter();
  const { palette } = useTheme();
  // Detect a completed spreadsheet import (each imported year writes an
  // `import_batch:<year>` setting). When present, the workbook governs the
  // categories AND the opening balance, so the template + opening-balance
  // inputs become redundant — we clear the pre-ticked template once and tell
  // the user, instead of silently seeding duplicate/empty columns on top.
  const settingsState = useSettingsMapState();
  const importedYears = [...settingsState.data.keys()]
    .filter((k) => k.startsWith("import_batch:"))
    .map((k) => k.slice("import_batch:".length))
    .sort((a, b) => a.localeCompare(b));
  const hasImport = importedYears.length > 0;
  // Template: every recommended category is shown and pre-selected; the user
  // unticks the ones they don't want.
  const [selectedTemplate, setSelectedTemplate] = useState<string[]>(ALL_TEMPLATES.map((c) => c.name));
  const [startMonth, setStartMonth] = useState(monthKeyOf(todayISO()));
  const [opening, setOpening] = useState<{ raw: string; minor: number | null }>({ raw: "", minor: 0 });
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [advancedSetup, setAdvancedSetup] = useState(false);
  const [committed, setCommitted] = useState(false);
  const operationGuard = useOperationGuard();
  const initialStartMonth = useRef(startMonth).current;
  const sourceDrafts = useSourceDrafts();
  const personDrafts = usePersonDrafts(sourceDrafts.personRemoved);
  const { persons } = personDrafts;
  const draftDirty =
    JSON.stringify(selectedTemplate) !== JSON.stringify(hasImport ? [] : ALL_TEMPLATES.map((category) => category.name)) ||
    startMonth !== initialStartMonth ||
    opening.raw.trim() !== "" ||
    personDrafts.dirty ||
    sourceDrafts.dirty;
  const { allowExit } = useDirtyExitGuard(draftDirty && !busy && !committed);
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([settingsState]);

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

  // Seed the workspace (persons/sources/categories/opening) from the CURRENT
  // form values. `seedWorkspace` is idempotent (deterministic ids), so calling
  // it again — when an importer is opened, and again on commit — upserts the
  // same rows and re-applies the latest opening balance instead of duplicating
  // the workspace or dropping edits made after the first seed. Onboarding is
  // finalized only by "save & start", so the user can import, come back, review,
  // and then commit.
  //
  // A spreadsheet or JSON import brings its own columns, so seeding defaults
  // beside them creates stray columns. When `includeTemplates` isn't given (the
  // commit path), decide from PERSISTED import state — not the reactive
  // `hasImport` live query, which can still be false right after returning from
  // the wizard. If the import landed but the reactive auto-clear hasn't yet run,
  // seed none; once it has, `selectedTemplate` holds only what the user re-ticked.
  const ensureSeeded = async (includeTemplates?: boolean): Promise<boolean> => {
    if (!userId) return false;
    const include = includeTemplates ?? (!(await hasImportedData(userId)) || importClearedRef.current);
    await seedWorkspace(userId, {
      templateCategories: include ? ALL_TEMPLATES.filter((c) => selectedTemplate.includes(c.name)) : [],
      startMonth,
      openingBalanceMinor: opening.minor ?? 0,
      persons: persons.map((name, i) => ({ name, isSelf: i === 0 })),
      sources: sourceDrafts.sources.map(({ name, type, personIndex, statementDay, dueDay }) => ({ name, type, personIndex, statementDay, dueDay })),
    });
    setSeeded(true);
    return true;
  };

  const openImporter = (choice: HistoryChoice) => operationGuard.run(async () => {
    if (!userId) return;
    try {
      if (choice === "json") {
        // Pick the file FIRST, and only enter the loading state around the real
        // work — never around the picker, whose promise can fail to settle when
        // the OS dialog is dismissed and left the finish button spinning (P1-1).
        // Only a real, processed backup then shows the "prepared" note (P1-2).
        const picked = await DocumentPicker.getDocumentAsync({ type: "application/json", copyToCacheDirectory: true });
        if (picked.canceled || !picked.assets[0]) return;
        setBusy(true);
        const content = await readPickedText(picked.assets[0], MAX_BACKUP_BYTES, tr.errors.backupTooLarge, tr.errors.invalidBackupFile);
        // Validate and restore the complete workspace atomically. Seeding first
        // would leave a partial starter workspace behind when a corrupt backup
        // is rejected or the restore write fails.
        await importBundle(userId, parseExportBundleText(content));
        setSeeded(true);
        return;
      }
      setBusy(true);
      // Manual history writes into the selected templates; a spreadsheet import
      // brings its own columns, so don't pre-seed defaults beside them.
      if (!(await ensureSeeded(choice === "manual"))) return;
      allowExit(() => router.push(choice === "manual" ? "/bulk-entry" : "/import-wizard"));
    } catch (e) {
      devError("onboarding.import", e);
      void appAlert(userMessage(e, tr.errors.saveFailed), tr.errors.title);
    } finally {
      setBusy(false);
    }
  });

  const commit = () => operationGuard.run(async () => {
    if (!userId) return;
    setBusy(true);
    try {
      await ensureSeeded();
      await finalizeOnboarding(userId);
      setCommitted(true);
      // Navigation is driven by the root route guard once the live `onboarded`
      // flag flips true. Replacing to "/(tabs)" here fired while `onboarded` was
      // still false, and the (tabs)→blank→setup→(tabs) bounce white-screened on
      // iOS (React #185). The button stays loading until the guard unmounts
      // this screen; only a failure clears `busy`.
    } catch (e) {
      devError("onboarding.commit", e);
      void appAlert(userMessage(e, tr.errors.saveFailed), tr.errors.title);
      setBusy(false);
    }
  });

  if (!dataReady) return <DataGateScreen status={dataStatus} retry={retryData} width="focus" />;

  const openingField = (label: string) => (
    <MoneyField label={label} value={hasImport ? "" : opening.raw} disabled={hasImport} onChangeMinor={(raw, minor) => setOpening({ raw, minor })} />
  );
  return (
    <Screen width="focus">
      <View>
        <DataStateNotice status={dataStatus} retry={retryData} />
        <Row gap={spacing.md} style={{ marginBottom: spacing.lg }}>
          <BrandMark size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text accessibilityRole="header" style={[type.title, { color: palette.text }]}>{tr.onboarding.welcome}</Text>
            <Body muted>{tr.onboarding.intro}</Body>
          </View>
        </Row>
        <OnboardingJourney />
        {hasImport ? (
          <Card tone="success">
            <Body style={{ color: palette.successText }}>{tr.onboarding.importedBanner(importedYears.join(", "))}</Body>
          </Card>
        ) : null}
        {!advancedSetup ? (
          <Card>
            <Heading style={{ marginTop: 0 }}>{tr.onboarding.quickTitle}</Heading>
            <Body muted style={{ marginBottom: spacing.md }}>{tr.onboarding.quickHint}</Body>
            {openingField(tr.onboarding.quickBalance)}
            <Body muted style={{ fontSize: type.small.fontSize, marginBottom: spacing.md }}>
              {hasImport ? tr.onboarding.importedOpeningNote : tr.onboarding.quickDefaults(selectedTemplate.length)}
            </Body>
            <Button label={tr.onboarding.quickStart} onPress={() => void commit()} loading={busy} />
            <Button label={tr.onboarding.customizeSetup} variant="ghost" onPress={() => setAdvancedSetup(true)} />
            {!hasImport ? (
              <View style={{ marginTop: spacing.md }}>
                <Heading>{tr.onboarding.existingDataTitle}</Heading>
                <Body muted style={{ marginBottom: spacing.xs }}>{tr.onboarding.existingDataHint}</Body>
                <HistoryImportRows onOpen={(choice) => void openImporter(choice)} manual={false} />
              </View>
            ) : null}
          </Card>
        ) : (
          <>
            <TemplateStep selected={selectedTemplate} onSelected={setSelectedTemplate} hasImport={hasImport} />
            <Card>
              <Heading>2 · {tr.onboarding.startTitle}</Heading>
              <Body muted style={{ marginBottom: spacing.sm }}>{tr.onboarding.startMonth}</Body>
              <Spread style={{ marginBottom: spacing.md }}>
                <IconButton icon={ChevronLeft} label={tr.onboarding.startMonth} onPress={() => setStartMonth(addMonthsToKey(startMonth, -1))} />
                <Heading>{monthLabel(startMonth)}</Heading>
                <IconButton icon={ChevronRight} label={tr.onboarding.startMonth} disabled={isCurrentOrFutureMonth(startMonth)} onPress={() => setStartMonth(addMonthsToKey(startMonth, 1))} />
              </Spread>
              {openingField(tr.onboarding.openingBalance)}
              <Body muted>{hasImport ? tr.onboarding.importedOpeningNote : tr.onboarding.openingHint}</Body>
            </Card>
            <PersonsStep drafts={personDrafts} />
            <SourcesStep drafts={sourceDrafts} persons={persons} />
            {/* `rows`: the last history row can be the card's last child, and a
                pressable row at an edge lights all the way to it. The heading
                block carries the top padding the card gives up. */}
            <Card rows>
              <View style={{ paddingTop: density.list.cardPadding }}>
                <Heading style={{ marginTop: 0 }}>5 · {tr.onboarding.historyPrompt}</Heading>
                <Body muted style={{ marginBottom: spacing.sm }}>{tr.onboarding.historyHint}</Body>
              </View>
              <HistoryImportRows onOpen={(choice) => void openImporter(choice)} manual />
              {seeded ? (
                <Body muted style={{ fontSize: type.small.fontSize, marginTop: spacing.sm, marginBottom: density.list.cardPadding }}>{tr.onboarding.historySeeded}</Body>
              ) : null}
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
