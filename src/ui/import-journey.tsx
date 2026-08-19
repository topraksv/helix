/**
 * The three steps every import walks: pick the file, check what was read,
 * write it.
 *
 * Shared because the two importers are the same promise made about two file
 * types — a workbook and a card statement — and an owner who has learnt one
 * should not have to learn the other. It lived inside the workbook wizard and
 * the statement screen had nothing, so the more dangerous of the two (a
 * financial document the app cannot verify) was the one with no map.
 */

import React from "react";
import { Text, View } from "react-native";
import ArrowRight from "lucide-react-native/icons/arrow-right";
import ScanLine from "lucide-react-native/icons/scan-line";
import TableProperties from "lucide-react-native/icons/table-properties";
import type { LucideIcon } from "lucide-react-native";
import { SuccessPop } from "./motion-primitives";
import { tr } from "../i18n/tr";
import { circle, font, spacing, type, useTheme } from "./theme";

/** How far along the import is: file chosen, reviewed, written. */
export type ImportStage = 0 | 1 | 2;

export function ImportJourney({ stage, fileIcon }: { stage: ImportStage; fileIcon: LucideIcon }) {
  const { palette } = useTheme();
  const steps: { label: string; icon: LucideIcon }[] = [
    { label: tr.importer.stepFile, icon: fileIcon },
    { label: tr.importer.stepReview, icon: ScanLine },
    { label: tr.importer.stepImport, icon: TableProperties },
  ];
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={steps.map((step) => step.label).join(", ")}
      style={{ flexDirection: "row", alignItems: "center", marginVertical: spacing.md }}
    >
      {steps.map((item, index) => {
        const Icon = item.icon;
        const active = index <= stage;
        return (
          <React.Fragment key={item.label}>
            <View style={{ flex: 1, minWidth: 0, alignItems: "center", gap: 5 }}>
              {/* Keyed on the stage that owns it, so the step the wizard has
                  just reached lands rather than simply being a different
                  colour from the one before. An import is the longest thing
                  this app asks anyone to sit through and it needs to be seen
                  to advance. */}
              <SuccessPop key={index === stage ? `at-${stage}` : `step-${index}`}>
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: circle(38),
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1,
                    borderColor: active ? palette.primary : palette.border,
                    backgroundColor: active ? palette.primarySoft : palette.surface,
                  }}
                >
                  <Icon accessible={false} size={18} color={active ? palette.primaryText : palette.textSecondary} />
                </View>
              </SuccessPop>
              <Text style={[type.small, { color: active ? palette.text : palette.textSecondary, fontFamily: active ? font.semibold : font.regular, textAlign: "center" }]}>
                {item.label}
              </Text>
            </View>
            {index < steps.length - 1 ? (
              <View style={{ width: 34, alignItems: "center", marginTop: -18 }}>
                <ArrowRight accessible={false} size={16} color={index < stage ? palette.primary : palette.border} />
              </View>
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}
