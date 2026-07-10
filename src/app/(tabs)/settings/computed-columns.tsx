/**
 * Computed columns: bounded, whitelisted calculation set (spec §3.2 — no
 * free-form formula engine). Redesigned as picture-book setup: pick a
 * calculation type card, choose categories, watch a live preview for the
 * current month, then save.
 */

import React, { useMemo, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { Calculator, CreditCard, Minus, Pencil, Plus, Scale, Trash2, type LucideIcon } from "lucide-react-native";
import { newId } from "../../../db/ids";
import { restoreRow, softDelete, writeRows, writeSetting } from "../../../db/mutations";
import { settingValue, toTxLike, useAllTransactions, useCategories, useComputedColumns, useLedger, usePersons, useSettingsMap, useSources, useUserId } from "../../../data/hooks";
import { creditCardSplit } from "../../../domain/analytics";
import { evaluateComputedColumn, parseDefinition, type ComputedColumnDefinition } from "../../../domain/computed-columns";
import { monthKeyOf, todayISO, yearOf } from "../../../domain/dates";
import { formatMinor } from "../../../domain/money";
import { scheduleSync } from "../../../sync/engine";
import { monthLabel, tr } from "../../../i18n/tr";
import { Body, Button, Card, CardList, ChipPicker, Field, IconButton, Label, Row, Screen, Spread } from "../../../ui/components";
import { useUndo } from "../../../ui/undo";
import { radius, spacing, type, useTheme } from "../../../ui/theme";

const HIDDEN_KEY = "computed_columns_hidden";

type Op = ComputedColumnDefinition["op"];

const OP_META: { op: Op; icon: LucideIcon }[] = [
  { op: "sum", icon: Plus },
  { op: "difference", icon: Minus },
  { op: "income_minus_expense", icon: Scale },
  { op: "cc_split", icon: CreditCard },
];

export default function ComputedColumnsScreen() {
  const userId = useUserId();
  const columns = useComputedColumns();
  const categories = useCategories();
  const undo = useUndo();
  const { palette } = useTheme();
  const today = todayISO();
  const bundle = useLedger(yearOf(today));
  const sources = useSources();
  const allTx = useAllTransactions();
  const persons = usePersons();
  const settings = useSettingsMap();
  const hidden = settingValue<string[]>(settings, HIDDEN_KEY, []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [op, setOp] = useState<Op>("sum");
  const [plus, setPlus] = useState<string[]>([]);
  const [minus, setMinus] = useState<string[]>([]);
  const [ccPart, setCcPart] = useState<"single" | "installment">("single");

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const definition = useMemo((): ComputedColumnDefinition | null => {
    try {
      if (op === "sum") return parseDefinition({ op, categoryIds: plus });
      if (op === "difference") return parseDefinition({ op, plusCategoryIds: plus, minusCategoryIds: minus });
      if (op === "income_minus_expense") return parseDefinition({ op });
      return parseDefinition({ op: "cc_split", part: ccPart });
    } catch {
      return null;
    }
  }, [op, plus, minus, ccPart]);

  // Live preview against the current month, so setup is never a guess.
  const preview = useMemo(() => {
    if (!definition || !bundle) return null;
    const month = bundle.yearMonths.find((m) => m.month === monthKeyOf(today));
    if (!month) return null;
    const creditCardIds = new Set(sources.filter((src) => src.type === "credit_card").map((src) => src.id));
    const cc = creditCardSplit(toTxLike(allTx, persons), creditCardIds, month.month, today);
    try {
      return evaluateComputedColumn(definition, {
        month: month.month,
        byCategory: month.byCategory,
        incomeMinor: month.incomeMinor,
        expenseMinor: month.expenseMinor,
        ccSingleMinor: cc.singleMinor,
        ccInstallmentMinor: cc.installmentMinor,
      });
    } catch {
      return null;
    }
  }, [definition, bundle, today, sources, allTx, persons]);

  const valid = name.trim() !== "" && definition !== null;

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setOp("sum");
    setPlus([]);
    setMinus([]);
    setCcPart("single");
  };

  const save = async () => {
    if (!valid) return;
    const existing = editingId ? columns.find((c) => c.id === editingId) : null;
    await writeRows(userId, [
      {
        table: "computed_columns",
        row: {
          id: editingId ?? newId(),
          name: name.trim(),
          definition: JSON.stringify(definition),
          sortOrder: existing?.sortOrder ?? columns.length,
          deletedAt: null,
        },
      },
    ]);
    scheduleSync(userId);
    resetForm();
  };

  // Load an existing column back into the form for editing.
  const startEdit = (c: (typeof columns)[number]) => {
    setEditingId(c.id);
    setName(c.name);
    try {
      const def = parseDefinition(JSON.parse(c.definition));
      setOp(def.op);
      setPlus(def.op === "sum" ? def.categoryIds : def.op === "difference" ? def.plusCategoryIds : []);
      setMinus(def.op === "difference" ? def.minusCategoryIds : []);
      setCcPart(def.op === "cc_split" ? def.part : "single");
    } catch {
      /* keep whatever is in the form */
    }
  };

  const remove = async (c: (typeof columns)[number]) => {
    if (editingId === c.id) resetForm();
    const snapshot = await softDelete(userId, "computed_columns", c.id);
    scheduleSync(userId);
    if (snapshot) undo.show(`${c.name} — ${tr.common.deleted}`, () => void restoreRow(userId, "computed_columns", snapshot));
  };

  const toggleVisible = async (id: string, show: boolean) => {
    const next = show ? hidden.filter((x) => x !== id) : [...new Set([...hidden, id])];
    await writeSetting(userId, HIDDEN_KEY, next);
    scheduleSync(userId);
  };

  const categoryChips = categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <Screen>
      <Body muted style={{ marginBottom: spacing.md }}>{tr.computed.intro}</Body>
      {editingId ? (
        <View style={{ backgroundColor: palette.primarySoft, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.md }}>
          <Body style={{ color: palette.primary, fontSize: 13 }}>{tr.computed.editing(name || "…")}</Body>
        </View>
      ) : null}

      {/* 1) Calculation type */}
      <Label>{tr.computed.stepType}</Label>
      {OP_META.map(({ op: value, icon: IconCmp }) => {
        const selected = op === value;
        return (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => setOp(value)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              padding: spacing.md,
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: selected ? palette.primary : palette.border,
              backgroundColor: selected ? palette.primarySoft : palette.surface,
              marginBottom: spacing.sm,
            }}
          >
            <IconCmp size={20} color={selected ? palette.primary : palette.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { color: palette.text, fontFamily: "Inter_600SemiBold" }]}>
                {tr.computed.ops[value].title}
              </Text>
              <Text style={[type.small, { color: palette.textMuted, marginTop: 1 }]}>{tr.computed.ops[value].description}</Text>
            </View>
          </Pressable>
        );
      })}

      {/* 2) Inputs for the chosen type */}
      <Card style={{ marginTop: spacing.md }}>
        {op === "sum" || op === "difference" ? (
          <>
            <Label>{op === "difference" ? tr.computed.plusGroup : tr.computed.pickCategories}</Label>
            <ChipPicker
              multi
              options={categoryChips}
              values={plus}
              onToggle={(id) => toggle(plus, setPlus, id)}
            />
          </>
        ) : null}
        {op === "difference" ? (
          <>
            <Label>{tr.computed.minusGroup}</Label>
            <ChipPicker multi options={categoryChips} values={minus} onToggle={(id) => toggle(minus, setMinus, id)} />
          </>
        ) : null}
        {op === "cc_split" ? (
          <ChipPicker
            options={[
              { value: "single", label: tr.tx.singleCharge },
              { value: "installment", label: tr.computed.installmentPart },
            ]}
            value={ccPart}
            onChange={setCcPart}
          />
        ) : null}

        <Field label={tr.computed.nameLabel} value={name} onChangeText={setName} placeholder={tr.placeholders.computedColumnName} />

        {definition && preview != null ? (
          <View
            style={{
              backgroundColor: palette.surfaceAlt,
              borderRadius: radius.sm,
              padding: spacing.md,
              marginBottom: spacing.md,
            }}
          >
            <Text style={[type.small, { color: palette.textMuted }]}>
              {tr.computed.previewLabel(monthLabel(monthKeyOf(today)))}
            </Text>
            <Text style={[type.amount, { color: palette.text, fontSize: 18, marginTop: 2 }]}>{formatMinor(preview)}</Text>
          </View>
        ) : null}

        {editingId ? (
          <Row>
            <View style={{ flex: 1 }}>
              <Button label={tr.computed.saveEdit} onPress={() => void save()} disabled={!valid} />
            </View>
            <Button variant="ghost" label={tr.computed.cancelEdit} onPress={resetForm} />
          </Row>
        ) : (
          <Button icon={Plus} label={tr.computed.addAction} onPress={() => void save()} disabled={!valid} />
        )}
      </Card>

      {/* Existing columns */}
      <CardList
        items={columns}
        keyExtractor={(c) => c.id}
        header={columns.length > 0 ? <Label>{tr.computed.existingTitle}</Label> : undefined}
        renderItem={(c) => {
          const visible = !hidden.includes(c.id);
          return (
            <View style={{ paddingVertical: spacing.sm }}>
              <Spread>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1, paddingRight: spacing.sm }}>
                  <Calculator size={16} color={palette.textMuted} />
                  <Body numberOfLines={2} style={{ flex: 1 }}>{c.name}</Body>
                </View>
                <Row gap={spacing.sm}>
                  <IconButton icon={Pencil} size={32} label={tr.common.edit} onPress={() => startEdit(c)} />
                  <IconButton icon={Trash2} size={32} tone="danger" label={tr.common.delete} onPress={() => void remove(c)} />
                </Row>
              </Spread>
              <Spread style={{ marginTop: spacing.xs }}>
                <Body muted style={{ fontSize: 12 }}>{tr.computed.showInTable}</Body>
                <Switch value={visible} onValueChange={(v) => void toggleVisible(c.id, v)} />
              </Spread>
            </View>
          );
        }}
      />
    </Screen>
  );
}
