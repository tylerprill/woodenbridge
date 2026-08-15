'use client';

import { ArrowRightIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  requestPasswordReset,
  type PasswordResetState,
} from '@/app/lib/actions/password-reset';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="auth-submit" type="submit" disabled={pending}>
      <span>{pending ? 'Sending reset link…' : 'Send reset link'}</span>
      {pending ? (
        <span className="auth-spinner" aria-hidden="true" />
      ) : (
        <ArrowRightIcon aria-hidden="true" />
      )}
    </button>
  );
}

export default function ForgotPasswordForm() {
  const [state, dispatch] = useActionState<PasswordResetState, FormData>(
    requestPasswordReset,
    undefined,
  );

  return (
    <form className="auth-form" action={dispatch}>
      <div className="auth-field">
        <label htmlFor="recovery-email">Email address</label>
        <div className="auth-input-wrap">
          <EnvelopeIcon aria-hidden="true" />
          <input
            id="recovery-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </div>
      </div>

      {state ? (
        <p
          className={state.status === 'error' ? 'auth-error' : 'auth-notice'}
          role={state.status === 'error' ? 'alert' : 'status'}
        >
          {state.message}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
