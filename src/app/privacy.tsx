/**
 * The KVKK notice, where a person can actually read it.
 *
 * It was in `docs/PRIVACY.md` and nowhere else — a document the repository does
 * not publish (`docs/` is Git-ignored) inside a repository most users will
 * never open. A notice nobody can reach discloses nothing, so the disclosure
 * lives in the app, on a route that works before sign-in: the screen that asks
 * for an e-mail address is the screen that has to say what happens to it.
 *
 * This file is only the route. The text and its shape are `LegalNoticeBody` in
 * `src/ui/legal-notice.tsx`, shared with the sheet the auth screens open, so
 * the copy someone reads before consenting and the copy Settings links to
 * cannot drift apart.
 *
 * `src/domain/app-guard.ts` classifies this route as `public`. Without that it
 * read as protected account UI and the guard bounced signed-out readers to
 * sign-in, which is the one audience the notice exists for.
 *
 * `readable` is set because this screen is 3594px of text with no control in
 * it, so its scroll region is the only thing a keyboard could move and there
 * was nothing for Tab to land on. It is the only screen in the app with that
 * shape; see `useKeyboardReachableScroller`.
 */

import { View } from "react-native";
import { Screen } from "../ui/components";
import { LegalNoticeBody } from "../ui/legal-notice";
import { spacing } from "../ui/theme";

export default function PrivacyScreen() {
  return (
    <Screen width="form" readable>
      <LegalNoticeBody />
      <View style={{ height: spacing.xxl }} />
    </Screen>
  );
}
