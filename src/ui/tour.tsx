/** First-run tour: six short slides explaining where everything lives.
 *  Shown once (kv flag), reopenable from Settings. */

import React, { useEffect, useState } from "react";
import { Modal, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Banknote, CalendarCheck, ChartPie, CloudUpload, PlusCircle, Table2, type LucideIcon } from "lucide-react-native";
import { kv } from "../lib/kv";
import { tr } from "../i18n/tr";
import { Button, FadeIn, Row } from "./components";
import { radius, spacing, type, useTheme } from "./theme";
import { useModalAccessibility } from "./accessibility";

const TOUR_KEY = "helix.tour.done";

const SLIDES = [
  { icon: ChartPie, title: tr.tour.s1Title, body: tr.tour.s1Body },
  { icon: PlusCircle, title: tr.tour.s2Title, body: tr.tour.s2Body },
  { icon: Table2, title: tr.tour.s3Title, body: tr.tour.s3Body },
  { icon: CalendarCheck, title: tr.tour.s4Title, body: tr.tour.s4Body },
  { icon: Banknote, title: tr.tour.s5Title, body: tr.tour.s5Body },
  { icon: CloudUpload, title: tr.tour.s6Title, body: tr.tour.s6Body },
] as const satisfies readonly { icon: LucideIcon; title: string; body: string }[];

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
  const { width } = useWindowDimensions();
  const [step, setStep] = useState(0);
  const titleRef = useModalAccessibility(true);
  const slide = SLIDES[step] ?? SLIDES[0];
  const IconCmp = slide.icon;
  const last = step === SLIDES.length - 1;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(8,10,18,0.55)", alignItems: "center", justifyContent: "center", padding: spacing.lg }}>
        <FadeIn
          accessibilityViewIsModal
          style={{
            width: Math.min(width - spacing.lg * 2, 420),
            backgroundColor: palette.surface,
            borderRadius: radius.lg,
            padding: spacing.xl,
          }}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              backgroundColor: palette.primarySoft,
              alignItems: "center",
              justifyContent: "center",
              alignSelf: "center",
              marginBottom: spacing.lg,
            }}
          >
            <IconCmp accessible={false} size={30} color={palette.primary} strokeWidth={1.9} />
          </View>
          {/* A minimum keeps ordinary slides stable while larger Dynamic Type
              may grow naturally instead of clipping the explanation. */}
          <View style={{ minHeight: 210, justifyContent: "flex-start" }}>
            <View
              ref={titleRef}
              accessible
              accessibilityRole="header"
              accessibilityLiveRegion="polite"
              accessibilityLabel={tr.a11y.tourStep(step + 1, SLIDES.length, slide.title)}
              tabIndex={-1}
            >
              <Text style={[type.heading, { color: palette.text, textAlign: "center", fontSize: 19 }]}>{slide.title}</Text>
            </View>
            <Text style={[type.body, { color: palette.textMuted, textAlign: "center", marginTop: spacing.sm, lineHeight: 22 }]}>
              {slide.body}
            </Text>
          </View>

          {/* dots */}
          <Row gap={spacing.sm} style={{ justifyContent: "center", marginVertical: spacing.xl }}>
            {SLIDES.map((_, i) => (
              <View
                key={i}
                accessible={false}
                style={{
                  width: i === step ? 20 : 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: i === step ? palette.primary : palette.border,
                }}
              />
            ))}
          </Row>

          <Button
            label={last ? tr.tour.start : tr.tour.next}
            onPress={() => {
              // Functional update + clamp so rapid taps can't overshoot or skip.
              if (step >= SLIDES.length - 1) onClose();
              else setStep((s) => Math.min(s + 1, SLIDES.length - 1));
            }}
          />
          {/* Reserve the skip row's height on every slide (shown only when not
              last) so the card height — and thus the button — never shifts. */}
          <View style={{ minHeight: 44, marginTop: spacing.sm, justifyContent: "center" }}>
            {!last ? (
              <Pressable accessibilityRole="button" onPress={onClose} style={{ alignSelf: "center", minHeight: 44, justifyContent: "center" }}>
                <Text style={[type.label, { color: palette.textMuted }]}>{tr.tour.skip}</Text>
              </Pressable>
            ) : null}
          </View>
        </FadeIn>
      </View>
    </Modal>
  );
}
