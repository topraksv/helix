/** First-run tour: one short slide per place the app keeps something.
 *  Shown once (kv flag), reopenable from Settings. */

import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import Banknote from "lucide-react-native/icons/banknote";
import CalendarCheck from "lucide-react-native/icons/calendar-check";
import ChartPie from "lucide-react-native/icons/chart-pie";
import CloudUpload from "lucide-react-native/icons/cloud-upload";
import Landmark from "lucide-react-native/icons/landmark";
import Plus from "lucide-react-native/icons/plus";
import PlusCircle from "lucide-react-native/icons/circle-plus";
import Table2 from "lucide-react-native/icons/table-2";
import TrendingUp from "lucide-react-native/icons/trending-up";
import type { LucideIcon } from "lucide-react-native";
import { kv } from "../services/kv";
import { tr } from "../i18n/tr";
import { Button, FadeIn, Row } from "./components";
import { circle, font, radius, spacing, type, useTheme } from "./theme";
import { useModalAccessibility } from "./accessibility";
import { useReducedMotion } from "./motion";
import { modalAnimationType } from "./modal-motion";

const TOUR_KEY = "helix.tour.done";

const SLIDES = [
  { icon: ChartPie, title: tr.tour.s1Title, body: tr.tour.s1Body },
  { icon: PlusCircle, title: tr.tour.s2Title, body: tr.tour.s2Body },
  { icon: Table2, title: tr.tour.s3Title, body: tr.tour.s3Body },
  { icon: CalendarCheck, title: tr.tour.s4Title, body: tr.tour.s4Body },
  { icon: Banknote, title: tr.tour.s5Title, body: tr.tour.s5Body },
  { icon: Landmark, title: tr.tour.s6Title, body: tr.tour.s6Body },
  { icon: CloudUpload, title: tr.tour.s7Title, body: tr.tour.s7Body },
] as const satisfies readonly { icon: LucideIcon; title: string; body: string }[];

