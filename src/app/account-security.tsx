/**
 * Account security modal: change the sign-in e-mail or password, or reset it with an e-mailed code. A change
 * requires the current password (re-authentication), matching the delete/freeze gate; an e-mailed code is
 * asked for in the card that sent it, not in a dialog over it.
 */

import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import KeyRound from "lucide-react-native/icons/key-round";
import Mail from "lucide-react-native/icons/mail";
import Eraser from "lucide-react-native/icons/eraser";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import Snowflake from "lucide-react-native/icons/snowflake";
import Trash from "lucide-react-native/icons/trash";
import { useSession, type EmailChangeCodes } from "../auth/session";
import { performAccountFreeze, type AccountFreezePhase } from "../auth/freeze";
import { useUserId } from "../data/hooks";
import { pendingSyncChangeCount, setAccountFrozen } from "../data/repo";
import { tr } from "../i18n/tr";
import { Body, Button, Card, Divider, Field, ListRow, PanelHeader, Screen } from "../ui/components";
import { appAlert, appConfirm, confirmWithPassword } from "../ui/dialog";
import { density, spacing, type, useTheme } from "../ui/theme";
import { navigateBack } from "../ui/navigation";
import { useOperationGuard } from "../ui/operation-guard";
import { useDirtyExitGuard } from "../ui/dirty-exit";
import { scheduleSync, syncNow } from "../sync/engine";
import { isSupabaseConfigured } from "../sync/supabase";
import { WorkspaceGrid } from "../ui/workspace-layout";
import { OperationFlow } from "../ui/operation-flow";
import { clearLifecycleIntent, setLifecycleIntent, useAccountDeletion } from "../ui/lifecycle-intent";
import { DelayedLoadingIndicator } from "../ui/loading-indicator";
import { isValidNewPassword } from "../domain/input";

export default function AccountSecurityScreen() {
  // Account freeze promises a cloud-confirmed write followed by sign-out. A
  // local-only workspace cannot honor either promise, so it has no security
  // action surface and direct links return to the honest local settings page.
  if (!isSupabaseConfigured) return <Redirect href="/(tabs)/settings" />;
  return <CloudAccountSecurityScreen />;
}

