/** Computed columns: bounded, whitelisted calculation set (spec §3.2 — no
 *  free-form formula engine). Definitions are Zod-validated JSON. */

import React, { useState } from "react";
import { View } from "react-native";
import { newId } from "../../../db/ids";
import { restoreRow, softDelete, writeRows } from "../../../db/mutations";
import { useCategories, useComputedColumns, useUserId } from "../../../data/hooks";
import { parseDefinition, type ComputedColumnDefinition } from "../../../domain/computed-columns";
import { scheduleSync } from "../../../sync/engine";
import { tr } from "../../../i18n/tr";
import { Body, Button, Card, Divider, Field, Label, Row, Screen, Segmented, Spread } from "../../../ui/components";
import { ChipPicker } from "../../../ui/components";
import { useUndo } from "../../../ui/undo";
import { spacing } from "../../../ui/theme";

type Op = ComputedColumnDefinition["op"];

export default function ComputedColumnsScreen() {
  const userId = useUserId();
  const columns = useComputedColumns();
  const categories = useCategories();
  const undo = useUndo();
  const [name, setName] = useState("");
  const [op, setOp] = useState<Op>("sum");
  const [plus, setPlus] = useState<string[]>([]);
  const [minus, setMinus] = useState<string[]>([]);
  const [ccPart, setCcPart] = useState<"single" | "installment">("single");

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const buildDefinition = (): ComputedColumnDefinition | null => {
    try {
      if (op === "sum") return parseDefinition({ op, categoryIds: plus });
      if (op === "difference") return parseDefinition({ op, plusCategoryIds: plus, minusCategoryIds: minus });
      if (op === "income_minus_expense") return parseDefinition({ op });
      return parseDefinition({ op: "cc_split", part: ccPart });
    } catch {
      return null;
    }
  };

  const definition = buildDefinition();
  const valid = name.trim() !== "" && definition !== null;

  const add = async () => {
    if (!valid) return;
    await writeRows(userId, [
      {
        table: "computed_columns",
        row: { id: newId(), name: name.trim(), definition: JSON.stringify(definition), sortOrder: columns.length, deletedAt: null },
      },
    ]);
    scheduleSync(userId);
    setName("");
    setPlus([]);
    setMinus([]);
  };

  const remove = async (c: (typeof columns)[number]) => {
    const snapshot = await softDelete(userId, "computed_columns", c.id);
    scheduleSync(userId);
    if (snapshot) undo.show(`${c.name} — ${tr.common.deleted}`, () => void restoreRow(userId, "computed_columns", snapshot));
  };

  const categoryChips = categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <Screen>
      <Card>
        <Field label={tr.settings.newComputed} value={name} onChangeText={setName} placeholder="Ör. Sabit Giderler Toplamı" />
        <Segmented
          options={[
            { value: "sum", label: "Σ" },
            { value: "difference", label: "A−B" },
            { value: "income_minus_expense", label: "G−G" },
            { value: "cc_split", label: "KK" },
          ]}
          value={op}
          onChange={setOp}
        />
        <Body muted style={{ marginBottom: spacing.md }}>
          {op === "sum"
            ? tr.settings.opSum
            : op === "difference"
              ? tr.settings.opDifference
              : op === "income_minus_expense"
                ? tr.settings.opIncomeMinusExpense
                : tr.settings.opCcSplit}
        </Body>
        {op === "sum" || op === "difference" ? (
          <>
            <Label>{op === "difference" ? "A (+)" : "Kategoriler"}</Label>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md }}>
              {categoryChips.map((c) => (
                <Button
                  key={c.value}
                  label={`${plus.includes(c.value) ? "✓ " : ""}${c.label}`}
                  variant={plus.includes(c.value) ? "primary" : "secondary"}
                  onPress={() => toggle(plus, setPlus, c.value)}
                />
              ))}
            </View>
          </>
        ) : null}
        {op === "difference" ? (
          <>
            <Label>B (−)</Label>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md }}>
              {categoryChips.map((c) => (
                <Button
                  key={c.value}
                  label={`${minus.includes(c.value) ? "✓ " : ""}${c.label}`}
                  variant={minus.includes(c.value) ? "primary" : "secondary"}
                  onPress={() => toggle(minus, setMinus, c.value)}
                />
              ))}
            </View>
          </>
        ) : null}
        {op === "cc_split" ? (
          <ChipPicker
            options={[
              { value: "single", label: "Tek çekim" },
              { value: "installment", label: "Taksitli" },
            ]}
            value={ccPart}
            onChange={setCcPart}
          />
        ) : null}
        <Button label={tr.common.add} onPress={() => void add()} disabled={!valid} />
      </Card>

      <Card>
        {columns.map((c) => (
          <View key={c.id}>
            <Spread style={{ paddingVertical: spacing.sm }}>
              <Body>{c.name}</Body>
              <Row gap={spacing.sm}>
                <Button label={tr.common.delete} variant="ghost" onPress={() => void remove(c)} />
              </Row>
            </Spread>
            <Divider />
          </View>
        ))}
      </Card>
    </Screen>
  );
}
