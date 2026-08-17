'use client';

import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
} from '@headlessui/react';
import {
  ArrowDownTrayIcon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
  FingerPrintIcon,
  KeyIcon,
  LifebuoyIcon,
  ShieldCheckIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { startAuthentication, startRegistration } from 'simplewebauthn-browser';

import {
  beginPasskeyRegistration,
  beginPasskeyStepUp,
  finishPasskeyRegistration,
  finishPasskeyStepUp,
  removePasskey,
} from '@/app/lib/actions/passkeys';
import {
  beginPasskeyRecoveryRegistration,
  redeemPrivilegedRecoveryCode,
  regeneratePrivilegedRecoveryCodes,
} from '@/app/lib/actions/recovery-codes';
import type { PasskeySummary } from '@/app/lib/auth/passkeys';
import type {
  RecoveryCodeSummary,
  RecoveryGrantSummary,
} from '@/app/lib/auth/recovery-codes';
import { RECENT_MFA_WINDOW_SECONDS } from '@/app/lib/auth/session-policy';

type PasskeySecurityPanelProps = {
  isPrivileged: boolean;
  isRecentlyVerified: boolean;
  mfaVerifiedAt: number | null;
  passkeys: PasskeySummary[];
  recoveryCodeSummary: RecoveryCodeSummary | null;
  recoveryGrant: RecoveryGrantSummary | null;
  returnTo?: string;
};

function getCeremonyMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'The passkey prompt was canceled or timed out. Nothing was changed.';
    }
    if (error.name === 'InvalidStateError') {
      return 'That passkey is already connected to this account.';
    }
    if (error.name === 'NotSupportedError') {
      return 'This browser or device does not support that passkey method.';
    }
  }

  return 'The passkey ceremony could not be completed. Please try again.';
}

