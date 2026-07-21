/**
 * Computed columns: bounded, whitelisted calculation set (spec §3.2 — no
 * free-form formula engine). Redesigned as picture-book setup: pick a
 * calculation type card, choose categories, watch a live preview for the
 * current month, then save.
 */

import React, { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Calculator, CreditCard, Minus, Pencil, Plus, Scale, Trash2, type LucideIcon } from "lucide-react-native";
import {
  settingValue,
  toTxLike,
  useAllTransactionsState,
  useCategoriesState,
  useComputedColumnsState,
  useLedgerState,
  usePersonsState,
  useSettingsMapState,
  useSourcesState,
  useUserId,
} from "../../../data/hooks";
import { combineLiveQueryStatus } from "../../../data/live-state";
import { deleteComputedColumn, reorderComputedColumns, restoreComputedColumn, saveComputedColumn, setComputedColumnsHidden } from "../../../data/repo";
import { creditCardSplit } from "../../../domain/analytics";
import { evaluateComputedColumn, parseDefinition, type ComputedColumnDefinition } from "../../../domain/computed-columns";
import { monthKeyOf, todayISO, yearOf } from "../../../domain/dates";
import { formatMinor } from "../../../domain/money";
import { scheduleSync } from "../../../sync/engine";
import { monthLabel, tr } from "../../../i18n/tr";
import { Body, Button, Card, ChipPicker, DataStateNotice, Divider, Field, IconButton, Label, Row, Screen, Spread, Toggle } from "../../../ui/components";
import { DraggableList, ReorderGrip } from "../../../ui/draggable-list";
import { useUndo } from "../../../ui/undo";
import { radius, spacing, type, useTheme } from "../../../ui/theme";
import { useOperationGuard } from "../../../ui/operation-guard";
import { useDirtyExitGuard } from "../../../ui/dirty-exit";
import { appAlert } from "../../../ui/dialog";

const HIDDEN_KEY = "computed_columns_hidden";

type Op = ComputedColumnDefinition["op"];

const OP_META: { op: Op; icon: LucideIcon }[] = [
  { op: "sum", icon: Plus },
  { op: "difference", icon: Minus },
  { op: "income_minus_expense", icon: Scale },
  { op: "cc_split", icon: CreditCard },
];

