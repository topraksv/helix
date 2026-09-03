import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import AlertCircle from "lucide-react-native/icons/circle-alert";
import BellRing from "lucide-react-native/icons/bell-ring";
import CheckCircle2 from "lucide-react-native/icons/circle-check";
import CloudOff from "lucide-react-native/icons/cloud-off";
import Table2 from "lucide-react-native/icons/table-2";
import WalletCards from "lucide-react-native/icons/wallet-cards";
import { useSession } from "../../auth/session";
import { LegalConsentControl, LegalNoticeSheet } from "../../ui/legal-notice";
import { isSupabaseConfigured } from "../../sync/supabase";
import { Body, Button, Card, Field, Screen } from "../../ui/components";
import { useSubmitOnEnter } from "../../ui/keyboard";
import { clearLifecycleIntent } from "../../ui/lifecycle-intent";
import { BrandMark } from "../../ui/brand";
import { interactionSurface } from "../../ui/interaction";
import { controlSize, font, maxFontScale, radius, spacing, stateOpacity, type, useTheme } from "../../ui/theme";
import { tr } from "../../i18n/tr";
import { useOperationGuard } from "../../ui/operation-guard";
import { OperationFlow } from "../../ui/operation-flow";
import { isValidNewPassword } from "../../domain/input";
import { shouldSplitAuthHero } from "../../ui/responsive";
import { useContentWidth } from "../../ui/viewport";

function JourneyNode({
  icon: Icon,
  label,
  active,
}: {
  icon: typeof WalletCards;
  label: string;
  active?: boolean;
}) {
  const { palette } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", minWidth: 0 }}>
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: radius.xl,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: active ? palette.primary : palette.surfaceAlt,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: active ? palette.primaryStrong : palette.border,
        }}
      >
        <Icon accessible={false} size={21} strokeWidth={1.8} color={active ? palette.onPrimary : palette.textSecondary} />
      </View>
      <Text
        // A third of the card, beside a 46pt disc that does not scale: at the
        // largest iOS accessibility size (~3.1x) "Kaydet" no longer fitted its
        // column and iOS broke it MID-WORD — "Kay / det", "Anl / a", "Taki / p
        // et" — which is the truncation this app refuses, wearing a different
        // costume. Found on a simulator at
        // `content_size accessibility-extra-extra-extra-large`.
        maxFontSizeMultiplier={maxFontScale.measuredBox}
        style={[type.small, {
          color: active ? palette.accentText : palette.textSecondary,
          fontFamily: font.semibold,
          textAlign: "center",
          marginTop: spacing.xs,
        }]}
      >
        {label}
      </Text>
    </View>
  );
}

