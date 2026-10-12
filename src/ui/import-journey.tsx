/** The three-step map both importers (workbook, card statement) share. */

import { Fragment, type ReactNode } from "react";
import { Text, View } from "react-native";
import ArrowRight from "lucide-react-native/icons/arrow-right";
import FileCheck2 from "lucide-react-native/icons/file-check-corner";
import ScanLine from "lucide-react-native/icons/scan-line";
import TableProperties from "lucide-react-native/icons/table-properties";
import type { LucideIcon } from "lucide-react-native";
import { Card } from "./components";
import { SuccessPop } from "./motion-primitives";
import { Body } from "./primitives";
import { tr } from "../i18n/tr";
import { circle, font, radius, spacing, type, useTheme } from "./theme";

/**
 * The picture both importers draw: a document on the left, an arrow that
 * becomes a tick, and the Helix surface it lands in on the right.
 */
export function ImportArtwork({
  ready,
  destinationIcon: Destination,
  children,
}: {
  ready: boolean;
  destinationIcon: LucideIcon;
  /** The source document's interior, which is the one thing that differs. */
  children: ReactNode;
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

/** The bulleted lines of an importer's guide. */
export function GuideBullets({ items }: { items: readonly string[] }) {
  const { palette } = useTheme();
  return (
    <>
      {items.map((line) => (
        <View key={line} style={{ flexDirection: "row", marginBottom: spacing.xs }}>
          <Text style={[type.small, { color: palette.primaryText, marginRight: spacing.xs }]}>•</Text>
          <Text style={[type.small, { color: palette.textSecondary, flex: 1 }]}>{line}</Text>
        </View>
      ))}
    </>
  );
}

/** The card both importers open with: the artwork beside a title, a line of text and the pick button. */
export function ImportHero({ wide, artwork, title, body, children }: {
  wide: boolean;
  artwork: ReactNode;
  title: string;
  body: string;
  children: ReactNode;
}) {
  const { palette } = useTheme();
  return (
    <Card style={{ backgroundColor: palette.surfaceAlt }}>
      <View style={{ flexDirection: wide ? "row" : "column", alignItems: "center", gap: spacing.lg }}>
        {artwork}
        <View style={{ flex: 1, minWidth: 0, alignSelf: "stretch", justifyContent: "center" }}>
          <Text style={[type.heading, { color: palette.textStrong }]}>{title}</Text>
          <Body muted style={{ marginTop: spacing.xs, marginBottom: spacing.md }}>{body}</Body>
          {children}
        </View>
      </View>
    </Card>
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
      accessibilityLabel={steps.map((step, index) => (index === stage ? `${step.label} (${tr.importer.currentStep})` : step.label)).join(", ")}
      // Not a Card, so it reserves its own gap below.
      style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.md }}
    >
      {steps.map((item, index) => {
        const Icon = item.icon;
        const active = index <= stage;
        return (
          <Fragment key={item.label}>
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
          </Fragment>
        );
      })}
    </View>
  );
}