export default function ComputedColumnsScreen({ header }: { header?: ReactNode } = {}) {
  /**
   * An undo that fails must say so — the snackbar dismisses on tap either way,
   * so a swallowed rejection left the row deleted with no message.
   */
  const userId = useUserId();
  const columnsState = useComputedColumnsState();
  const categoriesState = useCategoriesState();
  const columns = columnsState.data;
  const categories = categoriesState.data;
  const undo = useUndo();
  const operationGuard = useOperationGuard();
  const { palette } = useTheme();
  const today = todayISO();
  const ledgerState = useLedgerState(yearOf(today));
  const sourcesState = useSourcesState();
  const transactionsState = useAllTransactionsState();
  const personsState = usePersonsState();
  const settingsState = useSettingsMapState();
  const bundle = ledgerState.data;
  const sources = sourcesState.data;
  const allTx = transactionsState.data;
  const persons = personsState.data;
  const settings = settingsState.data;
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
  const editingColumn = editingId ? columns.find((column) => column.id === editingId) : null;
  let storedDefinition: ComputedColumnDefinition | null = null;
  if (editingColumn) {
    try {
      storedDefinition = parseDefinition(JSON.parse(editingColumn.definition));
    } catch {
      storedDefinition = null;
    }
  }
  const computedDraftDirty = editingColumn
    ? name.trim() !== editingColumn.name || JSON.stringify(definition) !== JSON.stringify(storedDefinition)
    : Boolean(name.trim() || plus.length || minus.length || op !== "sum" || ccPart !== "single");
  useDirtyExitGuard(computedDraftDirty && !busy);
  const liveStates = [columnsState, categoriesState, ledgerState, sourcesState, transactionsState, personsState, settingsState];
  const dataStatus = combineLiveQueryStatus(liveStates);
  const dataReady = liveStates.every((state) => state.updatedAt != null);
  const retryData = () => {
    columnsState.retry();
    categoriesState.retry();
    ledgerState.retry();
    sourcesState.retry();
    transactionsState.retry();
    personsState.retry();
    settingsState.retry();
  };

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
    if (!valid) return;
    await operationGuard.run(async () => {
      setBusy(true);
      try {
        const existing = editingId ? columns.find((c) => c.id === editingId) : null;
        await saveComputedColumn(userId, {
          id: editingId ?? undefined,
          name,
          definition: definition!,
          sortOrder: existing?.sortOrder ?? columns.length,
        });
        scheduleSync(userId);
        resetForm();
      } catch {
        void appAlert(tr.errors.saveFailed, tr.errors.title);
      } finally {
        setBusy(false);
      }
    });
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
    try {
      const snapshot = await deleteComputedColumn(userId, c.id);
      scheduleSync(userId);
      if (editingId === c.id) resetForm();
      if (snapshot) undo.show(`${c.name} · ${tr.common.deleted}`, () => restoreComputedColumn(userId, snapshot), "warning");
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
  };

  const toggleVisible = async (id: string, show: boolean) => {
    const next = show ? hidden.filter((x) => x !== id) : [...new Set([...hidden, id])];
    try {
      await setComputedColumnsHidden(userId, next);
      scheduleSync(userId);
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
  };

  const applyOrder = async (orderedIds: string[]) => {
    try {
      await reorderComputedColumns(userId, columns, orderedIds);
      scheduleSync(userId);
    } catch {
      void appAlert(tr.errors.saveFailed, tr.errors.title);
    }
  };

  const categoryChips = categories.map((c) => ({ value: c.id, label: c.name }));

  if (!dataReady) {
    return (
      <Screen>
        {header}
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  return (
    <Screen scrollEnabled={!dragging}>
      {header}
      <DataStateNotice status={dataStatus} retry={retryData} />
      <Body muted style={{ marginBottom: spacing.md }}>{tr.computed.intro}</Body>
      {editingId ? (
        <View style={{ backgroundColor: palette.primarySoft, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.md }}>
          <Body style={{ color: palette.primaryText, fontSize: 13 }}>{tr.computed.editing(name || tr.computed.nameLabel)}</Body>
        </View>
      ) : null}

      {/* 1) Calculation type */}
      <Label>{tr.computed.stepType}</Label>
      {OP_META.map(({ op: value, icon: IconCmp }) => {
        const selected = op === value;
        return (
          <Pressable
            key={value}
            accessibilityRole="radio"
            aria-checked={selected}
            accessibilityState={{ checked: selected, selected }}
            onPress={() => setOp(value)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              padding: spacing.md,
              borderRadius: radius.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: palette.border,
              backgroundColor: selected ? palette.primarySoft : palette.surface,
              marginBottom: spacing.sm,
            }}
          >
            <IconCmp size={20} color={selected ? palette.primary : palette.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { color: palette.text, fontFamily: "Inter_600SemiBold" }]}>
                {tr.computed.ops[value].title}
              </Text>
              <Text style={[type.small, { color: palette.textSecondary, marginTop: 1 }]}>{tr.computed.ops[value].description}</Text>
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
            <Text style={[type.small, { color: palette.textSecondary }]}>
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
            onReorder={applyOrder}
            onDragStateChange={setDragging}
            disabled={editingId != null}
            renderRow={(column, handle, index) => {
              const visible = !hidden.includes(column.id);
              return (
                <View>
                  <View style={{ paddingVertical: spacing.sm, backgroundColor: handle.active ? palette.surfaceAlt : palette.surface }}>
                    <Spread>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1, paddingRight: spacing.sm }}>
                        <ReorderGrip handle={handle} position={index + 1} count={columns.length} />
                        <Calculator size={16} color={palette.textSecondary} />
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
