/**
 * The one currency control.
 *
 * Three screens used to map the whole supported list into a chip row. That read
 * fine at four currencies and stops working at fourteen: the chips wrap into a
 * block that dwarfs the field they belong to, and the ordering buries the two
 * currencies almost every entry actually uses.
 *
 * So the shape follows the usage. TRY, USD and EUR are chips; the rest live
 * behind one more chip that opens the list directly. It is `Select`'s own modal
 * — passed a chip-shaped trigger — so the focus trap, the keyboard behaviour
 * and the option rendering are not written a second time, and no second field
 * appears next to the row to hold a value the chip already shows.
 *
 * Changing the selection never converts what the user typed. The amount is
 * theirs; only its currency changes.
 */

import { Pressable, Text, View } from "react-native";
import { Select } from "./components";
import { SUPPORTED_CURRENCIES, type Currency } from "../services/fx-fetch";
import { CURRENCY_INFO, currencyLabel } from "../domain/fx-provider";
import { tr } from "../i18n/tr";
import { controlSize, font, radius, spacing, stateOpacity, type, useTheme } from "./theme";

/** Kept in front because together they are almost every entry in this app. */
const PRIMARY = ["TRY", "USD", "EUR"] as const satisfies readonly Currency[];
const OTHERS = SUPPORTED_CURRENCIES.filter((code) => !(PRIMARY as readonly string[]).includes(code));

export function CurrencyPicker({
  value,
  onChange,
}: {
  /**
   * Deliberately a plain string: the column is free text, so a row written
   * before this list existed can hold a code the app no longer offers. Such a
   * value is shown as-is and left alone — quietly rewriting it would change
   * what a stored amount means.
   */
  value: string;
  onChange: (currency: Currency) => void;
}) {
  const { palette } = useTheme();
  const isPrimary = (PRIMARY as readonly string[]).includes(value);

  const chip = (label: string, selected: boolean, onPress: () => void, hint?: string) => (
    <Pressable
      key={label}
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityState={{ checked: selected, selected }}
      accessibilityLabel={hint}
      onPress={onPress}
      style={({ pressed }) => ({
        // Four equal columns rather than four intrinsic widths. Picking a
        // currency renames the last chip ("Diğer" → "🇦🇱 ALL"), and at intrinsic
        // width that one extra glyph pushed it onto a second line on a phone —
        // the row reflowed as a side effect of choosing. Sharing the width means
        // the label can change without the layout moving.
        flex: 1,
        minHeight: controlSize.minimumTarget,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: spacing.sm,
        borderRadius: radius.full,
        backgroundColor: selected ? palette.primarySoft : palette.surfaceAlt,
        opacity: pressed ? stateOpacity.pressed : 1,
      })}
    >
      <Text
        style={[
          type.label,
          {
            color: selected ? palette.primaryText : palette.text,
            fontFamily: selected ? font.semibold : font.regular,
            textAlign: "center",
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md }}>
      {PRIMARY.map((code) => chip(currencyLabel(code), value === code, () => onChange(code), CURRENCY_INFO[code].name))}
      {/* `Select` renders its trigger inside a wrapper of its own, so the
          fourth column has to be claimed out here or the chip's own `flex`
          would only divide that intrinsic wrapper. */}
      <View style={{ flex: 1 }}>
      <Select<Currency>
        label={tr.common.otherCurrencies}
        placeholder={tr.common.otherCurrencies}
        // Flag, name and code: the list is read by country far more often than
        // by ISO code, and the code alone made a fourteen-row sheet unscannable.
        options={OTHERS.map((code) => ({
          value: code,
          label: `${CURRENCY_INFO[code].name} · ${code}`,
          icon: CURRENCY_INFO[code].flag,
        }))}
        value={isPrimary ? null : (value as Currency)}
        onChange={onChange}
        trigger={(open) =>
          chip(
            isPrimary ? `••• ${tr.common.other}` : currencyLabel(value),
            !isPrimary,
            open,
            tr.common.otherCurrencies,
          )
        }
      />
      </View>
    </View>
  );
}