function AuthJourneyArtwork({ compact }: { compact: boolean }) {
  const { palette } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${tr.auth.journeyEntry}, ${tr.auth.journeyLedger}, ${tr.auth.journeyTrack}`}
      style={{
        minHeight: compact ? 132 : 286,
        borderRadius: radius.lg,
        backgroundColor: palette.surfaceAlt,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border + "90",
        overflow: "hidden",
        justifyContent: "center",
        padding: compact ? spacing.md : spacing.xl,
      }}
    >
      <View
        accessible={false}
        style={{
          position: "absolute",
          width: compact ? 180 : 320,
          height: compact ? 180 : 320,
          borderRadius: radius.full,
          backgroundColor: palette.primarySoft,
          opacity: 0.68,
          top: compact ? -105 : -175,
          right: compact ? -65 : -120,
        }}
      />
      <View
        accessible={false}
        style={{
          position: "absolute",
          width: compact ? 95 : 170,
          height: compact ? 95 : 170,
          borderRadius: radius.full,
          backgroundColor: palette.secondarySoft,
          opacity: 0.72,
          bottom: compact ? -55 : -90,
          left: compact ? -25 : -45,
        }}
      />
      <View style={{ flexDirection: "row", alignItems: "flex-start", width: "100%" }}>
        <JourneyNode icon={WalletCards} label={tr.auth.journeyEntry} active />
        <View style={{ flex: 0.52, height: 1, backgroundColor: palette.border, marginTop: 23 }} />
        <JourneyNode icon={Table2} label={tr.auth.journeyLedger} />
        <View style={{ flex: 0.52, height: 1, backgroundColor: palette.border, marginTop: 23 }} />
        <JourneyNode icon={BellRing} label={tr.auth.journeyTrack} />
      </View>
      {!compact ? (
        <View style={{ marginTop: spacing.xl }}>
          {[0.72, 0.48, 0.86].map((value, index) => (
            <View key={value} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: index ? spacing.sm : 0 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: [palette.primary, palette.secondary, palette.tertiary][index] }} />
              <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: palette.surfaceStrong + "80" }}>
                <View style={{ width: `${value * 100}%`, height: 6, borderRadius: 3, backgroundColor: [palette.primary, palette.secondary, palette.tertiary][index] }} />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A quiet action on this screen: the notice, "forgot password", "back to
 * sign-in".
 *
 * They were three full-width ghost buttons stacked down the card, each with its
 * own 44pt row and margin. That is a lot of vertical weight for actions nobody
 * comes here to take, and it is what pushed the form past the fold on a phone.
 * As inline links they read as secondary, sit on one line, and still carry the
 * full touch target through `minHeight` rather than through padding that would
 * make the row wider than the words.
 */
function AuthLink({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={(state) => ({
        minHeight: controlSize.minimumTarget,
        justifyContent: "center",
        paddingHorizontal: spacing.xs,
        borderRadius: radius.sm,
        opacity: disabled ? stateOpacity.disabled : 1,
        ...interactionSurface(palette, state),
      })}
    >
      <Text style={[type.small, { color: palette.primaryText, fontFamily: font.semibold }]}>{label}</Text>
    </Pressable>
  );
}

export default function SignInScreen() {
  const [mode, setMode] = useState<"signIn" | "signUp" | "forgot">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [signUpConfirmationSent, setSignUpConfirmationSent] = useState(false);
  const [consented, setConsented] = useState(false);
  /** Only true after a refused submit: the form does not scold while it is being filled. */
  const [consentRefused, setConsentRefused] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const { signIn, signUp, requestPasswordReset } = useSession();
  const { palette } = useTheme();
  const operationGuard = useOperationGuard();
  const wide = shouldSplitAuthHero(useContentWidth());

  const emailValid = /.+@.+\..+/.test(email.trim());
  /**
   * The two conditions are deliberately separate.
   *
   * `formReady` is everything the person has typed. Consent is the one further
   * condition on sign-up, and it is kept out of `formReady` so the button can
   * stay PRESSABLE while it is the only thing missing — pressing it then says
   * what is missing, which a greyed-out button never does. A form that is
   * simply not filled in yet still disables the button, because there the
   * fields already show their own errors.
   */
  const formReady = emailValid && (
    mode === "forgot" || (mode === "signUp" ? isValidNewPassword(password) : password.length >= 6)
  ) && !busy;
  const canSubmit = formReady && (mode !== "signUp" || consented);
  const primaryLabel = mode === "signIn"
      ? tr.auth.signIn
      : mode === "signUp"
        ? tr.auth.signUpTitle
        : resetSent
          ? tr.auth.resendResetLink
          : tr.auth.sendResetLink;
  const operationLabel =
    mode === "signIn"
      ? tr.operation.signingIn
      : mode === "signUp"
        ? tr.operation.creatingAccount
        : tr.operation.requestingReset;

  const submit = async () => {
    if (!canSubmit) return;
    // A lifecycle intent outlives the operation that set it — it is what the
    // waiting screen reads while a session tears down. Starting a new session
    // is what ends it; otherwise the first pull after signing back in would
    // still announce the sign-out that came before it.
    clearLifecycleIntent();
    await operationGuard.run(async () => {
      setBusy(true);
      setError(null);
      if (mode === "signUp") setSignUpConfirmationSent(false);
      try {
        let err: string | null = null;
        if (mode === "signUp") {
          const result = await signUp(email.trim(), password);
          if (result.status === "error") err = result.message;
          else if (result.status === "confirmation-required") setSignUpConfirmationSent(true);
        } else {
          err = mode === "signIn"
            ? await signIn(email.trim(), password)
            : await requestPasswordReset(email.trim());
        }
        // On success, let the root route guard navigate (it keys off userId +
        // onboarded). Replacing to "/" here landed on a length-0 route that made the
        // guard's "(tabs)" redirect loop (React error #185 → white screen).
        if (err) setError(err);
        else if (mode === "forgot") setResetSent(true);
      } catch {
        setError(tr.errors.requestFailed);
      } finally {
        setBusy(false);
      }
    });
  };

  const switchMode = () => {
    setError(null);
    setResetSent(false);
    setSignUpConfirmationSent(false);
    // Consent belongs to the attempt that was made, not to the session. Leaving
    // it ticked across a mode switch would mean a later sign-up inherited an
    // acceptance nobody gave on that form.
    setConsented(false);
    setConsentRefused(false);
    setMode(mode === "signIn" ? "signUp" : "signIn");
  };

  const showForgot = () => {
    setMode("forgot");
    setPassword("");
    setError(null);
    setResetSent(false);
    setSignUpConfirmationSent(false);
    setConsented(false);
    setConsentRefused(false);
  };

  useSubmitOnEnter(() => void submit(), canSubmit);

  return (
    <Screen scroll width="form">
      {/* WHY THIS COLUMN IS TOP-ALIGNED. It used to centre its children, so
          every change in the form's height re-centred the whole layout and the
          brand mark drifted up or down on each switch between sign-in, sign-up
          and reset — the "screen keeps resizing" this screen was reported for.
          Anchoring the top pins the mark and the greeting under it: only the
          card's bottom edge moves now, which is the one thing that has to. */}
      <View
        style={{
          flex: 1,
          justifyContent: "flex-start",
          paddingVertical: wide ? spacing.xl : spacing.lg,
          flexDirection: wide ? "row" : "column",
          alignItems: "flex-start",
          gap: wide ? spacing.xxl : spacing.lg,
        }}
      >
        {/* `stretch` is what gives a child its full WIDTH in the column
            layout — and its full HEIGHT in the row one, which left the form
            card floating in a tall empty box on a desktop. It follows the
            direction rather than being set once. */}
        {/* ONE header, not two. The mark used to sit above its own "Kişisel
            finans çalışma alanın" line, and a separate "Helix'e hoş geldin"
            heading followed it with a second supporting sentence — four lines
            saying the product's name and purpose twice. The mark now leads the
            greeting itself, and one sentence supports it.

            `stretch` is what gives a child its full WIDTH in the column layout
            and its full HEIGHT in the row one, so it follows the direction
            rather than being set once. */}
        <View style={{ flex: wide ? 1.08 : undefined, alignSelf: wide ? "flex-start" : "stretch", minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.sm }}>
            <BrandMark size={wide ? 48 : 40} />
            <Text
              accessibilityRole="header"
              style={[type.display, {
                flex: 1,
                minWidth: 0,
                color: palette.textStrong,
                lineHeight: wide ? 45 : 33,
                fontSize: wide ? undefined : Math.round(type.sectionTitle.fontSize * 1.3),
              }]}
            >
              {tr.auth.welcomeTitle}
            </Text>
          </View>
          <Body muted style={{ marginBottom: spacing.lg, maxWidth: 470, lineHeight: 22 }}>
            {tr.auth.welcomeBody}
          </Body>
          {/* Decoration, and the first thing to go when the form grows: a
              phone has to reach the submit button without scrolling, and on
              sign-up the form itself is taller. */}
          {wide || mode === "signIn" ? <AuthJourneyArtwork compact={!wide} /> : null}
        </View>

        {/* One skeleton for all three modes: heading, subtitle, fields,
            actions — in that order, with the same gaps. Sign-in used to open
            with an extra signature panel and carry no subtitle, so it was both
            taller at the top and shorter in the middle than its siblings, and
            switching modes redrew the card at three different sizes. */}
        <Card style={{ flex: wide ? 0.92 : undefined, alignSelf: wide ? "flex-start" : "stretch", marginBottom: 0, padding: wide ? spacing.xl : spacing.lg }}>
          <Text accessibilityRole="header" style={[type.heading, { color: palette.text, marginBottom: spacing.xs }]}>
            {mode === "signIn" ? tr.auth.signInHeading : mode === "signUp" ? tr.auth.signUpTitle : tr.auth.forgotTitle}
          </Text>
          <Body muted style={{ marginBottom: spacing.lg }}>
            {mode === "signIn" ? tr.auth.signInSubtitle : mode === "signUp" ? tr.auth.signUpSubtitle : tr.auth.forgotSubtitle}
          </Body>

          <Field
            label={tr.auth.email}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setError(null);
              setSignUpConfirmationSent(false);
            }}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            placeholder={tr.placeholders.email}
            /* The submit button is disabled until this is valid, and it used
               to be the only sign — a grey "Giriş yap" with nothing saying
               why. The password field beside it already got this right for a
               short password; the two now behave the same way. It waits for a
               plausible attempt rather than complaining at the first letter. */
            error={email.trim().length > 3 && !emailValid ? tr.auth.emailInvalid : null}
          />
          {mode !== "forgot" ? (
            <Field
              label={tr.auth.password}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                setError(null);
                setSignUpConfirmationSent(false);
              }}
              secure
              autoComplete={mode === "signIn" ? "current-password" : "new-password"}
              textContentType={mode === "signIn" ? "password" : "newPassword"}
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              error={mode === "signUp" && password.length > 0 && !isValidNewPassword(password) ? tr.auth.passwordMin : null}
            />
          ) : null}

          {resetSent || signUpConfirmationSent ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: palette.success + "16", borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md }}>
              <CheckCircle2 accessible={false} size={17} color={palette.success} />
              <Text accessibilityLiveRegion="polite" style={[type.label, { color: palette.successText, flex: 1 }]}>
                {signUpConfirmationSent ? tr.auth.signUpConfirmationSent : tr.auth.resetSent}
              </Text>
            </View>
          ) : null}

          {error ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: palette.error + "16", borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md }}>
              <AlertCircle accessible={false} size={17} color={palette.error} />
              <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[type.label, { color: palette.errorText, flex: 1 }]}>{error}</Text>
            </View>
          ) : null}

          {busy ? (
            // The running notice appears between the password field and the
            // submit button, where nothing had reserved space for it: it was
            // pressed against both neighbours the moment it appeared. Its own
            // surface and margins keep the card's rhythm when it does.
            <View
              style={{
                marginBottom: spacing.md,
                padding: spacing.md,
                borderRadius: radius.md,
                backgroundColor: palette.surfaceAlt,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: palette.border,
              }}
            >
              <OperationFlow
                kind={mode === "signIn" ? "sign-in" : mode === "signUp" ? "sign-up" : "reset"}
                label={operationLabel}
              />
            </View>
          ) : null}
          {/* Before the account exists, not after. Creating one is the moment
              an e-mail address and every later record starts being processed on
              servers in another country, and that is the one fact a person
              cannot undo by reading the notice afterwards. */}
          {mode === "signUp" ? (
            <>
              <Body muted style={{ marginBottom: spacing.sm, fontSize: type.small.fontSize }}>
                {tr.legal.signUpNotice}
              </Body>
              <LegalConsentControl
                consented={consented}
                onOpen={() => setNoticeOpen(true)}
                invalid={consentRefused && !consented}
              />
            </>
          ) : null}
          <Button
            label={primaryLabel}
            onPress={() => {
              // A disabled button explains nothing. When consent is the only
              // thing missing, say so instead of leaving a grey button and no
              // reason — the same courtesy the e-mail and password fields
              // already extend.
              if (mode === "signUp" && !consented) {
                setConsentRefused(true);
                return;
              }
              void submit();
            }}
            disabled={!formReady}
          />
          {/* One row of text links instead of three stacked full-width ghost
              buttons. Each of those carried its own 44pt target and margin, so
              the quiet actions took more vertical space than the form they sat
              under and pushed the card past a phone screen. */}
          {/* The notice is NOT offered here. It belongs to the moment an
              account is created, which is when an e-mail address and every
              later record start being processed abroad — signing in to an
              account that already exists starts nothing, and repairing a
              password is a credential fix. Putting the link on all three modes
              was mistaking "the address is typed here" for "collection begins
              here", and it buried the one screen where it matters among two
              where it does not. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: spacing.md, marginTop: spacing.md }}>
            {mode === "signIn" ? <AuthLink label={tr.auth.forgotPassword} onPress={showForgot} /> : null}
            {resetSent ? <AuthLink label={tr.auth.backToSignIn} onPress={switchMode} disabled={busy} /> : null}
          </View>

          {/* `alignItems` is not decoration here. A row defaults to `stretch`,
              so the question text grew to the 44px touch target beside it and
              drew itself at the TOP of that box while the link centred itself
              inside the same height — two sentences on one line, on different
              baselines. Found on an iOS simulator, because the browser suite
              exports with an empty Supabase configuration and never reaches
              this screen at all. */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.md }}>
            <Body muted>{mode === "signIn" ? tr.auth.noAccount : mode === "signUp" ? tr.auth.haveAccount : tr.auth.rememberedPassword}</Body>
            <Pressable
              accessibilityRole="button"
              onPress={switchMode}
              style={(state) => ({
                minHeight: controlSize.minimumTarget,
                justifyContent: "center",
                // The text is the control's visible width. Padding here made
                // the hit box overlap the question beside it; the web layout
                // keeps the same visual gap without a negative margin.
                paddingHorizontal: 0,
                borderRadius: radius.sm,
                ...interactionSurface(palette, state),
              })}
            >
              <Text style={[type.body, { color: palette.primaryText, fontFamily: font.semibold }]}>
                {mode === "signIn" ? tr.auth.signUpAction : tr.auth.signInAction}
              </Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, justifyContent: "center", marginTop: spacing.lg }}>
            <CloudOff accessible={false} size={14} color={palette.textSecondary} />
            <Text style={[type.small, { color: palette.textSecondary, textAlign: "center", flexShrink: 1 }]}>
              {isSupabaseConfigured ? tr.auth.offlineNote : tr.settings.syncUnconfiguredHint}
            </Text>
          </View>
        </Card>
      </View>
      {/* Opened rather than navigated to: a push would cost a half-typed form,
          and the notice is most often asked for mid-form. */}
      {noticeOpen ? (
        <LegalNoticeSheet
          onClose={() => setNoticeOpen(false)}
          // Only sign-up can accept. Opened from anywhere else it is a
          // document to read, with nothing to agree to.
          onAccept={mode === "signUp" ? () => {
            setConsented(true);
            setConsentRefused(false);
            setNoticeOpen(false);
          } : undefined}
        />
      ) : null}
    </Screen>
  );
}
