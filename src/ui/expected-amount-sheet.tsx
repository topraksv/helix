import { useState } from "react";
import { Text, View } from "react-native";
import { Amount, Body, Button, MoneyField, Row } from "./components";
import { ModalCard } from "./dialog";
import { formatMinorCompact } from "../domain/money";
import { tr } from "../i18n/tr";
import { spacing, type, useTheme } from "./theme";

/** One compact, keyboard-safe editor shared by upcoming payment surfaces. */
export function ExpectedAmountSheet({
  currency,
  currentMinor,
  isEstimated,
  onSave,
  onClose,
  onError,
}: {
  currency: string;
  currentMinor: number;
  isEstimated: boolean;
  onSave: (amountMinor: number) => void | Promise<void>;
  onClose: () => void;
  onError?: (error: unknown) => void;
}) {
  const { palette } = useTheme();
  const [amountRaw, setAmountRaw] = useState("");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (amountMinor == null || amountMinor <= 0 || saving) return;
    setSaving(true);
    try {
      await onSave(amountMinor);
      onClose();
    } catch (error) {
      onError?.(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalCard title={tr.subs.amountEntryTitle} testID="expected-amount-sheet" cardWidth={420} onClose={onClose}>
      <Body muted style={{ marginTop: spacing.xs, marginBottom: spacing.lg }}>{tr.subs.amountEntryHint}</Body>
      {/* 0 is the "no estimate entered" sentinel for a still-estimated
          row — a real ₺0,00 never reaches this sheet, so there is
          nothing to compare the invoice against yet. */}
      {isEstimated && currentMinor === 0 ? null : (
        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel={`${isEstimated ? tr.subs.estimatedAmount : tr.subs.currentAmount}: ${formatMinorCompact(currentMinor, currency)}`}
          style={{ marginBottom: spacing.md }}
        >
          <Text style={[type.small, { color: palette.textSecondary }]}>{isEstimated ? tr.subs.estimatedAmount : tr.subs.currentAmount}</Text>
          <Amount minor={currentMinor} currency={currency} colorized={false} style={{ marginTop: 2, textAlign: "left" }} />
        </View>
      )}
      <MoneyField
        label={`${tr.subs.amountEntryTitle} · ${currency}`}
        value={amountRaw}
        placeholder={currentMinor === 0 ? undefined : formatMinorCompact(currentMinor, currency)}
        onChangeMinor={(raw, minor) => {
          setAmountRaw(raw);
          setAmountMinor(minor);
        }}
      />
      <Row style={{ marginTop: spacing.sm, alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Button label={tr.common.save} onPress={() => void save()} disabled={amountMinor == null || amountMinor <= 0} loading={saving} />
        </View>
        <Button label={tr.common.cancel} variant="ghost" disabled={saving} onPress={onClose} />
      </Row>
    </ModalCard>
  );
}
