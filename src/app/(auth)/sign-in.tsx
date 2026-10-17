import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import BellRing from "lucide-react-native/icons/bell-ring";
import CloudOff from "lucide-react-native/icons/cloud-off";
import Table2 from "lucide-react-native/icons/table-2";
import WalletCards from "lucide-react-native/icons/wallet-cards";
import type { LucideIcon } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useSession } from "../../auth/session";
import { LegalConsentControl, LegalNoticeSheet } from "../../ui/legal-notice";
import { isSupabaseConfigured } from "../../sync/supabase";
import { AuthNotice } from "../../ui/auth-notice";
import { Body, Button, Card, Field, Screen } from "../../ui/components";
import { useSubmitOnEnter } from "../../ui/keyboard";
import { clearLifecycleIntent } from "../../ui/lifecycle-intent";
import { BrandMark } from "../../ui/brand";
import { interactionSurface } from "../../ui/interaction";
import { controlSize, font, maxFontScale, radius, spacing, stateOpacity, type, useTheme } from "../../ui/theme";
import { tr } from "../../i18n/tr";
import { useOperationGuard } from "../../ui/operation-guard";
import { OperationFlow } from "../../ui/operation-flow";
import { isEmail, isValidNewPassword } from "../../domain/input";
import { shouldSplitAuthHero } from "../../ui/responsive";
import { useContentWidth } from "../../ui/viewport";

