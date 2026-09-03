/**
 * The KVKK notice's body, and the sheet that shows it without leaving a screen.
 *
 * WHY THE BODY LIVES HERE RATHER THAN IN THE ROUTE. Two surfaces have to show
 * this text: `src/app/privacy.tsx`, which Settings links to, and the auth
 * screens, where it has to be readable while an account is being created. A
 * legal instrument that exists twice is a legal instrument that will one day
 * say two things, and the copy people are shown before they consent is the
 * worst possible place for that to happen. So there is one body and two frames
 * around it.
 *
 * The shape carries that this is a legal instrument rather than a help page —
 * numbered sections, because a notice is cited by section; the statutory
 * lettering on the Article 11 rights, because that is how they are referred to;
 * and a measured line length, because these are long sentences and nobody
 * reads a 120-character legal paragraph.
 *
 * `tests/legal-notice.test.ts` asserts that every touchpoint links here, that
 * the address the notice names is the one the feedback function delivers to,
 * and that the iOS privacy manifest declares the same collection this
 * describes.
 */

import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Check from "lucide-react-native/icons/check";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import X from "lucide-react-native/icons/x";
import { Body, Button, Card, PanelHeader, SectionHeader } from "./components";
import { useModalAccessibility } from "./accessibility";
import { modalAnimationType } from "./modal-motion";
import { useReducedMotion } from "./motion";
import { interactionSurface } from "./interaction";
import { shouldPresentOptionsAsSheet } from "./responsive";
import { borderWidth, controlSize, font, radius, spacing, themeShadow, type, useTheme } from "./theme";
import { selectionTap } from "./haptics";
import { tr } from "../i18n/tr";

/** Article 11's own lettering. Eight rights, eight letters, in the alphabet the
 *  statute uses — so a reader comparing this against the law lines them up. */
const ARTICLE_11_LETTERS = ["a", "b", "c", "ç", "d", "e", "f", "g"] as const;

/**
 * A leading `**label**` drawn as the label it is.
 *
 * Every item in this notice is "the name of a category, then what is done with
 * it", and running the two together as one grey paragraph is what makes a
 * privacy notice unreadable. Deliberately not a Markdown renderer: one marker,
 * at the start, is the whole of what this text uses, and a parser would be a
 * dependency and a surface for the sake of a bold word.
 */
function NoticeItem({ text, marker }: { text: string; marker?: string }) {
  const { palette } = useTheme();
  const match = /^\*\*(.+?)\*\*\s*(.*)$/s.exec(text);
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm }}>
      {marker ? (
        <Body muted style={{ minWidth: 18, color: palette.textSecondary, fontFamily: type.label.fontFamily }}>
          {marker})
        </Body>
      ) : null}
      <Body muted style={{ flex: 1 }}>
        {match ? (
          <>
            <Body style={{ color: palette.text, fontFamily: type.label.fontFamily }}>{match[1]}</Body>
            {` ${match[2]}`}
          </>
        ) : text}
      </Body>
    </View>
  );
}

function Section({
  title,
  intro,
  items,
  lettered = false,
}: {
  title: string;
  intro?: string;
  items?: readonly string[];
  lettered?: boolean;
}) {
  return (
    <>
      <SectionHeader>{title}</SectionHeader>
      <Card>
        {intro ? <Body muted style={{ marginBottom: items ? spacing.md : 0 }}>{intro}</Body> : null}
        {items?.map((item, index) => (
          <NoticeItem key={item} text={item} marker={lettered ? ARTICLE_11_LETTERS[index] : undefined} />
        ))}
      </Card>
    </>
  );
}

