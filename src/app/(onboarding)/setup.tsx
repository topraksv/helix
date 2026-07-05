import React, { useState } from "react";
import { Alert, Platform, View } from "react-native";
import { useRouter } from "expo-router";
import { seedWorkspace } from "../../data/repo";
import { useSession } from "../../auth/session";
import { addMonthsToKey, monthKeyOf, todayISO } from "../../domain/dates";
import type { PaymentSourceType } from "../../domain/types";
import { monthLabel, tr } from "../../i18n/tr";
import { Body, Button, Card, ChipPicker, Field, Heading, MoneyField, Row, Screen, Segmented, Spread, Title } from "../../ui/components";
import { spacing } from "../../ui/theme";

const SOURCE_TYPES: { value: PaymentSourceType; label: string }[] = [
  { value: "credit_card", label: tr.sources.credit_card },
  { value: "debit_card", label: tr.sources.debit_card },
  { value: "cash", label: tr.sources.cash },
  { value: "bank_transfer", label: tr.sources.bank_transfer },
];

interface DraftSource {
  name: string;
  type: PaymentSourceType;
  personIndex: number;
}

export default function SetupScreen() {
  const { userId } = useSession();
  const router = useRouter();
  const [template, setTemplate] = useState<"excel" | "blank">("excel");
  const [startMonth, setStartMonth] = useState(monthKeyOf(todayISO()));
  const [openingRaw, setOpeningRaw] = useState("");
  const [openingMinor, setOpeningMinor] = useState<number | null>(0);
  const [persons, setPersons] = useState<string[]>([tr.onboarding.me]);
  const [newPerson, setNewPerson] = useState("");
  const [sources, setSources] = useState<DraftSource[]>([]);
  const [newSource, setNewSource] = useState("");
  const [newSourceType, setNewSourceType] = useState<PaymentSourceType>("credit_card");
  const [newSourcePerson, setNewSourcePerson] = useState(0);
  const [busy, setBusy] = useState(false);

  const finish = async (goHistory: boolean) => {
    if (!userId) return;
    setBusy(true);
    try {
      await seedWorkspace(userId, {
        template,
        startMonth,
        openingBalanceMinor: openingMinor ?? 0,
        persons: persons.map((name, i) => ({ name, isSelf: i === 0 })),
        sources: sources.map((src) => ({ name: src.name, type: src.type, personIndex: src.personIndex })),
      });
      router.replace(goHistory ? "/bulk-entry" : "/(tabs)");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (Platform.OS === "web") window.alert(message);
      else Alert.alert("Hata", message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ maxWidth: 560, width: "100%", alignSelf: "center" }}>
        <Title>{tr.onboarding.welcome}</Title>
        <Body muted style={{ marginBottom: spacing.lg }}>{tr.onboarding.intro}</Body>

        <Card>
          <Heading>{tr.onboarding.templateTitle}</Heading>
          <Segmented
            options={[
              { value: "excel", label: tr.onboarding.templateExcel },
              { value: "blank", label: tr.onboarding.templateBlank },
            ]}
            value={template}
            onChange={setTemplate}
          />
          <Body muted>
            {template === "excel" ? tr.onboarding.templateExcelDesc : tr.onboarding.templateBlankDesc}
          </Body>
        </Card>

        <Card>
          <Heading>{tr.onboarding.startTitle}</Heading>
          <Body muted style={{ marginBottom: spacing.sm }}>{tr.onboarding.startMonth}</Body>
          <Spread style={{ marginBottom: spacing.md }}>
            <Button label="◀" variant="secondary" onPress={() => setStartMonth(addMonthsToKey(startMonth, -1))} />
            <Heading>{monthLabel(startMonth)}</Heading>
            <Button label="▶" variant="secondary" onPress={() => setStartMonth(addMonthsToKey(startMonth, 1))} />
          </Spread>
          <MoneyField
            label={`${tr.onboarding.openingBalance} (₺)`}
            value={openingRaw}
            onChangeMinor={(raw, minor) => {
              setOpeningRaw(raw);
              setOpeningMinor(minor);
            }}
          />
          <Body muted>{tr.onboarding.openingHint}</Body>
        </Card>

        <Card>
          <Heading>{tr.onboarding.personsTitle}</Heading>
          <Body muted style={{ marginBottom: spacing.md }}>{tr.onboarding.personsHint}</Body>
          {persons.map((name, i) => (
            <Spread key={`${name}-${i}`} style={{ marginBottom: spacing.sm }}>
              <Body>{name}{i === 0 ? " (ben)" : ""}</Body>
              {i > 0 ? (
                <Button label={tr.common.delete} variant="ghost" onPress={() => setPersons(persons.filter((_, j) => j !== i))} />
              ) : null}
            </Spread>
          ))}
          <Row>
            <View style={{ flex: 1 }}>
              <Field value={newPerson} onChangeText={setNewPerson} placeholder={tr.placeholders.personName} />
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
          <Heading>{tr.onboarding.sourcesTitle}</Heading>
          <Body muted style={{ marginBottom: spacing.md }}>{tr.onboarding.sourcesHint}</Body>
          {sources.map((src, i) => (
            <Spread key={`${src.name}-${i}`} style={{ marginBottom: spacing.sm }}>
              <Body>
                {src.name} · {SOURCE_TYPES.find((t) => t.value === src.type)?.label} · {persons[src.personIndex]}
              </Body>
              <Button label={tr.common.delete} variant="ghost" onPress={() => setSources(sources.filter((_, j) => j !== i))} />
            </Spread>
          ))}
          <Field value={newSource} onChangeText={setNewSource} placeholder={tr.placeholders.setupSourceName} />
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
          <Button
            label={tr.onboarding.addSource}
            variant="secondary"
            disabled={!newSource.trim()}
            onPress={() => {
              setSources([...sources, { name: newSource.trim(), type: newSourceType, personIndex: newSourcePerson }]);
              setNewSource("");
            }}
          />
        </Card>

        <Card>
          <Heading>{tr.onboarding.historyPrompt}</Heading>
          <View style={{ gap: spacing.sm }}>
            <Button label={tr.onboarding.historyYes} onPress={() => void finish(true)} loading={busy} />
            <Button label={tr.onboarding.historyLater} variant="secondary" onPress={() => void finish(false)} disabled={busy} />
          </View>
        </Card>
      </View>
    </Screen>
  );
}
