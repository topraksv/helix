/** Route only; the text is `LegalNoticeBody` (src/ui/legal-notice.tsx). Public in app-guard so signed-out readers reach it; `readable` because the screen has no focusable control. */

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