/** The notice itself, with no opinion about what frames it. */
export function LegalNoticeBody() {
  const { palette } = useTheme();
  const legal = tr.legal;
  return (
    <>
      <Card>
        <PanelHeader icon={ShieldCheck} title={legal.subtitle} description={legal.updated} />
        <Body muted style={{ marginTop: spacing.sm }}>{legal.intro}</Body>
      </Card>

      <Section title={legal.controllerTitle} intro={legal.controllerBody(legal.controllerName, legal.contactEmail)} />
      <Section title={legal.collectedTitle} intro={legal.collectedIntro} items={legal.collected} />
      <Section title={legal.methodTitle} intro={legal.methodBody} />
      <Section title={legal.purposeTitle} intro={legal.purposeIntro} items={legal.purposes} />

      <Section title={legal.transferTitle} intro={legal.transferIntro} items={legal.transfers} />
      {/* The way out of the transfer, set apart from the list of who receives
          what — it is the one paragraph on this screen that describes a choice
          rather than a fact. */}
      <Card>
        <Body>{legal.transferNote}</Body>
      </Card>

      <Section title={legal.retentionTitle} items={legal.retention} />
      <Section title={legal.rightsTitle} intro={legal.rightsIntro} items={legal.rights} lettered />
      <Section title={legal.selfServiceTitle} items={legal.selfService} />
      <Section title={legal.contactTitle} intro={legal.contactBody(legal.contactEmail)} />

      <View
        style={{
          marginTop: spacing.lg,
          paddingTop: spacing.md,
          borderTopWidth: 1,
          borderTopColor: palette.border,
          borderRadius: radius.sm,
        }}
      >
        <Body muted style={{ fontSize: type.small.fontSize }}>{legal.disclaimer}</Body>
      </View>
    </>
  );
}

/**
 * The notice as an overlay, for the screens that must not navigate away.
 *
 * On the auth screens a push would cost the half-typed form, and until
 * 2026-09-03 it cost more than that: `/privacy` classified as a protected
 * route, so the guard bounced a signed-out reader straight back and the link
 * did nothing at all. `src/domain/app-guard.ts` now answers that route for
 * everyone, and this sheet is the reason it rarely has to — reading the notice
 * is a detour, not a departure.
 *
 * The phone/desktop split and its reasoning are `DialogShell`'s, asked through
 * the same `shouldPresentOptionsAsSheet` so the two agree by construction: a
 * pointer gets a centred box, a thumb gets a sheet it can reach.
 */