function TourArtwork({ step, icon: IconCmp }: { step: number; icon: LucideIcon }) {
  const { palette } = useTheme();
  const cells = Array.from({ length: 12 });
  return (
    <View
      accessible={false}
      style={{
        height: 122,
        overflow: "hidden",
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: palette.border + "70",
        backgroundColor: palette.surfaceAlt,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, backgroundColor: palette.primary }} />
      {step === 0 ? (
        <>
          <View style={{ position: "absolute", left: 18, top: 25, width: 104, height: 68, padding: spacing.sm, gap: 7, borderRadius: radius.md, backgroundColor: palette.surface }}>
            <View style={{ width: 42, height: 5, borderRadius: 3, backgroundColor: palette.textSecondary }} />
            <View style={{ width: 78, height: 12, borderRadius: 4, backgroundColor: palette.textStrong }} />
            <View style={{ width: 58, height: 4, borderRadius: 2, backgroundColor: palette.positive }} />
          </View>
          <View style={{ position: "absolute", right: 20, bottom: 18, flexDirection: "row", alignItems: "flex-end", gap: 5 }}>
            {[28, 48, 36, 62].map((height, index) => (
              <View key={height} style={{ width: 12, height, borderRadius: 4, backgroundColor: index === 3 ? palette.primary : palette.surfaceStrong }} />
            ))}
          </View>
        </>
      ) : step === 1 ? (
        <>
          <View style={{ position: "absolute", left: 20, right: 20, top: 24, gap: 8 }}>
            {[0, 1, 2].map((row) => (
              <View key={row} style={{ height: 20, borderRadius: 6, backgroundColor: palette.surface, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, gap: 7 }}>
                <View style={{ width: 8, height: 8, borderRadius: circle(8), backgroundColor: row === 0 ? palette.negative : palette.border }} />
                <View style={{ width: `${55 + row * 8}%`, height: 4, borderRadius: 2, backgroundColor: palette.surfaceStrong }} />
              </View>
            ))}
          </View>
          <View style={{ position: "absolute", right: 16, bottom: 12, width: 34, height: 34, borderRadius: circle(34), alignItems: "center", justifyContent: "center", backgroundColor: palette.primary }}>
            <Plus size={18} color={palette.onPrimary} strokeWidth={2.5} />
          </View>
        </>
      ) : step === 2 ? (
        <View style={{ borderRadius: radius.sm, overflow: "hidden", borderWidth: 1, borderColor: palette.border }}>
          {Array.from({ length: 4 }).map((_, row) => (
            <View key={row} style={{ flexDirection: "row" }}>
              {Array.from({ length: 5 }).map((__, column) => (
                <View
                  key={column}
                  style={{
                    width: 43,
                    height: 20,
                    borderRightWidth: column < 4 ? 1 : 0,
                    borderBottomWidth: row < 3 ? 1 : 0,
                    borderColor: palette.border,
                    backgroundColor: row === 0 || column === 0 ? palette.surfaceStrong : row === 2 && column === 3 ? palette.primarySoft : palette.surface,
                  }}
                />
              ))}
            </View>
          ))}
        </View>
      ) : step === 3 ? (
        <View style={{ width: 176, padding: spacing.sm, borderRadius: radius.md, backgroundColor: palette.surface }}>
          <View style={{ height: 6, width: 72, borderRadius: 3, backgroundColor: palette.primary, marginBottom: spacing.sm }} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
            {cells.map((_, index) => (
              <View key={index} style={{ width: 23, height: 16, borderRadius: 4, backgroundColor: index === 8 ? palette.positive : palette.surfaceAlt }} />
            ))}
          </View>
          <CalendarCheck size={24} color={palette.positiveText} style={{ position: "absolute", right: 10, top: 7 }} />
        </View>
      ) : step === 4 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          {[0, 1].map((index) => (
            <View key={index} style={{ width: 82, height: 52, padding: spacing.sm, borderRadius: radius.md, backgroundColor: index === 0 ? palette.secondarySoft : palette.surface }}>
              <View style={{ width: 34, height: 5, borderRadius: 3, backgroundColor: index === 0 ? palette.secondary : palette.textSecondary }} />
              <View style={{ width: 58, height: 10, borderRadius: 4, backgroundColor: palette.textStrong, marginTop: 8 }} />
            </View>
          ))}
          <View style={{ position: "absolute", left: 78, width: 26, height: 26, borderRadius: circle(26), alignItems: "center", justifyContent: "center", backgroundColor: palette.primary }}>
            <Banknote size={15} color={palette.onPrimary} />
          </View>
        </View>
      ) : step === 5 ? (
        // Investments: holdings of different sizes and a total that moved.
        // This used to fall through to the two-device frame below, so the
        // portfolio slide and the sync slide were the same drawing with a
        // different badge on it.
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 9 }}>
          {[{ h: 30, tone: palette.secondary }, { h: 52, tone: palette.primary }, { h: 40, tone: palette.tertiary }, { h: 66, tone: palette.primary }].map(({ h, tone }, index) => (
            <View key={index} style={{ alignItems: "center", gap: 5 }}>
              <View style={{ width: 20, height: h, borderRadius: radius.sm, backgroundColor: tone }} />
              <View style={{ width: 20, height: 3, borderRadius: 2, backgroundColor: palette.surfaceStrong }} />
            </View>
          ))}
          <View style={{ marginLeft: spacing.sm, alignItems: "flex-start", gap: 5 }}>
            <View style={{ width: 46, height: 5, borderRadius: 3, backgroundColor: palette.textSecondary }} />
            <View style={{ width: 62, height: 12, borderRadius: 4, backgroundColor: palette.textStrong }} />
            <Row gap={4}>
              <TrendingUp size={13} color={palette.positiveText} strokeWidth={2.4} />
              <View style={{ width: 30, height: 4, borderRadius: 2, backgroundColor: palette.positive }} />
            </Row>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.xl }}>
          {[{ w: 52, h: 76 }, { w: 92, h: 62 }].map(({ w, h }, index) => (
            <View key={w} style={{ width: w, height: h, padding: 6, borderRadius: radius.md, borderWidth: 2, borderColor: palette.textSecondary, backgroundColor: palette.surface }}>
              <View style={{ flex: 1, borderRadius: 5, backgroundColor: palette.primarySoft }} />
              {index === 0 ? <View style={{ alignSelf: "center", width: 14, height: 3, borderRadius: 2, backgroundColor: palette.textSecondary, marginTop: 4 }} /> : null}
            </View>
          ))}
          <View style={{ position: "absolute", left: 59, top: 8, width: 42, height: 42, borderRadius: circle(42), alignItems: "center", justifyContent: "center", backgroundColor: palette.primary }}>
            <IconCmp size={22} color={palette.onPrimary} />
          </View>
        </View>
      )}
      {step < 6 ? (
        <View style={{ position: "absolute", right: 12, top: 13, width: 30, height: 30, borderRadius: circle(30), alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft }}>
          <IconCmp size={16} color={palette.primaryText} />
        </View>
      ) : null}
    </View>
  );
}

