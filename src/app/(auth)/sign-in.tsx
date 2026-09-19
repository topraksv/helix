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

type AuthMode = "signIn" | "signUp" | "forgot";

/** What each mode says, and how its operation is shown. */
const MODE = {
  signIn: {
    heading: () => tr.auth.signInHeading, subtitle: () => tr.auth.signInSubtitle, running: () => tr.operation.signingIn, flow: "sign-in",
    // Three modes, three sentences: the reset screen gets its own way back
    // rather than one that describes a different reader.
    other: () => tr.auth.createAccountAction,
  },
  signUp: {
    heading: () => tr.auth.signUpTitle, subtitle: () => tr.auth.signUpSubtitle, running: () => tr.operation.creatingAccount, flow: "sign-up",
    other: () => tr.auth.backToSignInAction,
  },
  forgot: {
    heading: () => tr.auth.forgotTitle, subtitle: () => tr.auth.forgotSubtitle, running: () => tr.operation.requestingReset, flow: "reset",
    other: () => tr.auth.backToSignIn,
  },
} as const;

function useAuthForm() {
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [signUpConfirmationSent, setSignUpConfirmationSent] = useState(false);
  const [consented, setConsented] = useState(false);
  /** Only true after a refused submit: the form does not scold while it is being filled. */
  const [consentRefused, setConsentRefused] = useState(false);
  const { signIn, signUp, requestPasswordReset } = useSession();
  const operationGuard = useOperationGuard();

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
  const passwordReady = mode === "forgot" || (mode === "signUp" ? isValidNewPassword(password) : password.length >= 6);
  const formReady = emailValid && passwordReady && !busy;
  const canSubmit = formReady && (mode !== "signUp" || consented);

  /** Whatever the last attempt said, and a consent given on another form. */
  const clearFeedback = () => {
    setError(null);
    setResetSent(false);
    setSignUpConfirmationSent(false);
    // Consent belongs to the attempt that was made, not to the session.
    setConsented(false);
    setConsentRefused(false);
  };

  /** The request `mode` makes, and the error it answered with, if any. */
  const request = async (): Promise<string | null> => {
    if (mode === "signIn") return signIn(email.trim(), password);
    if (mode === "forgot") return requestPasswordReset(email.trim());
    const result = await signUp(email.trim(), password);
    if (result.status === "confirmation-required") setSignUpConfirmationSent(true);
    return result.status === "error" ? result.message : null;
  };

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
      setSignUpConfirmationSent(false);
      try {
        // On success, let the root route guard navigate (it keys off userId +
        // onboarded). Replacing to "/" here landed on a length-0 route that made the
        // guard's "(tabs)" redirect loop (React error #185 → white screen).
        const err = await request();
        if (err) setError(err);
        else if (mode === "forgot") setResetSent(true);
      } catch {
        setError(tr.errors.requestFailed);
      } finally {
        setBusy(false);
      }
    });
  };

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setError(null);
    setSignUpConfirmationSent(false);
  };

  return {
    mode, email, password, error, busy, resetSent, signUpConfirmationSent, consented, consentRefused, emailValid, formReady, canSubmit, submit,
    setEmail: edit(setEmail),
    setPassword: edit(setPassword),
    switchMode: () => {
      clearFeedback();
      setMode(mode === "signIn" ? "signUp" : "signIn");
    },
    showForgot: () => {
      clearFeedback();
      setMode("forgot");
      setPassword("");
    },
    /** A disabled button explains nothing: when consent is all that is missing, say so. */
    pressPrimary: () => {
      if (mode === "signUp" && !consented) setConsentRefused(true);
      else void submit();
    },
    accept: () => {
      setConsented(true);
      setConsentRefused(false);
    },
  };
}

type AuthForm = ReturnType<typeof useAuthForm>;

function AuthNotice({ tone, text }: { tone: "success" | "error"; text: string }) {
  const { palette } = useTheme();
  const Icon = tone === "success" ? CheckCircle2 : AlertCircle;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: palette[tone] + "16", borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md }}>
      <Icon accessible={false} size={17} color={palette[tone]} />
      <Text
        accessibilityRole={tone === "error" ? "alert" : undefined}
        accessibilityLiveRegion={tone === "error" ? "assertive" : "polite"}
        style={[type.label, { color: tone === "error" ? palette.errorText : palette.successText, flex: 1 }]}
      >
        {text}
      </Text>
    </View>
  );
}

