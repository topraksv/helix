/** First-run tour: six short slides explaining where everything lives.
 *  Shown once (kv flag), reopenable from Settings. */

import React, { useEffect, useState } from "react";
import { Modal, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Banknote, CalendarCheck, ChartPie, CloudUpload, PlusCircle, Table2, type LucideIcon } from "lucide-react-native";
import { kv } from "../lib/kv";
import { tr } from "../i18n/tr";
import { Button, FadeIn, Row } from "./components";
import { radius, spacing, type, useTheme } from "./theme";

const TOUR_KEY = "helix.tour.done";

const SLIDES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: ChartPie, title: tr.tour.s1Title, body: tr.tour.s1Body },
  { icon: PlusCircle, title: tr.tour.s2Title, body: tr.tour.s2Body },
  { icon: Table2, title: tr.tour.s3Title, body: tr.tour.s3Body },
  { icon: CalendarCheck, title: tr.tour.s4Title, body: tr.tour.s4Body },
  { icon: Banknote, title: tr.tour.s5Title, body: tr.tour.s5Body },
  { icon: CloudUpload, title: tr.tour.s6Title, body: tr.tour.s6Body },
];

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
  const slide = SLIDES[step];
  const IconCmp = slide.icon;
  const last = step === SLIDES.length - 1;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(8,10,18,0.55)", alignItems: "center", justifyContent: "center", padding: spacing.lg }}>
        <FadeIn
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
            <IconCmp size={30} color={palette.primary} strokeWidth={1.9} />
          </View>
          {/* Fixed min-height so the dots + button don't jump as slide text
              length changes between steps. */}
          <View style={{ minHeight: 132, justifyContent: "flex-start" }}>
            <Text style={[type.heading, { color: palette.text, textAlign: "center", fontSize: 19 }]}>{slide.title}</Text>
            <Text style={[type.body, { color: palette.textMuted, textAlign: "center", marginTop: spacing.sm, lineHeight: 22 }]}>
              {slide.body}
            </Text>
          </View>

          {/* dots */}
          <Row gap={spacing.sm} style={{ justifyContent: "center", marginVertical: spacing.xl }}>
            {SLIDES.map((_, i) => (
              <View
                key={i}
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
            onPress={() => (last ? onClose() : setStep(step + 1))}
          />
          {!last ? (
            <Pressable accessibilityRole="button" onPress={onClose} style={{ alignSelf: "center", marginTop: spacing.md }} hitSlop={8}>
              <Text style={[type.label, { color: palette.textMuted }]}>{tr.tour.skip}</Text>
            </Pressable>
          ) : null}
        </FadeIn>
      </View>
    </Modal>
  );
}