/** Mounts on the dashboard; shows itself only on the first visit. */
export function FirstRunTour() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    void kv.get(TOUR_KEY).then((v) => {
      if (v !== "true") setVisible(true);
    });
  }, []);
  if (!visible) return null;
  return <TourModal onClose={() => { setVisible(false); void kv.set(TOUR_KEY, "true"); }} />;
}

export function TourModal({ onClose }: { onClose: () => void }) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const [step, setStep] = useState(0);
  const titleRef = useModalAccessibility(true);
  const slide = SLIDES[step] ?? SLIDES[0];
  const IconCmp = slide.icon;
  const last = step === SLIDES.length - 1;

  return (
    <Modal transparent animationType={modalAnimationType(reducedMotion)} visible onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: palette.scrim }}
        contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Pressable
          accessible={false}
          tabIndex={-1}
          accessibilityViewIsModal
          aria-label={tr.a11y.tourStep(step + 1, SLIDES.length, slide.title)}
          onPress={() => {}}
          style={{ width: Math.min(width - spacing.lg * 2, 420) }}
        >
          <View
            style={{
              backgroundColor: palette.surface,
              borderRadius: radius.lg,
              padding: spacing.lg,
              borderWidth: 1,
              borderColor: palette.border + "70",
            }}
          >
            <FadeIn key={step} rise={false}>
              <TourArtwork step={step} icon={IconCmp} />
            <View style={{ minHeight: 136, justifyContent: "flex-start", paddingTop: spacing.lg }}>
              <View
                ref={titleRef}
                accessible
                accessibilityRole="header"
                accessibilityLiveRegion="polite"
                accessibilityLabel={tr.a11y.tourStep(step + 1, SLIDES.length, slide.title)}
                tabIndex={-1}
              >
                <Text style={[type.heading, { color: palette.text, textAlign: "left", fontSize: type.heading.fontSize }]}>{slide.title}</Text>
              </View>
              <Text style={[type.body, { color: palette.textSecondary, textAlign: "left", marginTop: spacing.sm, lineHeight: 21 }]}>
                {slide.body}
              </Text>
            </View>
            </FadeIn>

            <Row gap={spacing.sm} style={{ justifyContent: "space-between", marginTop: spacing.md, marginBottom: spacing.md }}>
              <Text style={[type.small, { color: palette.textSecondary, fontFamily: font.semibold }]}>{`${step + 1} / ${SLIDES.length}`}</Text>
              <Row gap={5}>
              {SLIDES.map((_, i) => (
                <View
                  key={i}
                  accessible={false}
                  style={{
                    width: i === step ? 18 : 6,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: i === step ? palette.primary : palette.border,
                  }}
                />
              ))}
              </Row>
            </Row>

            <Row gap={spacing.sm}>
              {!last ? (
                <View style={{ flex: 0.42 }}>
                  <Button label={tr.tour.skip} variant="ghost" onPress={onClose} />
                </View>
              ) : null}
              <View style={{ flex: 1 }}>
                <Button
                  label={last ? tr.tour.start : tr.tour.next}
                  onPress={() => {
                    if (step >= SLIDES.length - 1) onClose();
                    else setStep((s) => Math.min(s + 1, SLIDES.length - 1));
                  }}
                />
              </View>
            </Row>
          </View>
        </Pressable>
      </ScrollView>
    </Modal>
  );
}
