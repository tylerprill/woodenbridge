'use client';

import {
  ArrowPathIcon,
  ArrowRightIcon,
  EnvelopeIcon,
  KeyIcon,
} from '@heroicons/react/24/outline';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  requestEmailVerification,
  resendEmailVerification,
  restartEmailVerification,
  submitEmailVerificationCode,
  type EmailVerificationState,
} from '@/app/lib/actions/email-verification';

function SubmitButton({
  idleLabel,
  pendingLabel,
}: {
  idleLabel: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button className="auth-submit" type="submit" disabled={pending}>
      <span>{pending ? pendingLabel : idleLabel}</span>
      {pending ? (
        <span className="auth-spinner" aria-hidden="true" />
      ) : (
        <ArrowRightIcon aria-hidden="true" />
      )}
    </button>
  );
}

function FormMessage({ state }: { state: EmailVerificationState }) {
  if (!state) return null;

  return (
    <p
      className={state.status === 'error' ? 'auth-error' : 'auth-notice'}
      role={state.status === 'error' ? 'alert' : 'status'}
    >
      {state.message}
    </p>
  );
}

function RequestCodeForm({ pendingEmail }: { pendingEmail?: string | null }) {
  const [state, dispatch] = useActionState(requestEmailVerification, undefined);

  return (
    <form className="auth-form" action={dispatch}>
      {pendingEmail ? (
        <p className="auth-notice" role="status">
          Continue verifying <strong>{pendingEmail}</strong>, or switch accounts
          below.
        </p>
      ) : (
        <div className="auth-field">
          <label htmlFor="verification-email">Email address</label>
          <div className="auth-input-wrap">
            <EnvelopeIcon aria-hidden="true" />
            <input
              id="verification-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </div>
        </div>
      )}

      <FormMessage state={state} />
      <SubmitButton
        idleLabel="Send verification code"
        pendingLabel="Sending code…"
      />

      {pendingEmail ? (
        <button
          className="auth-text-button auth-centered-text-button"
          formAction={restartEmailVerification}
          type="submit"
        >
          Use another account
        </button>
      ) : null}
    </form>
  );
}

function VerificationCodeForm({ codeSent }: { codeSent: boolean }) {
  const [verifyState, verifyDispatch] = useActionState(
    submitEmailVerificationCode,
    undefined,
  );
  const [resendState, resendDispatch] = useActionState(
    resendEmailVerification,
    undefined,
  );

  return (
    <div className="auth-form">
      {codeSent ? (
        <p className="auth-notice" role="status">
          Check your inbox. Your six-digit code expires in 10 minutes.
        </p>
      ) : null}

      <form className="auth-form" action={verifyDispatch}>
        <div className="auth-field">
          <label htmlFor="verification-code">Verification code</label>
          <div className="auth-input-wrap auth-code-input-wrap">
            <KeyIcon aria-hidden="true" />
            <input
              id="verification-code"
              name="code"
              type="text"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              aria-describedby="verification-code-help"
              autoFocus
              required
            />
          </div>
          <p id="verification-code-help" className="auth-field-help">
            Enter the code exactly as it appears in your email.
          </p>
        </div>

        <FormMessage state={verifyState} />
        <SubmitButton
          idleLabel="Verify and continue"
          pendingLabel="Verifying…"
        />
      </form>

      <div className="auth-verification-actions">
        <form action={resendDispatch}>
          <button className="auth-text-button" type="submit">
            <ArrowPathIcon aria-hidden="true" />
            Send another code
          </button>
        </form>
        <form action={restartEmailVerification}>
          <button className="auth-text-button" type="submit">
            Use a different email
          </button>
        </form>
      </div>

      <FormMessage state={resendState} />
    </div>
  );
}

export default function VerifyEmailForm({
  hasChallenge,
  codeSent,
  pendingEmail,
}: {
  hasChallenge: boolean;
  codeSent: boolean;
  pendingEmail?: string | null;
}) {
  return hasChallenge ? (
    <VerificationCodeForm codeSent={codeSent} />
  ) : (
    <RequestCodeForm pendingEmail={pendingEmail} />
  );
}