function CloudAccountSecurityScreen() {
  const { email, verifyPassword, changePassword, signOut } = useSession();
  const userId = useUserId();
  const router = useRouter();
  const operationGuard = useOperationGuard();
  const { palette } = useTheme();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [freezing, setFreezing] = useState(false);
  const [freezePhase, setFreezePhase] = useState<AccountFreezePhase | null>(null);
  const { deleting, deleteAccount: handleDeleteAccount } = useAccountDeletion(() =>
    confirmWithPassword(verifyPassword, { body: tr.account.deletePasswordBody, confirmLabel: tr.account.deleteConfirm, operation: "delete" }));
  const [cardDrafts, setCardDrafts] = useState({ email: false, reset: false });
  const draftIn = (card: keyof typeof cardDrafts) => (dirty: boolean) => setCardDrafts((held) => (held[card] === dirty ? held : { ...held, [card]: dirty }));
  const { allowExit } = useDirtyExitGuard(Boolean(currentPassword || newPassword) || cardDrafts.email || cardDrafts.reset);

  const submitPassword = async () => {
    if (currentPassword.length < 6 || !isValidNewPassword(newPassword)) return;
    try {
      await operationGuard.run(async () => {
        setPwBusy(true);
        try {
          const verifyError = await verifyPassword(currentPassword);
          if (verifyError) {
            void appAlert(verifyError, tr.errors.title);
            return;
          }
          const err = await changePassword(currentPassword, newPassword);
          if (err) {
            void appAlert(err, tr.errors.title);
            return;
          }
          setCurrentPassword("");
          setNewPassword("");
          void appAlert(tr.account.passwordChanged);
          allowExit(() => navigateBack(router, "/(tabs)/settings"));
        } finally {
          setPwBusy(false);
        }
      });
    } catch {
      void appAlert(tr.errors.requestFailed, tr.errors.title);
    }
  };


  // Confirmation and re-authentication run inside the guard, so a second press cannot arm a second freeze while the first still asks for the password.
  const freezeAccount = () =>
    operationGuard.run(async () => {
      const accepted = await appConfirm(tr.account.freezeConfirmTitle, tr.account.freezeConfirmBody, {
        confirmLabel: tr.account.freezeConfirm,
        danger: true,
        operation: "freeze",
      });
      if (!accepted) return;
      if (!(await confirmWithPassword(verifyPassword, { body: tr.account.freezePasswordBody, confirmLabel: tr.account.freezeConfirm, operation: "freeze" }))) return;

      setLifecycleIntent("freeze");
      setFreezing(true);
      useSession.setState({ isFreezing: true });
      try {
        const outcome = await performAccountFreeze({
          setFrozen: (frozen) => setAccountFrozen(userId, frozen),
          syncNow: () => syncNow(userId),
          pendingOutboxCount: pendingSyncChangeCount,
          signOut,
          scheduleSync: () => scheduleSync(userId),
          onPhase: setFreezePhase,
        });
        if (outcome.status === "failed") {
          // A failure that could not even be rolled back leaves the account
          // marked frozen locally, so it gets its own honest message instead of
          // the reassuring "nothing was frozen" one.
          const message = !outcome.rolledBack
            ? tr.account.freezeRollbackFailed
            : outcome.reason === "sync"
              ? tr.account.freezeSyncFailed
              : (outcome.message ?? tr.account.freezeSyncFailed);
          clearLifecycleIntent();
          void appAlert(message, tr.errors.title);
        }
      } finally {
        // Both flags always release. `isFreezing` suppresses the reactivation
        // gate, so leaving it set after a failure hides the one screen that
        // could explain the state. A successful freeze has already signed out.
        useSession.setState({ isFreezing: false });
        setFreezing(false);
        setFreezePhase(null);
        // The intent survives a successful freeze: the app is signing out and
        // the waiting screen has to say so. The failure path above clears it.
      }
    }).catch(() => {
      void appAlert(tr.errors.requestFailed, tr.errors.title);
    });

  return (
    <Screen width="workspace">
      <WorkspaceGrid testID="account-security-grid" layout="stack">
      <EmailChangeCard email={email} guard={operationGuard} onDraft={draftIn("email")} />

      <Card>
        <PanelHeader icon={KeyRound} title={tr.account.changePassword} description={tr.account.changePasswordSectionHint} />
        <Field
          label={tr.account.currentPassword}
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secure
          autoComplete="current-password"
          textContentType="password"
          placeholder={tr.account.currentPasswordPlaceholder}
        />
        <Field
          label={tr.account.newPassword}
          value={newPassword}
          onChangeText={setNewPassword}
          secure
          autoComplete="new-password"
          textContentType="newPassword"
          placeholder={tr.account.newPasswordPlaceholder}
          error={newPassword.length > 0 && !isValidNewPassword(newPassword) ? tr.auth.passwordMin : null}
        />
        <Button
          label={tr.account.changePassword}
          onPress={() => void submitPassword()}
          loading={pwBusy}
          disabled={currentPassword.length < 6 || !isValidNewPassword(newPassword)}
        />
      </Card>

      <ResetCard email={email} guard={operationGuard} onDraft={draftIn("reset")} />

      {/* Erasing records, above the two ways an account ends: the same kind of
          decision at a smaller scale, and the one a person reaches for first
          when what they actually want is a clean table rather than no account.
          Keeping it here means every irreversible choice is on one screen. */}
      {/* `rows`: the row IS the card here, so the card's own vertical padding
          would sit outside its pressable and the hover would light a band
          narrower than the box it lives in. */}
      <Card rows>
        <View testID="account-data-reset-action">
          <ListRow
            icon={Eraser}
            title={tr.dataReset.title}
            subtitle={tr.dataReset.entryDescription}
            chevron
            onPress={() => router.push("/data-reset")}
          />
        </View>
      </Card>

      {/* The two ways an account ends, in order of severity. */}
      <Card rows>
        <View testID="account-freeze-action">
          <ListRow
            icon={Snowflake}
            title={tr.account.freeze}
            subtitle={tr.account.freezeSignatureDescription}
            chevron={!freezing}
            right={freezing ? <DelayedLoadingIndicator size={7} label={tr.account.freeze} /> : undefined}
            onPress={freezing ? undefined : () => void freezeAccount()}
          />
        </View>
        {freezePhase ? (
          <View style={{ paddingBottom: density.list.cardPadding }}>
            <OperationFlow kind="freeze" label={tr.operation.freezePhase[freezePhase]} />
          </View>
        ) : null}
        <Divider flush />
        <View testID="account-delete-action">
          <ListRow
            icon={Trash}
            iconColor={palette.destructive}
            title={tr.account.delete}
            subtitle={tr.account.deleteSignatureDescription}
            chevron={!deleting}
            right={deleting ? <DelayedLoadingIndicator size={7} label={tr.account.delete} /> : undefined}
            onPress={deleting ? undefined : () => void handleDeleteAccount()}
          />
        </View>
        {deleting ? (
          <View style={{ paddingBottom: density.list.cardPadding }}>
            <OperationFlow kind="delete" label={tr.operation.deletingAccount} />
          </View>
        ) : null}
      </Card>
      </WorkspaceGrid>
    </Screen>
  );
}