export function LegalNoticeSheet({ onClose, onAccept }: { onClose: () => void; onAccept?: () => void }) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const asSheet = shouldPresentOptionsAsSheet(width);
  const titleRef = useModalAccessibility(true, undefined, undefined, false);

  return (
    <Modal transparent animationType={modalAnimationType(reducedMotion)} visible onRequestClose={onClose}>
      {/* WHY THE SCRIM IS A SIBLING AND NOT A PARENT. This surface has to
          SCROLL — it is the longest text in the app — and a `Pressable`
          wrapping a `ScrollView` swallows the drag that would move it. Nesting
          it that way shipped a notice that could not be read past its first
          screen and a consent control at the bottom nobody could reach. The
          dismiss target is therefore painted behind the card rather than
          around it, which also means a tap inside the card never has to be
          swallowed to avoid closing the sheet. */}
      <View style={{ flex: 1, justifyContent: asSheet ? "flex-end" : "center", padding: asSheet ? 0 : spacing.lg }}>
        <Pressable
          accessible={false}
          tabIndex={-1}
          aria-label={tr.common.close}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: palette.scrim }]}
        />
        <View
          accessibilityViewIsModal
          aria-label={tr.legal.title}
          style={{
            alignSelf: "center",
            width: "100%",
            maxWidth: asSheet ? undefined : 560,
            // The notice is long, so the surface is bounded and the TEXT
            // scrolls inside it. Letting the card grow instead would push the
            // close control off a phone screen with no way back.
            maxHeight: asSheet ? height * 0.88 : height * 0.86,
            backgroundColor: palette.background,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            borderBottomLeftRadius: asSheet ? 0 : radius.lg,
            borderBottomRightRadius: asSheet ? 0 : radius.lg,
            ...themeShadow.overlay(palette),
          }}
        >
          <View
            ref={titleRef}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.lg,
              paddingBottom: spacing.md,
            }}
          >
            <Body accessibilityRole="header" style={{ flex: 1, color: palette.textStrong, fontFamily: type.heading.fontFamily, fontSize: type.heading.fontSize }}>
              {tr.legal.title}
            </Body>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr.common.close}
              onPress={onClose}
              style={(state) => ({
                width: controlSize.minimumTarget,
                height: controlSize.minimumTarget,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.sm,
                ...interactionSurface(palette, state),
              })}
            >
              <X accessible={false} size={20} color={palette.textSecondary} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}
            showsVerticalScrollIndicator={Platform.OS === "web"}
          >
            <LegalNoticeBody />
            {/* WHY ACCEPTANCE LIVES DOWN HERE. It is the last thing in the
                scroll, after the disclaimer, so the only way to reach it is to
                travel the whole notice. A tick-box sitting beside the form
                asks people to declare they read something they were never
                taken through; this one is placed where the reading ends.
                Nothing is disabled and no scroll position is measured — the
                distance is the mechanism, and a measured one would only teach
                people to fling the list. */}
            {onAccept ? (
              <Pressable
                accessibilityRole="checkbox"
                aria-checked={false}
                accessibilityState={{ checked: false }}
                accessibilityLabel={tr.legal.consentLabel}
                onPress={() => {
                  selectionTap();
                  onAccept();
                }}
                style={(state) => ({
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: spacing.sm,
                  marginTop: spacing.lg,
                  padding: spacing.md,
                  borderRadius: radius.md,
                  borderWidth: borderWidth.control,
                  borderColor: palette.primary,
                  ...interactionSurface(palette, state, { base: palette.surfaceAlt }),
                })}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    marginTop: 1,
                    borderRadius: radius.sm,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: borderWidth.control,
                    borderColor: palette.primary,
                  }}
                />
                <Text style={[type.small, { flex: 1, color: palette.text, lineHeight: 19 }]}>
                  {tr.legal.consentLabel}
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
          <View
            style={{
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.md,
              paddingBottom: spacing.lg,
              borderTopWidth: 1,
              borderTopColor: palette.border,
            }}
          >
            <Button label={tr.common.close} variant="secondary" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * The consent gate that stands in front of account creation.
 *
 * Consent has to be given rather than assumed, so this starts unchecked and the
 * submit button stays disabled until it is not — the same "wait for a plausible
 * attempt" rule the e-mail and password fields on that screen already follow.
 *
 * The label and the way to READ what is being accepted sit in the same row on
 * purpose. A consent line whose notice is one screen away is a consent line
 * people tick without opening, so the control that opens it is right there and
 * opens a sheet rather than navigating: the half-typed form survives.
 *
 * It is one Pressable with `accessibilityRole="checkbox"` rather than two, so a
 * screen reader announces one control in one state — the pattern
 * `selection-controls.tsx` already uses for every multi-select tile here.
 */
/**
 * The sign-up form's side of consent: one button before, one statement after.
 *
 * There is no tick-box here on purpose. Consent is given at the END of the
 * notice — see `LegalNoticeSheet` — so this is the way in and the record that
 * it happened, never a way to accept without opening anything.
 */
export function LegalConsentControl({
  consented,
  onOpen,
  invalid = false,
}: {
  consented: boolean;
  onOpen: () => void;
  /** Shown only after a refused submit, never while the form is still being filled. */
  invalid?: boolean;
}) {
  const { palette } = useTheme();
  if (consented) {
    return (
      <View style={{ marginBottom: spacing.md }}>
        <View
          accessibilityRole="text"
          accessibilityLabel={tr.legal.consentGiven}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            paddingVertical: spacing.sm,
          }}
        >
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: radius.sm,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: palette.primary,
            }}
          >
            <Check accessible={false} size={14} strokeWidth={3} color={palette.onPrimary} />
          </View>
          <Text style={[type.small, { flex: 1, color: palette.text }]}>{tr.legal.consentGiven}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={onOpen}
            style={(state) => ({
              minHeight: controlSize.minimumTarget,
              justifyContent: "center",
              paddingHorizontal: spacing.sm,
              borderRadius: radius.sm,
              ...interactionSurface(palette, state),
            })}
          >
            <Text style={[type.small, { color: palette.primaryText, fontFamily: font.semibold }]}>
              {tr.legal.consentChange}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Button
        label={tr.legal.consentOpen}
        variant="secondary"
        onPress={onOpen}
      />
      {invalid ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[type.small, { color: palette.errorText, marginTop: spacing.xs, marginLeft: spacing.xs }]}
        >
          {tr.legal.consentRequired}
        </Text>
      ) : null}
    </View>
  );
}