function AuthFormCard({ form, wide, onOpenNotice }: { form: AuthForm; wide: boolean; onOpenNotice: () => void }) {
  const { palette } = useTheme();
  const { mode } = form;
  const text = MODE[mode];
  const primaryLabel = mode === "signIn" ? tr.auth.signIn : mode === "signUp" ? tr.auth.signUpTitle : form.resetSent ? tr.auth.resendResetLink : tr.auth.sendResetLink;
  return (
    // One skeleton for all three modes — heading, subtitle, fields, actions —
    // with the same gaps, so switching modes does not redraw three card sizes.
    <Card style={{ flex: wide ? 0.92 : undefined, alignSelf: wide ? "flex-start" : "stretch", marginBottom: 0, padding: wide ? spacing.xl : spacing.lg }}>
      <Text accessibilityRole="header" style={[type.heading, { color: palette.text, marginBottom: spacing.xs }]}>{text.heading()}</Text>
      <Body muted style={{ marginBottom: spacing.lg }}>{text.subtitle()}</Body>
      <Field
        label={tr.auth.email}
        value={form.email}
        onChangeText={form.setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        placeholder={tr.placeholders.email}
        /* The submit button stays disabled until this is valid, so the field
           says why — waiting for a plausible attempt rather than the first letter. */
        error={form.email.trim().length > 3 && !form.emailValid ? tr.auth.emailInvalid : null}
      />
      {mode !== "forgot" ? (
        <Field
          label={tr.auth.password}
          value={form.password}
          onChangeText={form.setPassword}
          secure
          autoComplete={mode === "signIn" ? "current-password" : "new-password"}
          textContentType={mode === "signIn" ? "password" : "newPassword"}
          returnKeyType="go"
          onSubmitEditing={() => void form.submit()}
          error={mode === "signUp" && form.password.length > 0 && !isValidNewPassword(form.password) ? tr.auth.passwordMin : null}
        />
      ) : null}
      {form.resetSent || form.signUpConfirmationSent ? <AuthNotice tone="success" text={form.signUpConfirmationSent ? tr.auth.signUpConfirmationSent : tr.auth.resetSent} /> : null}
      {form.error ? <AuthNotice tone="error" text={form.error} /> : null}
      {form.busy ? (
        // Between the password field and the submit button, where nothing had
        // reserved space: its own surface and margins keep the card's rhythm.
        <View style={{ marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.surfaceAlt, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border }}>
          <OperationFlow kind={text.flow} label={text.running()} />
        </View>
      ) : null}
      {/* Before the account exists, not after: creating one is when an e-mail
          address and every later record start being processed on servers in
          another country, which reading the notice afterwards cannot undo. */}
      {mode === "signUp" ? (
        <>
          <Body muted style={{ marginBottom: spacing.sm, fontSize: type.small.fontSize }}>{tr.legal.signUpNotice}</Body>
          <LegalConsentControl consented={form.consented} onOpen={onOpenNotice} invalid={form.consentRefused && !form.consented} />
        </>
      ) : null}
      <Button label={primaryLabel} onPress={form.pressPrimary} disabled={!form.formReady} />
      {/* The quiet actions, STACKED and each a whole sentence: side by side they
          read as one run-on line. Every link carries the 44pt target, which is
          the spacing. The notice is not offered here: signing in or repairing a
          password starts no processing an account creation would. */}
      <View style={{ alignItems: "center", marginTop: spacing.sm }}>
        {mode === "signIn" ? <AuthLink label={tr.auth.forgotPassword} onPress={form.showForgot} /> : null}
        <AuthLink label={text.other()} onPress={form.switchMode} disabled={form.busy} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, justifyContent: "center", marginTop: spacing.sm }}>
        <CloudOff accessible={false} size={14} color={palette.textSecondary} />
        <Text style={[type.small, { color: palette.textSecondary, textAlign: "center", flexShrink: 1 }]}>
          {isSupabaseConfigured ? tr.auth.offlineNote : tr.settings.syncUnconfiguredHint}
        </Text>
      </View>
    </Card>
  );
}

export default function SignInScreen() {
  const form = useAuthForm();
  const [noticeOpen, setNoticeOpen] = useState(false);
  const { palette } = useTheme();
  const wide = shouldSplitAuthHero(useContentWidth());
  useSubmitOnEnter(() => void form.submit(), form.canSubmit);
  return (
    <Screen scroll width="form">
      {/* Top-aligned, not centred: centring re-laid the whole column on every
          change in the form's height, so the brand mark drifted on each mode
          switch. Anchoring the top leaves only the card's bottom edge moving. */}
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
        {/* ONE header: the mark leads the greeting and one sentence supports it.
            `stretch` gives a child its full WIDTH in the column layout and its
            full HEIGHT in the row one, so it follows the direction. */}
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
          <Body muted style={{ marginBottom: spacing.lg, maxWidth: 470, lineHeight: 22 }}>{tr.auth.welcomeBody}</Body>
          {/* Decoration, and the first thing to go when the form grows: a phone
              has to reach the submit button without scrolling. */}
          {wide || form.mode === "signIn" ? <AuthJourneyArtwork compact={!wide} /> : null}
        </View>
        <AuthFormCard form={form} wide={wide} onOpenNotice={() => setNoticeOpen(true)} />
      </View>
      {/* Opened rather than navigated to: a push would cost a half-typed form. */}
      {noticeOpen ? (
        <LegalNoticeSheet
          onClose={() => setNoticeOpen(false)}
          // Only sign-up can accept; opened from anywhere else it is a document to read.
          onAccept={form.mode === "signUp" ? () => {
            form.accept();
            setNoticeOpen(false);
          } : undefined}
        />
      ) : null}
    </Screen>
  );
}
