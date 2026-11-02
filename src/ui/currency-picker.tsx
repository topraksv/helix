/**
 * The one currency control: a chip that opens the full list in one tap. A
 * row of TRY/USD/EUR chips with an "other" chip beside it was a second way to
 * choose the same thing, and the owner asked for one.
 *
 * Changing the selection never converts what the user typed. The amount is
 * theirs; only its currency changes.
 */

import { Pressable, Text } from "react-native";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import { Select } from "./components";
import { SUPPORTED_CURRENCIES, type Currency } from "../services/fx-fetch";
import { CURRENCY_INFO, currencyLabel } from "../domain/fx-provider";
import { tr } from "../i18n/tr";
import { interactionSurface } from "./interaction";
import { borderWidth, controlSize, font, iconSize, radius, spacing, type, useTheme, type Palette } from "./theme";

/** A chip that states one choice of a form, lit while it differs from the default. */
export const optionChipPressStyle = (palette: Palette, selected: boolean) => (state: Parameters<typeof interactionSurface>[1]) => ({
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: spacing.xs,
  minHeight: controlSize.minimumTarget,
  paddingHorizontal: spacing.md,
  borderRadius: radius.md,
  borderWidth: borderWidth.control,
  borderColor: selected ? palette.primary : palette.border,
  ...interactionSurface(palette, state, { base: selected ? palette.primarySoft : palette.surfaceAlt }),
});

/**
 * The currency as a chip that is the dropdown itself: one tap lists every currency.
 *
 * `value` is deliberately a plain string: the column is free text, so a row
 * written before this list existed can hold a code the app no longer offers.
 * Such a value is shown as-is and left alone — quietly rewriting it would
 * change what a stored amount means.
 */
export function CurrencySelect({ value, onChange, testID }: { value: string; onChange: (currency: Currency) => void; testID?: string }) {
  const { palette } = useTheme();
  const foreign = value !== "TRY";
  const ink = foreign ? palette.primaryText : palette.text;
  return (
    <Select<Currency>
      label={tr.tx.currency}
      options={SUPPORTED_CURRENCIES.map((code) => ({ value: code, label: `${CURRENCY_INFO[code].name} · ${code}`, icon: CURRENCY_INFO[code].flag }))}
      value={value as Currency}
      onChange={onChange}
      trigger={(open) => (
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={tr.tx.changeCurrency(currencyLabel(value))}
          onPress={open}
          style={optionChipPressStyle(palette, foreign)}
        >
          <Text style={[type.label, { color: ink, fontFamily: font.semibold }]}>{currencyLabel(value)}</Text>
          <ChevronDown accessible={false} size={iconSize.control} color={ink} />
        </Pressable>
      )}
    />
  );
}
