import React, { useState } from "react";
import { Alert, Platform, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { seedWorkspace, TEMPLATE_CATEGORIES } from "../../data/repo";
import { useSession } from "../../auth/session";
import { addMonthsToKey, monthKeyOf, todayISO } from "../../domain/dates";
import { PAYMENT_SOURCE_TYPES, type PaymentSourceType } from "../../domain/types";
import { monthLabel, tr } from "../../i18n/tr";
import { Body, Button, Card, ChipPicker, Field, Heading, IconButton, MoneyField, Row, Screen, Segmented, Spread } from "../../ui/components";
import { BrandMark } from "../../ui/brand";
import { placeholderPools, useRotatingPlaceholder } from "../../ui/placeholders";
import { spacing, type, useTheme } from "../../ui/theme";

const SOURCE_TYPES = PAYMENT_SOURCE_TYPES.map((value) => ({ value, label: tr.sources[value] }));

interface DraftSource {
  name: string;
  type: PaymentSourceType;
  personIndex: number;
}

export default function SetupScreen() {
  const { userId } = useSession();
  const router = useRouter();
  const { palette } = useTheme();
  const [template, setTemplate] = useState<"excel" | "blank">("blank");
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
          <Segmented
            options={[
              { value: "blank", label: tr.onboarding.templateBlank },
              { value: "excel", label: tr.onboarding.templateExcel },
            ]}
            value={template}
            onChange={setTemplate}
          />
          <Body muted>
            {template === "excel" ? tr.onboarding.templateExcelDesc : tr.onboarding.templateBlankDesc}
          </Body>
          {template === "excel" ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md }}>
              {TEMPLATE_CATEGORIES.map((c) => (
                <View
                  key={c.name}
                  style={{
                    backgroundColor: palette.surfaceAlt,
                    borderRadius: 999,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs + 2,
                  }}
                >
                  <Text style={[type.small, { color: palette.text }]}>{c.icon} {c.name}</Text>
                </View>
              ))}
            </View>
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
            <Spread key={`${name}-${i}`} style={{ marginBottom: spacing.sm }}>
              <Body>{name}{i === 0 ? ` — ${tr.persons.selfBadge}` : ""}</Body>
              {i > 0 ? (
                <Button label={tr.common.delete} variant="ghost" onPress={() => setPersons(persons.filter((_, j) => j !== i))} />
              ) : null}
            </Spread>
          ))}
          <Row>
            <View style={{ flex: 1 }}>
              <Field value={newPerson} onChangeText={setNewPerson} placeholder={useRotatingPlaceholder(placeholderPools.person)} />
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
            <Spread key={`${src.name}-${i}`} style={{ marginBottom: spacing.sm }}>
              <Body>
                {src.name} · {SOURCE_TYPES.find((t) => t.value === src.type)?.label} · {persons[src.personIndex]}
              </Body>
              <Button label={tr.common.delete} variant="ghost" onPress={() => setSources(sources.filter((_, j) => j !== i))} />
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
          <Heading>5 · {tr.onboarding.historyPrompt}</Heading>
          <View style={{ gap: spacing.sm }}>
            <Button label={tr.onboarding.historyYes} onPress={() => void finish(true)} loading={busy} />
            <Button label={tr.onboarding.historyLater} variant="secondary" onPress={() => void finish(false)} disabled={busy} />
          </View>
        </Card>
      </View>
    </Screen>
  );
}
