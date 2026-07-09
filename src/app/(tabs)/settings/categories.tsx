/** Category & column management — the personalization core: names, kinds,
 *  column visibility all belong to the user (nothing is hardcoded). */

import React, { useState } from "react";
import { Switch, View } from "react-native";
import { newId } from "../../../db/ids";
import { restoreRow, softDelete, writeRows, writeSetting } from "../../../db/mutations";
import { settingValue, useCategories, useSettingsMap, useUserId } from "../../../data/hooks";
import { categoryIcon, suggestCategoryIcon } from "../../../data/category-icons";
import { scheduleSync } from "../../../sync/engine";
import { tr } from "../../../i18n/tr";
import { CreditCard, Pencil, Trash2 } from "lucide-react-native";
import { Body, Button, Card, CardList, Field, Heading, IconButton, Label, Row, Screen, Segmented, Spread } from "../../../ui/components";
import { placeholderPools, useRotatingPlaceholder } from "../../../ui/placeholders";
import { useUndo } from "../../../ui/undo";
import { spacing, useTheme } from "../../../ui/theme";

export default function CategoriesScreen() {
  const userId = useUserId();
  const categories = useCategories();
  const settings = useSettingsMap();
  const { palette } = useTheme();
  const undo = useUndo();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // The derived credit-card installment column: rename or hide it like any other.
  const ccLabel = settingValue<string>(settings, "cc_col_label", tr.cashflow.ccInstallments);
  const ccHidden = settingValue<boolean>(settings, "cc_col_hidden", false);
  const [ccDraft, setCcDraft] = useState<string | null>(null);
  const ccName = ccDraft ?? ccLabel;
  const saveCcLabel = async () => {
    await writeSetting(userId, "cc_col_label", ccName.trim() || tr.cashflow.ccInstallments);
    scheduleSync(userId);
    setCcDraft(null);
  };
  const toggleCc = async (visible: boolean) => {
    await writeSetting(userId, "cc_col_hidden", !visible);
    scheduleSync(userId);
  };

  const add = async () => {
    await writeRows(userId, [
      {
        table: "categories",
        row: {
          id: newId(),
          name: name.trim(),
          kind,
          icon: suggestCategoryIcon(name.trim(), kind),
          color: null,
          sortOrder: categories.length,
          isColumn: true,
          deletedAt: null,
        },
      },
    ]);
    scheduleSync(userId);
    setName("");
  };

  const update = async (c: (typeof categories)[number], patch: Partial<(typeof categories)[number]>) => {
    await writeRows(userId, [{ table: "categories", row: { ...c, ...patch } }]);
    scheduleSync(userId);
  };

  const remove = async (c: (typeof categories)[number]) => {
    const snapshot = await softDelete(userId, "categories", c.id);
    scheduleSync(userId);
    if (snapshot) undo.show(`${c.name} — ${tr.common.deleted}`, () => void restoreRow(userId, "categories", snapshot));
  };

  return (
    <Screen>
      <Body muted style={{ marginBottom: spacing.md }}>{tr.settings.categoriesDesc}</Body>
      <Card>
        <Field label={tr.settings.addCategory} value={name} onChangeText={setName} placeholder={useRotatingPlaceholder(placeholderPools.category)} />
        <Segmented
          options={[
            { value: "expense", label: tr.settings.kindExpense },
            { value: "income", label: tr.settings.kindIncome },
          ]}
          value={kind}
          onChange={setKind}
        />
        <Button label={tr.common.add} onPress={() => void add()} disabled={!name.trim()} />
      </Card>

      {/* Derived KK Taksit column: rename or hide it like a normal column. */}
      <Card>
        <Row gap={spacing.sm} style={{ marginBottom: spacing.xs }}>
          <CreditCard size={16} color={palette.textMuted} />
          <Label style={{ marginBottom: 0 }}>{tr.settings.ccColumnTitle}</Label>
        </Row>
        <Body muted style={{ fontSize: 12, marginBottom: spacing.sm }}>{tr.settings.ccColumnDesc}</Body>
        <Row>
          <View style={{ flex: 1 }}>
            <Field noMargin label={tr.settings.columnName} value={ccName} onChangeText={setCcDraft} />
          </View>
          <Button label={tr.common.save} variant="secondary" disabled={ccName.trim() === ccLabel} onPress={() => void saveCcLabel()} />
        </Row>
        <Spread style={{ marginTop: spacing.md }}>
          <Body muted style={{ fontSize: 12 }}>{tr.settings.columnVisible}</Body>
          <Switch value={!ccHidden} onValueChange={(v) => void toggleCc(v)} />
        </Spread>
      </Card>

      {(["expense", "income"] as const).map((k) => (
        <CardList
          key={k}
          items={categories.filter((c) => c.kind === k)}
          keyExtractor={(c) => c.id}
          header={<Heading style={{ marginTop: 0 }}>{k === "expense" ? tr.settings.kindExpense : tr.settings.kindIncome}</Heading>}
          renderItem={(c) =>
            editingId === c.id ? (
              <Row style={{ paddingVertical: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Field noMargin value={editName} onChangeText={setEditName} autoFocus />
                </View>
                <Button
                  label={tr.common.save}
                  variant="secondary"
                  disabled={!editName.trim()}
                  onPress={() => {
                    void update(c, { name: editName.trim() });
                    setEditingId(null);
                  }}
                />
                <Button label={tr.common.cancel} variant="ghost" onPress={() => setEditingId(null)} />
              </Row>
            ) : (
              <View style={{ paddingVertical: spacing.sm }}>
                <Spread>
                  <Body numberOfLines={2} style={{ flex: 1, paddingRight: spacing.sm }}>
                    {categoryIcon(c)} {c.name}
                  </Body>
                  <Row gap={spacing.sm}>
                    <IconButton
                      icon={Pencil}
                      size={32}
                      label={tr.common.edit}
                      onPress={() => {
                        setEditingId(c.id);
                        setEditName(c.name);
                      }}
                    />
                    <IconButton icon={Trash2} size={32} tone="danger" label={tr.common.delete} onPress={() => void remove(c)} />
                  </Row>
                </Spread>
                <Spread style={{ marginTop: spacing.xs }}>
                  <Body muted style={{ fontSize: 12 }}>{tr.settings.columnVisible}</Body>
                  <Switch value={c.isColumn} onValueChange={(v) => void update(c, { isColumn: v })} />
                </Spread>
              </View>
            )
          }
        />
      ))}
    </Screen>
  );
}
