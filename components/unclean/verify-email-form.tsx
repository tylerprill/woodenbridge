'use client';

import {
  ArrowPathIcon,
  ArrowRightIcon,
  KeyIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
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

function StartRegistration() {
  return (
    <div className="auth-form">
      <p className="auth-notice" role="status">
        Verification starts on the create account page. Your proposed account
        stays separate from active accounts until this browser confirms the code
        sent to your inbox.
      </p>
      <Link className="auth-submit" href="/sign-up">
        <span>Return to create account</span>
        <ArrowRightIcon aria-hidden="true" />
      </Link>
      <p className="auth-field-help">
        Started earlier? Create the account again with the details and password
        you want to keep.
      </p>
    </div>
  );
}

export function VerificationCodeForm({ codeSent }: { codeSent: boolean }) {
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
}: {
  hasChallenge: boolean;
  codeSent: boolean;
}) {
  return hasChallenge ? (
    <VerificationCodeForm codeSent={codeSent} />
  ) : (
    <StartRegistration />
  );
}