function formatDate(value: string | null) {
  if (!value) return 'Not used yet';

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function PasskeySecurityPanel({
  isPrivileged,
  isRecentlyVerified,
  mfaVerifiedAt,
  passkeys,
  recoveryCodeSummary,
  recoveryGrant,
  returnTo,
}: PasskeySecurityPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('Primary passkey');
  const [message, setMessage] = useState<string>();
  const [messageTone, setMessageTone] = useState<'error' | 'success'>(
    'success',
  );
  const [localMfaVerifiedAt, setLocalMfaVerifiedAt] = useState<number | null>(
    null,
  );
  const [expiredMfaVerifiedAt, setExpiredMfaVerifiedAt] = useState<
    number | null
  >(null);
  const [passkeyToRemove, setPasskeyToRemove] = useState<PasskeySummary | null>(
    null,
  );
  const [removalPassword, setRemovalPassword] = useState('');
  const [removalError, setRemovalError] = useState<string>();
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [activeRecoveryGrant, setActiveRecoveryGrant] =
    useState<RecoveryGrantSummary | null>(recoveryGrant);
  const [expiredRecoveryGrantId, setExpiredRecoveryGrantId] = useState<
    string | null
  >(null);
  const [localRecoverySummary, setLocalRecoverySummary] =
    useState<RecoveryCodeSummary | null>(recoveryCodeSummary);
  const [generatedRecoveryCodes, setGeneratedRecoveryCodes] = useState<
    string[] | null
  >(null);
  const [recoveryDialogOpen, setRecoveryDialogOpen] = useState(false);
  const [replaceCodesDialogOpen, setReplaceCodesDialogOpen] = useState(false);
  const [regenerationPassword, setRegenerationPassword] = useState('');
  const [recoverySaveStatus, setRecoverySaveStatus] = useState<string>();
  const effectiveMfaVerifiedAt = Math.max(
    mfaVerifiedAt ?? 0,
    localMfaVerifiedAt ?? 0,
  );
  const hasRecentVerification =
    (isRecentlyVerified || localMfaVerifiedAt !== null) &&
    effectiveMfaVerifiedAt > 0 &&
    expiredMfaVerifiedAt !== effectiveMfaVerifiedAt;
  const hasActiveRecoveryGrant =
    activeRecoveryGrant !== null &&
    activeRecoveryGrant.grantId !== expiredRecoveryGrantId;
  const needsExistingPasskeyVerification =
    isPrivileged &&
    passkeys.length > 0 &&
    !hasRecentVerification &&
    !hasActiveRecoveryGrant;
  const supportsPasskeys =
    typeof window !== 'undefined' && 'PublicKeyCredential' in window;

  useEffect(() => {
    if (!hasRecentVerification) return;

    const expiresAt =
      effectiveMfaVerifiedAt * 1_000 + RECENT_MFA_WINDOW_SECONDS * 1_000;
    const remainingMilliseconds = expiresAt - Date.now();

    const timeout = window.setTimeout(
      () => setExpiredMfaVerifiedAt(effectiveMfaVerifiedAt),
      Math.max(0, remainingMilliseconds) + 50,
    );

    return () => window.clearTimeout(timeout);
  }, [effectiveMfaVerifiedAt, hasRecentVerification]);

  useEffect(() => {
    if (!activeRecoveryGrant || !hasActiveRecoveryGrant) return;

    const remainingMilliseconds =
      new Date(activeRecoveryGrant.expiresAt).getTime() - Date.now();
    const timeout = window.setTimeout(
      () => setExpiredRecoveryGrantId(activeRecoveryGrant.grantId),
      Math.max(0, remainingMilliseconds) + 50,
    );

    return () => window.clearTimeout(timeout);
  }, [activeRecoveryGrant, hasActiveRecoveryGrant]);

  function report(tone: 'error' | 'success', nextMessage: string) {
    setMessageTone(tone);
    setMessage(nextMessage);
  }

  function markRecentlyVerified() {
    setLocalMfaVerifiedAt(Math.floor(Date.now() / 1_000));
  }

  function requestPasskeyRemoval(passkey: PasskeySummary) {
    if (isPrivileged && passkeys.length <= 1) {
      report(
        'error',
        'Add another passkey before removing the final credential on this protected account.',
      );
      return;
    }

    if (isPrivileged && !hasRecentVerification) {
      report(
        'error',
        'Verify with a passkey before removing a credential from this protected account.',
      );
      return;
    }

    setRemovalError(undefined);
    setRemovalPassword('');
    setPasskeyToRemove(passkey);
  }

  function closeRemovalDialog() {
    if (isPending) return;
    setPasskeyToRemove(null);
    setRemovalError(undefined);
    setRemovalPassword('');
  }

  function confirmPasskeyRemoval() {
    if (!passkeyToRemove) return;

    startTransition(async () => {
      setRemovalError(undefined);
      const result = await removePasskey(
        passkeyToRemove.id,
        isPrivileged ? undefined : removalPassword,
      );

      if (result.status === 'error') {
        setRemovalError(result.message);
        return;
      }

      setExpiredMfaVerifiedAt(effectiveMfaVerifiedAt);
      setLocalMfaVerifiedAt(null);
      setPasskeyToRemove(null);
      setRemovalPassword('');
      report('success', result.message);
      router.refresh();
    });
  }

  function enrollPasskey() {
    if (!supportsPasskeys) {
      report('error', 'Passkeys are not supported in this browser.');
      return;
    }

    startTransition(async () => {
      setMessage(undefined);
      const beginning = hasActiveRecoveryGrant
        ? await beginPasskeyRecoveryRegistration()
        : await beginPasskeyRegistration(password);

      if (beginning.status === 'error') {
        report('error', beginning.message);
        return;
      }

      if (!hasActiveRecoveryGrant) setPassword('');

      try {
        const response = await startRegistration({
          optionsJSON: beginning.options,
        });
        const completion = await finishPasskeyRegistration(response, label);

        if (completion.status === 'error') {
          report('error', completion.message);
          return;
        }

        markRecentlyVerified();
        setActiveRecoveryGrant(null);
        setExpiredRecoveryGrantId(null);
        if (completion.recoveryCodes) {
          setGeneratedRecoveryCodes(completion.recoveryCodes.codes);
          setLocalRecoverySummary({
            createdAt: completion.recoveryCodes.createdAt,
            remainingCodes: completion.recoveryCodes.remainingCodes,
            totalCodes: completion.recoveryCodes.totalCodes,
          });
          setRecoverySaveStatus(undefined);
          setRecoveryDialogOpen(true);
        }
        report('success', completion.message);
        router.refresh();
      } catch (error) {
        report('error', getCeremonyMessage(error));
      }
    });
  }

  function verifyPasskey() {
    if (!supportsPasskeys) {
      report('error', 'Passkeys are not supported in this browser.');
      return;
    }

    startTransition(async () => {
      setMessage(undefined);
      const beginning = await beginPasskeyStepUp();

      if (beginning.status === 'error') {
        report('error', beginning.message);
        return;
      }

      try {
        const response = await startAuthentication({
          optionsJSON: beginning.options,
        });
        const completion = await finishPasskeyStepUp(response);

        if (completion.status === 'error') {
          report('error', completion.message);
          return;
        }

        markRecentlyVerified();
        report('success', completion.message);
        if (returnTo) {
          router.push(returnTo);
        } else {
          router.refresh();
        }
      } catch (error) {
        report('error', getCeremonyMessage(error));
      }
    });
  }

  function redeemRecoveryCode() {
    const submittedCode = recoveryCode;
    const submittedPassword = recoveryPassword;
    setRecoveryCode('');
    setRecoveryPassword('');

    startTransition(async () => {
      setMessage(undefined);
      const result = await redeemPrivilegedRecoveryCode(
        submittedCode,
        submittedPassword,
      );

      if (result.status === 'error') {
        report('error', result.message);
        return;
      }

      setActiveRecoveryGrant(result.grant);
      setExpiredRecoveryGrantId(null);
      setLocalRecoverySummary((current) =>
        current
          ? { ...current, remainingCodes: result.remainingCodes }
          : current,
      );
      report('success', result.message);
    });
  }

  function createRecoveryCodes() {
    const submittedPassword = regenerationPassword;
    setRegenerationPassword('');

    startTransition(async () => {
      setMessage(undefined);
      const result = await regeneratePrivilegedRecoveryCodes(submittedPassword);

      if (result.status === 'error') {
        report('error', result.message);
        return;
      }

      setReplaceCodesDialogOpen(false);
      setGeneratedRecoveryCodes(result.codes);
      setLocalRecoverySummary({
        createdAt: result.createdAt,
        remainingCodes: result.remainingCodes,
        totalCodes: result.totalCodes,
      });
      setRecoverySaveStatus(undefined);
      setRecoveryDialogOpen(true);
      report('success', result.message);
    });
  }

  function requestRecoveryCodeGeneration() {
    setRegenerationPassword('');
    setReplaceCodesDialogOpen(true);
  }

  async function copyRecoveryCodes() {
    if (!generatedRecoveryCodes) return;

    try {
      await navigator.clipboard.writeText(generatedRecoveryCodes.join('\n'));
      setRecoverySaveStatus('Copied to your clipboard.');
    } catch {
      setRecoverySaveStatus(
        'Clipboard access was unavailable. Download or copy the codes manually.',
      );
    }
  }

  function downloadRecoveryCodes() {
    if (!generatedRecoveryCodes) return;

    const content = [
      'Field Atlas — protected management recovery codes',
      'Each code works once. Store these somewhere private.',
      '',
      ...generatedRecoveryCodes,
      '',
      `Created ${new Date().toISOString()}`,
    ].join('\n');
    const url = URL.createObjectURL(
      new Blob([content], { type: 'text/plain;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'field-atlas-recovery-codes.txt';
    anchor.click();
    // Safari may not begin reading the object URL until after the synthetic
    // click returns. Keep it alive briefly, then release it.
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setRecoverySaveStatus('Downloaded as a text file.');
  }

  function closeRecoveryCodesDialog() {
    if (isPending) return;
    setRecoveryDialogOpen(false);
    setGeneratedRecoveryCodes(null);
    setRecoverySaveStatus(undefined);
  }

  return (
    <div className="security-grid">
      <section className="security-card security-card-primary">
        <div className="security-card-heading">
          <span className="security-card-icon">
            <FingerPrintIcon aria-hidden="true" />
          </span>
          <div>
            <p className="section-kicker">
              {isPrivileged
                ? 'Phishing-resistant protection'
                : 'Legacy management credentials'}
            </p>
            <h2>
              {isPrivileged
                ? passkeys.length
                  ? 'Your passkeys'
                  : 'Add your first passkey'
                : passkeys.length
                  ? 'Inactive passkeys'
                  : 'No management passkeys'}
            </h2>
          </div>
        </div>

        <p className="security-card-description">
          {isPrivileged
            ? 'Passkeys use your device unlock, fingerprint, or face recognition. Field Atlas stores only the public credential—never your biometric.'
            : 'Passkeys are used only for owner and administrator management checks. They do not change sign-in or ordinary member access.'}
        </p>

        {isPrivileged ? (
          <div className="security-requirement">
            <ShieldCheckIcon aria-hidden="true" />
            <span>
              <strong>Required for protected management.</strong>
              Owner and administrator actions need a passkey check completed
              within the last 10 minutes.
            </span>
          </div>
        ) : passkeys.length ? (
          <div className="security-requirement security-requirement-muted">
            <KeyIcon aria-hidden="true" />
            <span>
              <strong>Inactive for this role.</strong>
              You can remove a legacy credential below, but members cannot use
              passkeys for sign-in or account actions.
            </span>
          </div>
        ) : null}

        {passkeys.length ? (
          <div
            className="security-passkey-list"
            aria-label="Registered passkeys"
          >
            {passkeys.map((passkey) => (
              <article key={passkey.id}>
                <KeyIcon aria-hidden="true" />
                <span>
                  <strong>{passkey.label}</strong>
                  <small>
                    {passkey.backedUp ? 'Synced passkey' : 'Device passkey'} ·{' '}
                    {formatDate(passkey.lastUsedAt)}
                  </small>
                </span>
                <div className="security-passkey-actions">
                  <CheckCircleIcon
                    className="security-passkey-status"
                    aria-label={
                      isPrivileged ? 'Active passkey' : 'Inactive credential'
                    }
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${passkey.label}`}
                    disabled={
                      isPending || (isPrivileged && passkeys.length <= 1)
                    }
                    title={
                      isPrivileged && passkeys.length <= 1
                        ? 'Add another passkey before removing this one.'
                        : undefined
                    }
                    onClick={() => requestPasskeyRemoval(passkey)}
                  >
                    <TrashIcon aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {isPrivileged && passkeys.length ? (
          <button
            className="security-primary-action"
            type="button"
            aria-busy={isPending}
            disabled={isPending || hasRecentVerification}
            onClick={verifyPasskey}
          >
            <FingerPrintIcon aria-hidden="true" />
            {hasRecentVerification
              ? 'Protected actions unlocked'
              : isPending
                ? 'Waiting for your device…'
                : 'Verify with a passkey'}
          </button>
        ) : null}
      </section>

      {isPrivileged ? (
        <section className="security-card">
          <div className="security-card-heading">
            <span className="security-card-icon security-card-icon-soft">
              <KeyIcon aria-hidden="true" />
            </span>
            <div>
              <p className="section-kicker">A trusted device</p>
              <h2>Add another passkey</h2>
            </div>
          </div>

          <div className="security-form">
            <label htmlFor="passkey-label">Passkey name</label>
            <input
              id="passkey-label"
              type="text"
              autoComplete="off"
              maxLength={80}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="MacBook, iPhone, security key…"
            />

            {!hasActiveRecoveryGrant ? (
              <>
                <label htmlFor="passkey-password">Current password</label>
                <input
                  id="passkey-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Confirm it is you"
                />
              </>
            ) : null}

            <button
              className="security-secondary-action"
              type="button"
              aria-busy={isPending}
              disabled={
                isPending ||
                (!hasActiveRecoveryGrant && !password) ||
                !label.trim() ||
                needsExistingPasskeyVerification
              }
              onClick={enrollPasskey}
            >
              <KeyIcon aria-hidden="true" />
              {isPending
                ? 'Opening your device…'
                : hasActiveRecoveryGrant
                  ? 'Create replacement passkey'
                  : needsExistingPasskeyVerification
                    ? 'Verify above to add a passkey'
                    : 'Create passkey'}
            </button>
          </div>

          <p className="security-fine-print">
            {isPrivileged && passkeys.length === 1
              ? 'Add a second passkey before retiring this one so protected access always has a trusted credential.'
              : needsExistingPasskeyVerification
                ? 'Confirm an existing passkey above before connecting another credential to this protected account.'
                : 'Keep more than one passkey when possible so another trusted device can recover protected access.'}
          </p>
        </section>
      ) : (
        <section className="security-card security-card-muted">
          <div className="security-card-heading">
            <span className="security-card-icon security-card-icon-soft">
              <ShieldCheckIcon aria-hidden="true" />
            </span>
            <div>
              <p className="section-kicker">Role-aware security</p>
              <h2>Management step-up is inactive</h2>
            </div>
          </div>
          <p className="security-card-description">
            If your role changes to administrator or owner, Field Atlas will
            guide you through passkey setup before protected management becomes
            available.
          </p>
        </section>
      )}

      {isPrivileged ? (
        <section className="security-card security-recovery-card">
          <div className="security-card-heading">
            <span className="security-card-icon security-card-icon-soft">
              <LifebuoyIcon aria-hidden="true" />
            </span>
            <div>
              <p className="section-kicker">Offline recovery</p>
              <h2>Saved recovery codes</h2>
            </div>
          </div>

          <p className="security-card-description">
            Each saved code works once. A code and your current password open a
            10-minute window to add a replacement passkey—they never unlock
            management actions by themselves.
          </p>

          <div className="security-recovery-status">
            <span>
              <strong>
                {localRecoverySummary
                  ? `${localRecoverySummary.remainingCodes} of ${localRecoverySummary.totalCodes} codes remain`
                  : 'No recovery codes saved'}
              </strong>
              <small>
                {localRecoverySummary
                  ? `Created ${formatDate(localRecoverySummary.createdAt)}`
                  : 'Verify with a passkey to create your offline set.'}
              </small>
            </span>
            <button
              type="button"
              disabled={isPending || !hasRecentVerification}
              onClick={requestRecoveryCodeGeneration}
            >
              {localRecoverySummary ? 'Replace codes' : 'Create codes'}
            </button>
          </div>

          {hasActiveRecoveryGrant ? (
            <div className="security-recovery-grant" role="status">
              <CheckCircleIcon aria-hidden="true" />
              <span>
                <strong>Replacement window ready.</strong>
                Name the new credential above and create it before{' '}
                {formatDate(activeRecoveryGrant?.expiresAt ?? null)}.
              </span>
            </div>
          ) : (
            <div className="security-recovery-form">
              <div className="security-recovery-field">
                <label htmlFor="privileged-recovery-code">
                  Saved recovery code
                </label>
                <input
                  id="privileged-recovery-code"
                  type="text"
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={64}
                  value={recoveryCode}
                  onChange={(event) => setRecoveryCode(event.target.value)}
                  placeholder="FA-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                />
              </div>
              <div className="security-recovery-field">
                <label htmlFor="privileged-recovery-password">
                  Account password
                </label>
                <input
                  id="privileged-recovery-password"
                  type="password"
                  autoComplete="current-password"
                  value={recoveryPassword}
                  onChange={(event) => setRecoveryPassword(event.target.value)}
                  placeholder="Confirm it is you"
                />
              </div>
              <button
                className="security-secondary-action"
                type="button"
                aria-busy={isPending}
                disabled={
                  isPending || !recoveryCode.trim() || !recoveryPassword
                }
                onClick={redeemRecoveryCode}
              >
                <LifebuoyIcon aria-hidden="true" />
                {isPending ? 'Checking recovery…' : 'Recover a lost passkey'}
              </button>
            </div>
          )}
        </section>
      ) : null}

      {message ? (
        <p
          className={`security-message security-message-${messageTone}`}
          role={messageTone === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}

      <Dialog
        open={passkeyToRemove !== null}
        onClose={closeRemovalDialog}
        className="owner-confirm-dialog"
      >
        <DialogBackdrop className="owner-confirm-backdrop" transition />
        <div className="owner-confirm-positioner">
          <DialogPanel className="owner-confirm-panel" transition>
            <span className="owner-confirm-icon" aria-hidden="true">
              <ExclamationTriangleIcon />
            </span>
            <p className="section-kicker">Retire trusted credential</p>
            <DialogTitle>Remove {passkeyToRemove?.label}?</DialogTitle>
            <DialogDescription>
              This device will stop unlocking protected actions. Recent passkey
              verification will also be cleared from every signed-in session.
            </DialogDescription>

            {!isPrivileged ? (
              <div className="security-removal-field">
                <label htmlFor="passkey-removal-password">
                  Current password
                </label>
                <input
                  id="passkey-removal-password"
                  type="password"
                  autoComplete="current-password"
                  value={removalPassword}
                  onChange={(event) => setRemovalPassword(event.target.value)}
                  placeholder="Confirm it is you"
                />
              </div>
            ) : null}

            {removalError ? (
              <div className="security-removal-error" role="alert">
                {removalError}
              </div>
            ) : null}

            <div className="owner-confirm-actions">
              <button
                type="button"
                disabled={isPending}
                onClick={closeRemovalDialog}
              >
                Keep passkey
              </button>
              <button
                type="button"
                disabled={
                  isPending || (!isPrivileged && removalPassword.length === 0)
                }
                onClick={confirmPasskeyRemoval}
              >
                {isPending ? 'Removing…' : 'Remove passkey'}
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>

      <Dialog
        open={replaceCodesDialogOpen}
        onClose={() => {
          if (!isPending) {
            setReplaceCodesDialogOpen(false);
            setRegenerationPassword('');
          }
        }}
        className="owner-confirm-dialog"
      >
        <DialogBackdrop className="owner-confirm-backdrop" transition />
        <div className="owner-confirm-positioner">
          <DialogPanel className="owner-confirm-panel" transition>
            <span className="owner-confirm-icon" aria-hidden="true">
              <ExclamationTriangleIcon />
            </span>
            <p className="section-kicker">
              {localRecoverySummary
                ? 'Replace offline recovery'
                : 'Create offline recovery'}
            </p>
            <DialogTitle>
              {localRecoverySummary ? 'Create a new set?' : 'Create your set?'}
            </DialogTitle>
            <DialogDescription>
              {localRecoverySummary
                ? 'Every previously saved recovery code will stop working immediately. Keep this dialog open until the new set is safely stored.'
                : 'Confirm your password, then keep the next dialog open until every code is safely stored.'}
            </DialogDescription>
            <div className="security-removal-field">
              <label htmlFor="recovery-code-generation-password">
                Current password
              </label>
              <input
                id="recovery-code-generation-password"
                type="password"
                autoComplete="current-password"
                value={regenerationPassword}
                onChange={(event) =>
                  setRegenerationPassword(event.target.value)
                }
                placeholder="Confirm it is you"
              />
            </div>
            <div className="owner-confirm-actions">
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setReplaceCodesDialogOpen(false);
                  setRegenerationPassword('');
                }}
              >
                {localRecoverySummary ? 'Keep current codes' : 'Not now'}
              </button>
              <button
                type="button"
                disabled={isPending || !regenerationPassword}
                onClick={createRecoveryCodes}
              >
                {isPending
                  ? 'Creating…'
                  : localRecoverySummary
                    ? 'Replace all codes'
                    : 'Create recovery codes'}
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>

      <Dialog
        open={recoveryDialogOpen}
        onClose={() => undefined}
        className="owner-confirm-dialog"
      >
        <DialogBackdrop className="owner-confirm-backdrop" transition />
        <div className="owner-confirm-positioner">
          <DialogPanel
            className="owner-confirm-panel security-recovery-dialog"
            transition
          >
            <span className="owner-confirm-icon" aria-hidden="true">
              <LifebuoyIcon />
            </span>
            <p className="section-kicker">Shown once</p>
            <DialogTitle>Save your recovery codes.</DialogTitle>
            <DialogDescription>
              Put these somewhere private and separate from this device. Each
              code restores one replacement-passkey attempt and disappears after
              use.
            </DialogDescription>

            <ol
              className="security-recovery-code-list"
              aria-label="Recovery codes"
            >
              {generatedRecoveryCodes?.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                </li>
              ))}
            </ol>

            <div className="security-recovery-save-actions">
              <button type="button" onClick={copyRecoveryCodes}>
                <ClipboardDocumentIcon aria-hidden="true" />
                Copy codes
              </button>
              <button type="button" onClick={downloadRecoveryCodes}>
                <ArrowDownTrayIcon aria-hidden="true" />
                Download .txt
              </button>
            </div>

            {recoverySaveStatus ? (
              <p className="security-recovery-save-status" role="status">
                {recoverySaveStatus}
              </p>
            ) : null}

            <button
              className="security-recovery-saved-button"
              type="button"
              onClick={closeRecoveryCodesDialog}
            >
              I have saved these codes
            </button>
          </DialogPanel>
        </div>
      </Dialog>
    </div>
  );
}