type CardProps = { email: string | null; guard: ReturnType<typeof useOperationGuard>; onDraft: (dirty: boolean) => void };

const NO_CODES: EmailChangeCodes = { current: "", next: "" };
const NONE_ACCEPTED = { current: false, next: false } as const;
const CODE_LENGTH = 6;
const codeComplete = (code: string) => code.length === CODE_LENGTH;
const digits = (typed: string) => typed.replace(/\D/g, "").slice(0, CODE_LENGTH);
const CODE_FIELD = {
  keyboardType: "number-pad",
  autoComplete: "one-time-code",
  textContentType: "oneTimeCode",
  maxLength: CODE_LENGTH,
  placeholder: "••••••",
} as const;

/** One request of a card at a time, under the screen's gate; a throw reads as a failed request. */
function useCardRequest(guard: CardProps["guard"]) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = (which: string, work: () => Promise<void>) => async () => {
    try {
      await guard.run(async () => {
        setBusy(which);
        try {
          await work();
        } finally {
          setBusy(null);
        }
      });
    } catch {
      void appAlert(tr.errors.requestFailed, tr.errors.title);
    }
  };
  return { busy, run };
}

/** The new address and the password, then the code each address was sent. */
function EmailChangeCard({ email, guard, onDraft }: CardProps) {
  const { verifyPassword, changeEmail, confirmEmailChange } = useSession();
  const { busy, run } = useCardRequest(guard);
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  /** The address the change codes went to; the card then asks for them. */
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [codes, setCodes] = useState<EmailChangeCodes>(NO_CODES);
  const [accepted, setAccepted] = useState<Record<keyof EmailChangeCodes, boolean>>(NONE_ACCEPTED);
  const dirty = Boolean(newEmail || emailPassword || codes.current || codes.next);
  useEffect(() => onDraft(dirty), [dirty, onDraft]);

  const emailValid = /.+@.+\..+/.test(newEmail.trim());
  const submitEmail = run("request", async () => {
    if (!emailValid || emailPassword.length < 6) return;
    // Auth takes the current address as a change and sends no code at all.
    if (newEmail.trim().toLowerCase() === email?.toLowerCase()) return void appAlert(tr.account.sameEmail, tr.errors.title);
    const refused = (await verifyPassword(emailPassword)) ?? (await changeEmail(newEmail.trim()));
    if (refused) return void appAlert(refused, tr.errors.title);
    setPendingEmail(newEmail.trim());
    setCodes(NO_CODES);
    setAccepted(NONE_ACCEPTED);
    setNewEmail("");
    setEmailPassword("");
  });
  /** New codes replace the old ones, so the ones already typed and taken start over. */
  const resendCodes = run("request", async () => {
    if (!pendingEmail) return;
    const refused = await changeEmail(pendingEmail);
    if (refused) return void appAlert(refused, tr.errors.title);
    setCodes(NO_CODES);
    setAccepted(NONE_ACCEPTED);
    void appAlert(tr.account.codesResent);
  });
  const codesReady = (typed: EmailChangeCodes) => (["current", "next"] as const).every((side) => accepted[side] || codeComplete(typed[side]));
  const confirmCodes = (typed: EmailChangeCodes) =>
    run("confirm", async () => {
      if (!pendingEmail || !codesReady(typed)) return;
      const answer = await confirmEmailChange(pendingEmail, typed);
      setAccepted(answer.accepted);
      if (answer.error) return void appAlert(answer.error, tr.errors.title);
      setPendingEmail(null);
      setCodes(NO_CODES);
      void appAlert(tr.account.emailChanged(pendingEmail));
    })();
  /** The last digit typed sends both codes, as the sign-up code does. */
  const typeCode = (side: keyof EmailChangeCodes) => (typed: string) => {
    const next = { ...codes, [side]: digits(typed) };
    setCodes(next);
    if (codeComplete(next[side]) && !busy && codesReady(next)) void confirmCodes(next);
  };
  const cancel = () => {
    setPendingEmail(null);
    setCodes(NO_CODES);
    setAccepted(NONE_ACCEPTED);
  };

  return (
    <Card>
      <PanelHeader icon={Mail} title={tr.account.changeEmail} description={pendingEmail && email ? tr.account.emailChangeSent(email, pendingEmail) : tr.account.changeEmailSectionHint} />
      {pendingEmail && email ? (
        <>
          {([["current", email], ["next", pendingEmail]] as const).map(([side, address], index) =>
            accepted[side] ? (
              <Body key={side} muted style={{ marginBottom: spacing.md }}>{tr.account.emailCodeAccepted(address)}</Body>
            ) : (
              <Field key={side} label={tr.account.emailCodeFor(address)} value={codes[side]} onChangeText={typeCode(side)} {...CODE_FIELD} autoFocus={index === 0} />
            ),
          )}
          <Button label={tr.account.confirmEmailChange} onPress={() => void confirmCodes(codes)} loading={busy === "confirm"} disabled={!codesReady(codes) || busy != null} />
          <CardLinks>
            <Button label={tr.account.resendCodes} variant="ghost" onPress={() => void resendCodes()} loading={busy === "request"} disabled={busy != null} />
            <Button label={tr.common.cancel} variant="ghost" onPress={cancel} disabled={busy != null} />
          </CardLinks>
        </>
      ) : (
        <>
          {email ? <Body muted style={{ marginBottom: spacing.md }}>{tr.account.currentEmail(email)}</Body> : null}
          <Field
            label={tr.account.newEmail}
            value={newEmail}
            onChangeText={setNewEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            placeholder={tr.placeholders.email}
          />
          <Field
            label={tr.auth.password}
            value={emailPassword}
            onChangeText={setEmailPassword}
            secure
            autoComplete="current-password"
            textContentType="password"
            placeholder={tr.account.currentPasswordPlaceholder}
          />
          <Button label={tr.account.changeEmail} onPress={() => void submitEmail()} loading={busy === "request"} disabled={!emailValid || emailPassword.length < 6 || busy != null} />
          <Body muted style={{ fontSize: type.small.fontSize, marginTop: spacing.sm }}>{tr.account.emailChangeHint}</Body>
        </>
      )}
    </Card>
  );
}

/** A code to the account's own address, then the code and a new password in the same card. */
function ResetCard({ email, guard, onDraft }: CardProps) {
  const { requestPasswordReset, resetPassword } = useSession();
  const { busy, run } = useCardRequest(guard);
  /** Set once the code is mailed: the card then asks for it and the new password. */
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const dirty = Boolean(code || password);
  useEffect(() => onDraft(dirty), [dirty, onDraft]);

  const sendCode = run("send", async () => {
    if (!email) return;
    const error = await requestPasswordReset(email);
    if (error) return void appAlert(error, tr.errors.title);
    if (sent) void appAlert(tr.auth.codeResent);
    setSent(true);
  });
  const ready = codeComplete(code) && isValidNewPassword(password);
  const cancel = () => {
    setSent(false);
    setCode("");
    setPassword("");
  };
  const save = run("save", async () => {
    if (!email || !ready) return;
    const error = await resetPassword(email, code, password);
    if (error) return void appAlert(error, tr.errors.title);
    cancel();
    void appAlert(tr.account.passwordChanged);
  });

  return (
    <Card>
      <PanelHeader icon={RotateCcw} title={tr.auth.forgotPassword} description={sent && email ? tr.auth.resetSentToOwnAddress(email) : tr.account.resetCodeHint} />
      {sent ? (
        <>
          <Field label={tr.auth.code} value={code} onChangeText={(typed) => setCode(digits(typed))} {...CODE_FIELD} autoFocus />
          <Field
            label={tr.account.newPassword}
            value={password}
            onChangeText={setPassword}
            secure
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder={tr.account.newPasswordPlaceholder}
            error={password.length > 0 && !isValidNewPassword(password) ? tr.auth.passwordMin : null}
          />
          <Button label={tr.account.changePassword} onPress={() => void save()} loading={busy === "save"} disabled={!ready || busy != null} />
          <CardLinks>
            <Button label={tr.account.resendResetCode} variant="ghost" onPress={() => void sendCode()} loading={busy === "send"} disabled={busy != null} />
            <Button label={tr.common.cancel} variant="ghost" onPress={cancel} disabled={busy != null} />
          </CardLinks>
        </>
      ) : (
        <Button label={tr.auth.sendResetCode} variant="secondary" onPress={() => void sendCode()} loading={busy === "send"} disabled={!email || busy != null} />
      )}
    </Card>
  );
}

/** A card's second actions, side by side under its first. */
function CardLinks({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm, marginTop: spacing.sm }}>{children}</View>;
}
