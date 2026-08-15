'use client';

import { ArrowRightIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { useFormState, useFormStatus } from 'react-dom';

import { checkRecoveryOptions } from '@/app/lib/actions';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="auth-submit" type="submit" disabled={pending}>
      <span>{pending ? 'Checking options…' : 'Check recovery options'}</span>
      {pending ? (
        <span className="auth-spinner" aria-hidden="true" />
      ) : (
        <ArrowRightIcon aria-hidden="true" />
      )}
    </button>
  );
}

export default function ForgotPasswordForm() {
  const [message, dispatch] = useFormState(checkRecoveryOptions, undefined);

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

      {message ? (
        <p className="auth-notice" role="status">
          {message}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
