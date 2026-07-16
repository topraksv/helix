/**
 * Computed columns: bounded, whitelisted calculation set (spec §3.2 — no
 * free-form formula engine). Redesigned as picture-book setup: pick a
 * calculation type card, choose categories, watch a live preview for the
 * current month, then save.
 */

import React, { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Calculator, CreditCard, GripVertical, Minus, Pencil, Plus, Scale, Trash2, type LucideIcon } from "lucide-react-native";
import { newId } from "../../../db/ids";
import { restoreRow, softDelete, writeRows, writeSetting } from "../../../db/mutations";
import { settingValue, toTxLike, useAllTransactions, useCategories, useComputedColumns, useLedger, usePersons, useSettingsMap, useSources, useUserId } from "../../../data/hooks";
import { creditCardSplit } from "../../../domain/analytics";
import { evaluateComputedColumn, parseDefinition, type ComputedColumnDefinition } from "../../../domain/computed-columns";
import { monthKeyOf, todayISO, yearOf } from "../../../domain/dates";
import { formatMinor } from "../../../domain/money";
import { scheduleSync } from "../../../sync/engine";
import { monthLabel, tr } from "../../../i18n/tr";
import { Body, Button, Card, ChipPicker, Divider, Field, IconButton, Label, Row, Screen, Spread, Toggle } from "../../../ui/components";
import { DraggableList } from "../../../ui/draggable-list";
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

export default function ComputedColumnsScreen({ header }: { header?: ReactNode } = {}) {
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
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  let definition: ComputedColumnDefinition | null = null;
  try {
    if (op === "sum") definition = parseDefinition({ op, categoryIds: plus });
    else if (op === "difference") definition = parseDefinition({ op, plusCategoryIds: plus, minusCategoryIds: minus });
    else if (op === "income_minus_expense") definition = parseDefinition({ op });
    else definition = parseDefinition({ op: "cc_split", part: ccPart });
  } catch {
    definition = null;
  }

  // Live preview against the current month, so setup is never a guess.
  let preview: number | null = null;
  if (definition && bundle) {
    const month = bundle.yearMonths.find((item) => item.month === monthKeyOf(today));
    try {
      if (month) {
        const creditCardIds = new Set(sources.filter((source) => source.type === "credit_card").map((source) => source.id));
        const cc = creditCardSplit(toTxLike(allTx, persons, categories), creditCardIds, month.month, today);
        preview = evaluateComputedColumn(definition, {
          month: month.month,
          byCategory: month.byCategory,
          incomeMinor: month.incomeMinor,
          expenseMinor: month.expenseMinor,
          ccSingleMinor: cc.singleMinor,
          ccInstallmentMinor: cc.installmentMinor,
        });
      }
    } catch {
      preview = null;
    }
  }

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
    if (busy || !valid) return;
    setBusy(true);
    try {
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
    } finally {
      setBusy(false);
    }
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
    if (snapshot) undo.show(`${c.name} · ${tr.common.deleted}`, () => void restoreRow(userId, "computed_columns", snapshot), "warning");
  };

  const toggleVisible = async (id: string, show: boolean) => {
    const next = show ? hidden.filter((x) => x !== id) : [...new Set([...hidden, id])];
    await writeSetting(userId, HIDDEN_KEY, next);
    scheduleSync(userId);
  };

  const applyOrder = async (orderedIds: string[]) => {
    const byId = new Map(columns.map((column) => [column.id, column]));
    const slots = columns.map((column) => column.sortOrder);
    const writes = orderedIds.flatMap((id, index) => {
      const column = byId.get(id);
      return column ? [{ table: "computed_columns" as const, row: { ...column, sortOrder: slots[index] } }] : [];
    });
    if (writes.length === 0) return;
    await writeRows(userId, writes);
    scheduleSync(userId);
  };

  const categoryChips = categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <Screen scrollEnabled={!dragging}>
      {header}
      <Body muted style={{ marginBottom: spacing.md }}>{tr.computed.intro}</Body>
      {editingId ? (
        <View style={{ backgroundColor: palette.primarySoft, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.md }}>
          <Body style={{ color: palette.primary, fontSize: 13 }}>{tr.computed.editing(name || tr.computed.nameLabel)}</Body>
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
              <Button label={tr.computed.saveEdit} onPress={() => void save()} disabled={!valid || busy} loading={busy} />
            </View>
            <Button variant="ghost" label={tr.computed.cancelEdit} onPress={resetForm} />
          </Row>
        ) : (
          <Button icon={Plus} label={tr.computed.addAction} onPress={() => void save()} disabled={!valid || busy} loading={busy} />
        )}
      </Card>

      {/* Existing columns */}
      {columns.length > 0 ? (
        <Card>
          <Label>{tr.computed.existingTitle}</Label>
          <Body muted style={{ fontSize: 12, marginBottom: spacing.xs }}>{tr.settings.reorderHint}</Body>
          <DraggableList
            items={columns}
            keyExtractor={(column) => column.id}
            onReorder={(ids) => void applyOrder(ids)}
            onDragStateChange={setDragging}
            disabled={editingId != null}
            renderRow={(column, handle, index) => {
              const visible = !hidden.includes(column.id);
              return (
                <View>
                  <View style={{ paddingVertical: spacing.sm, backgroundColor: handle.active ? palette.surfaceAlt : palette.surface }}>
                    <Spread>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1, paddingRight: spacing.sm }}>
                        <View
                          {...handle.panHandlers}
                          accessibilityRole="adjustable"
                          accessibilityLabel={tr.settings.reorderHandle}
                          accessibilityActions={[
                            { name: "increment", label: tr.settings.moveUp },
                            { name: "decrement", label: tr.settings.moveDown },
                          ]}
                          onAccessibilityAction={(e) => {
                            if (e.nativeEvent.actionName === "increment") handle.moveUp();
                            else if (e.nativeEvent.actionName === "decrement") handle.moveDown();
                          }}
                          style={{ padding: 4, marginLeft: -4 }}
                        >
                          <GripVertical size={18} color={palette.textMuted} />
                        </View>
                        <Calculator size={16} color={palette.textMuted} />
                        <Body style={{ flex: 1 }}>{column.name}</Body>
                      </View>
                      <Row gap={spacing.sm}>
                        <IconButton icon={Pencil} size={32} label={tr.common.edit} onPress={() => startEdit(column)} />
                        <IconButton icon={Trash2} size={32} tone="danger" label={tr.common.delete} haptic="none" onPress={() => void remove(column)} />
                      </Row>
                    </Spread>
                    <Spread style={{ marginTop: spacing.xs }}>
                      <Body muted style={{ fontSize: 12, flex: 1, paddingRight: spacing.sm }}>{tr.computed.showInTable}</Body>
                      <Toggle label={`${column.name} · ${tr.computed.showInTable}`} value={visible} onValueChange={(value) => void toggleVisible(column.id, value)} />
                    </Spread>
                  </View>
                  {index < columns.length - 1 ? <Divider /> : null}
                </View>
              );
            }}
          />
        </Card>
      ) : null}
    </Screen>
  );
}