function JourneyNode({
  icon: Icon,
  label,
  active,
}: {
  icon: LucideIcon;
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
        // Beside a disc that does not scale, the label's column is a third of the card; at the largest accessibility sizes iOS broke words mid-word.
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
  const tones = [palette.primary, palette.secondary, palette.tertiary];
  const connector = <View style={{ flex: 0.52, height: 1, backgroundColor: palette.border, marginTop: 23 }} />;
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
        {connector}
        <JourneyNode icon={Table2} label={tr.auth.journeyLedger} />
        {connector}
        <JourneyNode icon={BellRing} label={tr.auth.journeyTrack} />
      </View>
      {!compact ? (
        <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
          {[0.72, 0.48, 0.86].map((value, index) => (
            <View key={value} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tones[index] }} />
              <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: palette.surfaceStrong + "80" }}>
                <View style={{ width: `${value * 100}%`, height: 6, borderRadius: 3, backgroundColor: tones[index] }} />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Inline links, not stacked ghost buttons, so the form stays above the fold on a phone; `minHeight` keeps the 44pt target. */
function AuthLink({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
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

type AuthMode = "signIn" | "signUp" | "forgot" | "confirm" | "reset";

const CODE_LENGTH = 6;
const CODE_PATTERN = new RegExp(`^\\d{${CODE_LENGTH}}$`);

/** What each mode says, which fields it asks for, and how its operation is shown. */
const MODE: Record<AuthMode, {
  heading: string;
  subtitle: (email: string) => string;
  running: string;
  flow: "sign-in" | "sign-up" | "reset";
  other: string;
  /** Confirm and reset already know the address: it is in the subtitle. */
  email: boolean;
  code: boolean;
  password: "current" | "new" | null;
}> = {
  signIn: {
    heading: tr.auth.signInHeading, subtitle: () => tr.auth.signInSubtitle, running: tr.operation.signingIn, flow: "sign-in",
    // Every mode its own sentence: the reset screen gets its own way back
    // rather than one that describes a different reader.
    other: tr.auth.createAccountAction, email: true, code: false, password: "current",
  },
  signUp: {
    heading: tr.auth.signUpTitle, subtitle: () => tr.auth.signUpSubtitle, running: tr.operation.creatingAccount, flow: "sign-up",
    other: tr.auth.backToSignInAction, email: true, code: false, password: "new",
  },
  forgot: {
    heading: tr.auth.forgotTitle, subtitle: () => tr.auth.forgotSubtitle, running: tr.operation.requestingReset, flow: "reset",
    other: tr.auth.backToSignIn, email: true, code: false, password: null,
  },
  confirm: {
    heading: tr.auth.confirmTitle, subtitle: tr.auth.confirmSubtitle, running: tr.operation.signingIn, flow: "sign-in",
    other: tr.auth.backToSignIn, email: false, code: true, password: null,
  },
  reset: {
    heading: tr.auth.resetTitle, subtitle: tr.auth.resetSubtitle, running: tr.operation.resettingPassword, flow: "reset",
    other: tr.auth.backToSignIn, email: false, code: true, password: "new",
  },
};

function useAuthForm() {
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [codeResent, setCodeResent] = useState(false);
  const [consented, setConsented] = useState(false);
  /** Only true after a refused submit: the form does not scold while it is being filled. */
  const [consentRefused, setConsentRefused] = useState(false);
  const { signIn, signUp, requestPasswordReset, resendSignUpConfirmation, confirmSignUp, resetPassword } = useSession();
  const operationGuard = useOperationGuard();

  const text = MODE[mode];
  const emailValid = isEmail(email);
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
  const readyWith = (typedCode: string) =>
    emailValid
    && (text.password === null || (text.password === "new" ? isValidNewPassword(password) : password.length >= 6))
    && (!text.code || CODE_PATTERN.test(typedCode))
    && !busy;
  const formReady = readyWith(code);
  const canSubmit = formReady && (mode !== "signUp" || consented);

  /** Whatever the last attempt said, and a consent given on another form. */
  const clearFeedback = () => {
    setError(null);
    setCodeResent(false);
    // Consent belongs to the attempt that was made, not to the session.
    setConsented(false);
    setConsentRefused(false);
  };

  /** A mode the e-mail's code is typed into, starting from an empty code. */
  const awaitCode = (next: "confirm" | "reset") => {
    setCode("");
    if (next === "reset") setPassword("");
    setMode(next);
  };

  /** The request `mode` makes, and the error it answered with, if any. */
  const request = async (typedCode: string): Promise<string | null> => {
    const address = email.trim();
    if (mode === "signIn") {
      const err = await signIn(address, password);
      if (err !== tr.auth.errEmailNotConfirmed) return err;
      // The account waits on its code: mail a fresh one and ask for it here. A
      // resend refused for coming too soon leaves the code already mailed to type.
      const resent = await resendSignUpConfirmation(address);
      if (resent && resent !== tr.auth.errRateLimit) return resent;
      awaitCode("confirm");
      return null;
    }
    if (mode === "forgot") {
      const err = await requestPasswordReset(address);
      if (!err) awaitCode("reset");
      return err;
    }
    if (mode === "confirm") return confirmSignUp(address, typedCode);
    if (mode === "reset") return (await resetPassword(address, typedCode, password)) ?? signIn(address, password);
    const result = await signUp(address, password);
    if (result.status === "confirmation-required") awaitCode("confirm");
    return result.status === "error" ? result.message : null;
  };

  const submit = async (typedCode = code) => {
    if (!readyWith(typedCode) || (mode === "signUp" && !consented)) return;
    // A lifecycle intent outlives the operation that set it — it is what the
    // waiting screen reads while a session tears down. Starting a new session
    // is what ends it; otherwise the first pull after signing back in would
    // still announce the sign-out that came before it.
    clearLifecycleIntent();
    await operationGuard.run(async () => {
      setBusy(true);
      setError(null);
      setCodeResent(false);
      try {
        // The root route guard navigates on success; replacing to "/" here made the guard's redirect loop.
        const err = await request(typedCode);
        if (err) setError(err);
      } catch {
        setError(tr.errors.requestFailed);
      } finally {
        setBusy(false);
      }
    });
  };

  /** Offered wherever a code is what stands between this person and their account. */
  const canResend = isSupabaseConfigured && emailValid && !busy && !resending && text.code;

  const resend = async () => {
    setResending(true);
    setError(null);
    setCodeResent(false);
    try {
      const address = email.trim();
      const err = mode === "reset" ? await requestPasswordReset(address) : await resendSignUpConfirmation(address);
      if (err) setError(err);
      else setCodeResent(true);
    } catch {
      setError(tr.errors.requestFailed);
    } finally {
      setResending(false);
    }
  };

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setError(null);
  };

  return {
    mode, text, email, password, code, error, busy, codeResent, canResend, resend, consented, consentRefused, emailValid, formReady, canSubmit, submit,
    setEmail: edit(setEmail),
    setPassword: edit(setPassword),
    /** A whole code on the confirm screen is the whole form: it is sent as it lands, autofill included. */
    typeCode: (value: string) => {
      const digits = value.replace(/\D/g, "").slice(0, CODE_LENGTH);
      setCode(digits);
      setError(null);
      if (mode === "confirm" && CODE_PATTERN.test(digits)) void submit(digits);
    },
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

const PRIMARY_LABEL: Record<AuthMode, string> = {
  signIn: tr.auth.signIn,
  signUp: tr.auth.signUpTitle,
  forgot: tr.auth.sendResetCode,
  confirm: tr.auth.confirmAction,
  reset: tr.auth.resetSave,
};

function AuthFormCard({ form, wide, onOpenNotice }: { form: AuthForm; wide: boolean; onOpenNotice: () => void }) {
  const { palette } = useTheme();
  const router = useRouter();
  const { mode, text } = form;
  return (
    // One skeleton for every mode — heading, subtitle, fields, actions — with
    // the same gaps, so switching modes does not redraw a different card.
    <Card style={{ flex: wide ? 0.92 : undefined, alignSelf: wide ? "flex-start" : "stretch", marginBottom: 0, padding: wide ? spacing.xl : spacing.lg }}>
      <Text accessibilityRole="header" style={[type.heading, { color: palette.text, marginBottom: spacing.xs }]}>{text.heading}</Text>
      <Body muted style={{ marginBottom: spacing.lg }}>{text.subtitle(form.email.trim())}</Body>
      {text.email ? (
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
      ) : null}
      {text.code ? (
        <Field
          key={mode}
          label={tr.auth.code}
          value={form.code}
          onChangeText={form.typeCode}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="number-pad"
          // iOS offers a code from Mail above the keyboard; Android's autofill
          // reads this as `sms-otp` and offers what its service found.
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={CODE_LENGTH}
          placeholder="••••••"
          returnKeyType={text.password ? "next" : "go"}
          onSubmitEditing={text.password ? undefined : () => void form.submit()}
        />
      ) : null}
      {text.password ? (
        <Field
          label={mode === "reset" ? tr.auth.newPassword : tr.auth.password}
          value={form.password}
          onChangeText={form.setPassword}
          secure
          autoComplete={text.password === "current" ? "current-password" : "new-password"}
          textContentType={text.password === "current" ? "password" : "newPassword"}
          returnKeyType="go"
          onSubmitEditing={() => void form.submit()}
          error={text.password === "new" && form.password.length > 0 && !isValidNewPassword(form.password) ? tr.auth.passwordMin : null}
        />
      ) : null}
      {form.codeResent ? <AuthNotice tone="success" text={tr.auth.codeResent} /> : null}
      {form.error ? <AuthNotice tone="error" text={form.error} /> : null}
      {form.busy ? (
        // Between the last field and the submit button, where nothing had
        // reserved space: its own surface and margins keep the card's rhythm.
        <View style={{ marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.surfaceAlt, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border }}>
          <OperationFlow kind={text.flow} label={text.running} />
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
      <Button label={PRIMARY_LABEL[mode]} onPress={form.pressPrimary} disabled={!form.formReady} />
      {/* The quiet actions, STACKED and each a whole sentence: side by side they
          read as one run-on line. Every link carries the 44pt target, which is
          the spacing. The notice is not offered here: signing in or repairing a
          password starts no processing an account creation would. */}
      <View style={{ alignItems: "center", marginTop: spacing.sm }}>
        {/* Under a failure, which may be ours: the report needs no account. */}
        {form.error ? <AuthLink label={tr.auth.reportProblem} onPress={() => router.push({ pathname: "/feedback", params: { email: form.email.trim() } })} /> : null}
        {form.canResend ? <AuthLink label={tr.auth.resendCode} onPress={() => void form.resend()} /> : null}
        {mode === "signIn" ? <AuthLink label={tr.auth.forgotPassword} onPress={form.showForgot} /> : null}
        <AuthLink label={text.other} onPress={form.switchMode} disabled={form.busy} />
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
            <BrandMark height={wide ? 48 : 40} />
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
