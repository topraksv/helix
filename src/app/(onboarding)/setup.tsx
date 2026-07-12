import React, { useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { CalendarPlus, ChevronLeft, ChevronRight, FileSpreadsheet, FileUp, Pencil, Trash2 } from "lucide-react-native";
import { finalizeOnboarding, seedWorkspace, TEMPLATE_CATEGORIES, TEMPLATE_EXTRA_CATEGORIES, type TemplateCategory } from "../../data/repo";
import { importBundle } from "../../services/export-import";
import { useSession } from "../../auth/session";
import { addMonthsToKey, monthKeyOf, todayISO } from "../../domain/dates";
import { PAYMENT_SOURCE_TYPES, type PaymentSourceType } from "../../domain/types";
import { monthLabel, tr } from "../../i18n/tr";
import { Body, Button, Card, ChipPicker, Field, Heading, IconButton, ListRow, MoneyField, Row, Screen, Spread } from "../../ui/components";
import { appAlert } from "../../ui/dialog";
import { BrandMark } from "../../ui/brand";
import { placeholderPools, useRotatingPlaceholder } from "../../ui/placeholders";
import { spacing, type, useTheme } from "../../ui/theme";

const SOURCE_TYPES = PAYMENT_SOURCE_TYPES.map((value) => ({ value, label: tr.sources[value] }));
const ALL_TEMPLATES: TemplateCategory[] = [...TEMPLATE_CATEGORIES, ...TEMPLATE_EXTRA_CATEGORIES];
const templateLabel = (c: TemplateCategory) => `${c.icon ?? ""} ${c.name}`.trim();

interface DraftSource {
  name: string;
  type: PaymentSourceType;
  personIndex: number;
}

type HistoryChoice = "manual" | "excel" | "json";

export default function SetupScreen() {
  const { userId } = useSession();
  const router = useRouter();
  const { palette } = useTheme();
  // Template: every recommended category is shown and pre-selected; the user
  // unticks the ones they don't want.
  const [selectedTemplate, setSelectedTemplate] = useState<string[]>(ALL_TEMPLATES.map((c) => c.name));
  const [startMonth, setStartMonth] = useState(monthKeyOf(todayISO()));
  const [openingRaw, setOpeningRaw] = useState("");
  const [openingMinor, setOpeningMinor] = useState<number | null>(0);
  const [persons, setPersons] = useState<string[]>([tr.onboarding.me]);
  const [newPerson, setNewPerson] = useState("");
  const [sources, setSources] = useState<DraftSource[]>([]);
  const [newSource, setNewSource] = useState("");
  const [newSourceType, setNewSourceType] = useState<PaymentSourceType>("credit_card");
  const [newSourcePerson, setNewSourcePerson] = useState(0);
  const [editingSource, setEditingSource] = useState<number | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggleTemplate = (name: string) =>
    setSelectedTemplate((xs) => (xs.includes(name) ? xs.filter((x) => x !== name) : [...xs, name]));

  const resetSourceForm = () => {
    setNewSource("");
    setNewSourceType("credit_card");
    setNewSourcePerson(0);
    setEditingSource(null);
  };

  const submitSource = () => {
    const draft: DraftSource = { name: newSource.trim(), type: newSourceType, personIndex: newSourcePerson };
    if (editingSource != null) {
      setSources((xs) => xs.map((s, i) => (i === editingSource ? draft : s)));
    } else {
      setSources((xs) => [...xs, draft]);
    }
    resetSourceForm();
  };

  const editSource = (i: number) => {
    const s = sources[i];
    setNewSource(s.name);
    setNewSourceType(s.type);
    setNewSourcePerson(Math.min(s.personIndex, persons.length - 1));
    setEditingSource(i);
  };

  const importJsonBackup = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: "application/json", copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets[0] || !userId) return;
    const content = await new File(picked.assets[0].uri).text();
    await importBundle(userId, JSON.parse(content));
  };

  // Seed the workspace exactly once (persons/sources/categories/opening). The
  // importers below need a real workspace to write into, so seeding happens
  // before them — but onboarding is finalized only by "save & start", so the
  // user can import, come back here, review, and then commit.
  const ensureSeeded = async (): Promise<boolean> => {
    if (!userId) return false;
    if (seeded) return true;
    await seedWorkspace(userId, {
      templateCategories: ALL_TEMPLATES.filter((c) => selectedTemplate.includes(c.name)),
      startMonth,
      openingBalanceMinor: openingMinor ?? 0,
      persons: persons.map((name, i) => ({ name, isSelf: i === 0 })),
      sources: sources.map((src) => ({ name: src.name, type: src.type, personIndex: src.personIndex })),
    });
    setSeeded(true);
    return true;
  };

  const openImporter = async (choice: HistoryChoice) => {
    if (!userId || busy) return;
    setBusy(true);
    try {
      if (!(await ensureSeeded())) return;
      if (choice === "manual") router.push("/bulk-entry");
      else if (choice === "excel") router.push("/import-wizard");
      else if (choice === "json") {
        try {
          await importJsonBackup();
        } catch (e) {
          void appAlert(e instanceof Error ? e.message : String(e), tr.errors.title);
        }
      }
    } catch (e) {
      void appAlert(e instanceof Error ? e.message : String(e), tr.errors.title);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!userId || busy) return;
    setBusy(true);
    try {
      await ensureSeeded();
      await finalizeOnboarding(userId);
      router.replace("/(tabs)");
    } catch (e) {
      void appAlert(e instanceof Error ? e.message : String(e), tr.errors.title);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen maxWidth={560}>
      <View>
        <Row gap={spacing.md} style={{ marginBottom: spacing.lg }}>
          <BrandMark size={44} />
          <View>
            <Text style={[type.title, { color: palette.text }]}>{tr.onboarding.welcome}</Text>
            <Body muted>{tr.onboarding.intro}</Body>
          </View>
        </Row>

        <Card>
          <Heading>1 · {tr.onboarding.templateTitle}</Heading>
          <Body muted style={{ marginBottom: spacing.md }}>{tr.onboarding.templateHint}</Body>
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
            <IconButton icon={ChevronRight} label={tr.onboarding.startMonth} onPress={() => setStartMonth(addMonthsToKey(startMonth, 1))} />
          </Spread>
          <MoneyField
            label={tr.onboarding.openingBalance}
            value={openingRaw}
            onChangeMinor={(raw, minor) => {
              setOpeningRaw(raw);
              setOpeningMinor(minor);
            }}
          />
          <Body muted>{tr.onboarding.openingHint}</Body>
        </Card>

        <Card>
          <Heading>3 · {tr.onboarding.personsTitle}</Heading>
          <Body muted style={{ marginBottom: spacing.md }}>{tr.onboarding.personsHint}</Body>
          {persons.map((name, i) => (
            <Spread key={`${name}-${i}`} style={{ marginBottom: spacing.sm, alignItems: "center" }}>
              <Body>{name}{i === 0 ? ` · ${tr.persons.selfBadge}` : ""}</Body>
              {i > 0 ? (
                <IconButton icon={Trash2} tone="danger" label={tr.common.delete} onPress={() => setPersons(persons.filter((_, j) => j !== i))} />
              ) : null}
            </Spread>
          ))}
          <Row style={{ alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Field noMargin value={newPerson} onChangeText={setNewPerson} placeholder={useRotatingPlaceholder(placeholderPools.person)} />
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
                  {persons.length > 1 ? ` · ${persons[src.personIndex]}` : ""}
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
          <Field value={newSource} onChangeText={setNewSource} placeholder={useRotatingPlaceholder(placeholderPools.source)} />
          <ChipPicker
            options={SOURCE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            value={newSourceType}
            onChange={setNewSourceType}
          />
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
                disabled={!newSource.trim()}
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
        <View style={{ height: spacing.xl }} />
      </View>
    </Screen>
  );
}
