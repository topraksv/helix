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
import FileCheck2 from "lucide-react-native/icons/file-check-corner";
import ScanLine from "lucide-react-native/icons/scan-line";
import TableProperties from "lucide-react-native/icons/table-properties";
import type { LucideIcon } from "lucide-react-native";
import { SuccessPop } from "./motion-primitives";
import { tr } from "../i18n/tr";
import { circle, font, radius, spacing, type, useTheme } from "./theme";

/**
 * The picture both importers draw: a document on the left, an arrow that
 * becomes a tick, and the Helix surface it lands in on the right.
 *
 * Shared for the same reason `ImportJourney` is, and because the two were
 * asked to look alike. They were copies — the frame, the connector and the
 * destination card were byte-identical in both screens — so the requirement
 * that they match was held together only by nobody editing one of them.
 * Only the document's interior and the destination's icon ever differed.
 */
export function ImportArtwork({
  ready,
  destinationIcon: Destination,
  children,
}: {
  ready: boolean;
  destinationIcon: LucideIcon;
  /** The source document's interior, which is the one thing that differs. */
  children: React.ReactNode;
}) {
  const { palette } = useTheme();
  return (
    <View accessible={false} style={{ width: 172, height: 112, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          position: "absolute",
          left: 2,
          top: 8,
          width: 88,
          height: 96,
          padding: spacing.sm,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: palette.border,
          backgroundColor: palette.surface,
        }}
      >
        {children}
      </View>
      <View style={{ position: "absolute", left: 78, width: 30, height: 30, borderRadius: circle(30), alignItems: "center", justifyContent: "center", backgroundColor: ready ? palette.positive : palette.primary }}>
        {ready ? <FileCheck2 accessible={false} size={17} color={palette.onPrimary} /> : <ArrowRight accessible={false} size={17} color={palette.onPrimary} />}
      </View>
      <View
        style={{
          position: "absolute",
          right: 0,
          bottom: 14,
          width: 78,
          height: 70,
          padding: spacing.sm,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: ready ? palette.positive : palette.border,
          backgroundColor: palette.primarySoft,
        }}
      >
        <Destination accessible={false} size={20} color={palette.primaryText} />
        <View style={{ width: 51, height: 5, borderRadius: 3, backgroundColor: palette.primary, marginTop: spacing.sm }} />
        <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: palette.border, marginTop: 5 }} />
      </View>
    </View>
  );
}

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
