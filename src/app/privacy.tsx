/**
 * The KVKK notice, where a person can actually read it.
 *
 * It was in `docs/PRIVACY.md` and nowhere else — a document the repository does
 * not publish (`docs/` is Git-ignored) inside a repository most users will
 * never open. A notice nobody can reach discloses nothing, so the disclosure
 * lives in the app, on a route that works before sign-in: the screen that asks
 * for an e-mail address is the screen that has to say what happens to it.
 *
 * The text is in `src/i18n/tr.ts` like every other string here, and this file
 * is only its shape. What the shape has to carry is that this is a legal
 * instrument rather than a help page — numbered sections, because a notice is
 * cited by section; the statutory lettering on the Article 11 rights, because
 * that is how they are referred to; and a measured line length, because these
 * are long sentences and nobody reads a 120-character legal paragraph.
 *
 * `tests/legal-notice.test.ts` asserts that every touchpoint links here, that
 * the address the notice names is the one the feedback function delivers to,
 * and that the iOS privacy manifest declares the same collection this
 * describes.
 */

import React from "react";
import { View } from "react-native";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import { Body, Card, PanelHeader, Screen, SectionHeader } from "../ui/components";
import { tr } from "../i18n/tr";
import { radius, spacing, type, useTheme } from "../ui/theme";

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

export default function PrivacyScreen() {
  const { palette } = useTheme();
  const legal = tr.legal;
  return (
    <Screen width="form">
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
          marginBottom: spacing.xxl,
          paddingTop: spacing.md,
          borderTopWidth: 1,
          borderTopColor: palette.border,
          borderRadius: radius.sm,
        }}
      >
        <Body muted style={{ fontSize: type.small.fontSize }}>{legal.disclaimer}</Body>
      </View>
    </Screen>
  );
}
