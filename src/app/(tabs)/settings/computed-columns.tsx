/**
 * Computed columns: bounded, whitelisted calculation set (spec §3.2 — no
 * free-form formula engine). Redesigned as picture-book setup: pick a
 * calculation type card, choose categories, watch a live preview for the
 * current month, then save.
 */

import React, { useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Calculator from "lucide-react-native/icons/calculator";
import Columns3 from "lucide-react-native/icons/columns-3";
import CreditCard from "lucide-react-native/icons/credit-card";
import Minus from "lucide-react-native/icons/minus";
import Pencil from "lucide-react-native/icons/pencil";
import Plus from "lucide-react-native/icons/plus";
import Scale from "lucide-react-native/icons/scale";
import Trash2 from "lucide-react-native/icons/trash-2";
import type { LucideIcon } from "lucide-react-native";
import {
  settingValue,
  useAllTransactionsState,
  useCategoriesState,
  useComputedColumnsState,
  useLedgerState,
  usePersonsState,
  useSettingsMapState,
  useTxLike,
  useSourcesState,
  useUserId,
} from "../../../data/hooks";
import { combineLiveStates } from "../../../data/live-state";
import { deleteComputedColumn, reorderComputedColumns, restoreComputedColumn, saveComputedColumn, setComputedColumnsHidden } from "../../../data/repo";
import { creditCardSplit } from "../../../domain/analytics";
import { monthColumnBasis } from "../../../domain/balance";
import { evaluateComputedColumn, parseDefinition, type ComputedColumnDefinition } from "../../../domain/computed-columns";
import { monthKeyOf, todayISO, yearOf } from "../../../domain/dates";
import { formatMinorCompact } from "../../../domain/money";
import { scheduleSync } from "../../../sync/engine";
import { tr } from "../../../i18n/tr";
import { categoryIconComponent } from "../../../ui/category-icon";
import { Amount, Body, Button, Card, ChipPicker, DataStateNotice, Divider, EmptyState, FadeIn, Field, IconButton, Label, PanelHeader, Row, Screen, SelectionGrid, Spread, Toggle } from "../../../ui/components";
import { DraggableList, ReorderGrip } from "../../../ui/draggable-list";
import { useUndo } from "../../../ui/undo";
import { interactionSurface } from "../../../ui/interaction";
import { font, radius, spacing, type, useTheme } from "../../../ui/theme";
import { useOperationGuard } from "../../../ui/operation-guard";
import { useDirtyExitGuard } from "../../../ui/dirty-exit";
import { WorkspaceSplit } from "../../../ui/workspace-layout";
import { selectionTapIfChanged } from "../../../ui/haptics";
import { appAlert } from "../../../ui/dialog";

const HIDDEN_KEY = "computed_columns_hidden";

type Op = ComputedColumnDefinition["op"];

const OP_META: { op: Op; icon: LucideIcon }[] = [
  { op: "sum", icon: Plus },
  { op: "difference", icon: Minus },
  { op: "income_minus_expense", icon: Scale },
  { op: "cc_split", icon: CreditCard },
];

function CalculationFlow({
  op,
  inputCount,
  preview,
}: {
  op: Op;
  inputCount: number;
  preview: number | null;
}) {
  const { palette } = useTheme();
  const Icon = OP_META.find((item) => item.op === op)?.icon ?? Calculator;
  const result = preview ?? 0;
  const node = {
    height: 52,
    borderRadius: radius.xl,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };
  return (
    <View
      testID="calculation-flow"
      accessible
      accessibilityRole="image"
      accessibilityLabel={tr.computed.flowA11y(inputCount, tr.computed.ops[op].title, formatMinorCompact(result))}
      style={{ marginBottom: spacing.lg }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <FadeIn key={`inputs-${inputCount}`} style={[node, { width: 52, backgroundColor: palette.surfaceAlt }]}>
          <Text style={[type.heading, { color: palette.textStrong, fontFamily: font.bold }]}>{inputCount}</Text>
        </FadeIn>
        <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginHorizontal: spacing.sm }} />
        <FadeIn key={op} delay={60} style={[node, { width: 52, backgroundColor: palette.primarySoft }]}>
          <Icon accessible={false} size={21} color={palette.primary} />
        </FadeIn>
        <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginHorizontal: spacing.sm }} />
        <FadeIn key={`result-${result}`} delay={120} style={[node, { width: 112, backgroundColor: palette.surfaceAlt, paddingHorizontal: spacing.xs }]}>
          <Amount minor={result} colorized={false} style={{ fontSize: type.label.fontSize }} />
        </FadeIn>
      </View>
      <View style={{ flexDirection: "row", marginTop: spacing.xs }}>
        <Body muted style={{ width: 52, fontSize: type.caption.fontSize, textAlign: "center" }}>{tr.computed.flowInput}</Body>
        <Body muted style={{ flex: 1, fontSize: type.caption.fontSize, textAlign: "center" }}>{tr.computed.flowOperation}</Body>
        <Body muted style={{ width: 112, fontSize: type.caption.fontSize, textAlign: "center" }}>{tr.computed.flowResult}</Body>
      </View>
    </View>
  );
}


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
  const txLike = useTxLike();
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

  const definition = useMemo<ComputedColumnDefinition | null>(() => {
    try {
      if (op === "sum") return parseDefinition({ op, categoryIds: plus });
      if (op === "difference") return parseDefinition({ op, plusCategoryIds: plus, minusCategoryIds: minus });
      if (op === "income_minus_expense") return parseDefinition({ op });
      return parseDefinition({ op: "cc_split", part: ccPart });
    } catch {
      return null;
    }
  }, [op, plus, minus, ccPart]);
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
  const { confirmDiscard } = useDirtyExitGuard(computedDraftDirty && !busy);
  const { status: dataStatus, ready: dataReady, retry: retryData } = combineLiveStates([columnsState, categoriesState, ledgerState, sourcesState, transactionsState, personsState, settingsState]);

  // Live preview against the current month, so setup is never a guess. The
  // split scans the whole ledger, so it follows the definition and the data —
  // not every keystroke in the name field beside it.
  const preview = useMemo<number | null>(() => {
    const month = bundle?.yearMonths.find((item) => item.month === monthKeyOf(today));
    if (!definition || !month) return null;
    try {
      const creditCardIds = new Set(sources.filter((source) => source.type === "credit_card").map((source) => source.id));
      const cc = creditCardSplit(txLike, creditCardIds, month.month, today);
      return evaluateComputedColumn(definition, {
        month: month.month,
        ...monthColumnBasis(month),
        ccSingleMinor: cc.singleMinor,
        ccInstallmentMinor: cc.installmentMinor,
      });
    } catch {
      return null;
    }
  }, [definition, bundle, sources, txLike, today]);

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
    confirmDiscard(() => {
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
    });
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

  const categoryChips = categories.map((c) => ({ value: c.id, label: c.name, icon: categoryIconComponent(c) }));

  if (!dataReady) {
    return (
      <Screen>
        {header}
        <DataStateNotice status={dataStatus} retry={retryData} />
      </Screen>
    );
  }

  return (
    <Screen scrollEnabled={!dragging} width="workspace">
      {header}
      <DataStateNotice status={dataStatus} retry={retryData} />
      <WorkspaceSplit
        testID="computed-columns-workspace"
        wideLayout={columns.length === 0 ? "stack" : "split"}
        primary={(
          <View>
      {editingId ? (
        <View style={{ backgroundColor: palette.primarySoft, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.md }}>
          <Body style={{ color: palette.primaryText, fontSize: type.label.fontSize }}>{tr.computed.editing(name || tr.computed.nameLabel)}</Body>
        </View>
      ) : null}

      <Card>
      <PanelHeader icon={Calculator} title={tr.computed.builderTitle} description={tr.computed.builderHint} />
      <CalculationFlow
        op={op}
        inputCount={
          op === "difference"
            ? plus.length + minus.length
            : op === "sum"
              ? plus.length
              : op === "income_minus_expense"
                ? categories.length
                : 1
        }
        preview={preview}
      />

      {/* 1) Calculation type */}
      <Label>{tr.computed.stepType}</Label>
      <View
        role="radiogroup"
        accessibilityLabel={tr.computed.stepType}
        style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}
      >
      {OP_META.map(({ op: value, icon: IconCmp }) => {
        const selected = op === value;
        return (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityLabel={`${tr.computed.ops[value].title}. ${tr.computed.ops[value].description}`}
            aria-checked={selected}
            accessibilityState={{ checked: selected, selected }}
            onPress={() => {
              selectionTapIfChanged(op, value);
              setOp(value);
            }}
            style={(state) => ({
              flexBasis: "47%",
              flexGrow: 1,
              minWidth: 0,
              minHeight: 64,
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              borderRadius: radius.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: palette.border,
              ...interactionSurface(palette, state, { base: selected ? palette.primarySoft : palette.surface }),
            })}
          >
            <IconCmp accessible={false} size={20} color={selected ? palette.primary : palette.textSecondary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.body, { color: palette.text, fontFamily: font.semibold }]}>
                {tr.computed.ops[value].title}
              </Text>
            </View>
          </Pressable>
        );
      })}
      </View>
      <Body muted style={{ fontSize: type.small.fontSize, marginTop: spacing.xs, marginBottom: spacing.md }}>
        {tr.computed.ops[op].description}
      </Body>

      {/* 2) Inputs for the chosen type */}
        {op === "sum" || op === "difference" ? (
          <>
            <Label>{op === "difference" ? tr.computed.plusGroup : tr.computed.pickCategories}</Label>
            <SelectionGrid
              options={categoryChips}
              values={plus}
              onToggle={(id) => toggle(plus, setPlus, id)}
              searchable
              tone="plus"
              countLabel={tr.computed.selectedCount(plus.length)}
              emptyMessage={tr.computed.noCategories}
            />
          </>
        ) : null}
        {op === "difference" ? (
          <>
            <Label>{tr.computed.minusGroup}</Label>
            <SelectionGrid
              options={categoryChips}
              values={minus}
              onToggle={(id) => toggle(minus, setMinus, id)}
              searchable
              tone="minus"
              countLabel={tr.computed.selectedCount(minus.length)}
              emptyMessage={tr.computed.noCategories}
            />
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
          </View>
        )}
        secondary={(
          columns.length > 0 ? (
            <Card>
              <PanelHeader icon={Columns3} title={tr.computed.existingTitle} description={tr.settings.reorderHint} />
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
                            <IconButton icon={Pencil} label={`${tr.common.edit} · ${column.name}`} onPress={() => startEdit(column)} />
                            <IconButton icon={Trash2} tone="danger" label={`${tr.common.delete} · ${column.name}`} haptic="none" onPress={() => void remove(column)} />
                          </Row>
                        </Spread>
                        <Spread style={{ marginTop: spacing.xs }}>
                          <Body muted style={{ fontSize: type.small.fontSize, flex: 1, paddingRight: spacing.sm }}>{tr.computed.showInTable}</Body>
                          <Toggle label={`${column.name} · ${tr.computed.showInTable}`} value={visible} onValueChange={(value) => void toggleVisible(column.id, value)} />
                        </Spread>
                      </View>
                      {index < columns.length - 1 ? <Divider /> : null}
                    </View>
                  );
                }}
              />
            </Card>
          ) : (
            <EmptyState icon={Calculator} title={tr.computed.emptyTitle} hint={tr.computed.emptyHint} />
          )
        )}
      />

    </Screen>
  );
}
