'use client';

import { ArrowRightIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  resetPassword,
  type PasswordResetState,
} from '@/app/lib/actions/password-reset';
import {
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
} from '@/app/lib/auth/password';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="auth-submit" type="submit" disabled={pending}>
      <span>{pending ? 'Securing your account…' : 'Set new password'}</span>
      {pending ? (
        <span className="auth-spinner" aria-hidden="true" />
      ) : (
        <ArrowRightIcon aria-hidden="true" />
      )}
    </button>
  );
}

export default function ResetPasswordForm({ token }: { token: string }) {
  const [state, dispatch] = useActionState<PasswordResetState, FormData>(
    resetPassword,
    undefined,
  );

  return (
    <form className="auth-form" action={dispatch}>
      <input type="hidden" name="token" value={token} />

      <div className="auth-field">
        <div className="auth-label-row">
          <label htmlFor="new-password">New password</label>
          <span id="reset-password-requirements">
            {MIN_PASSWORD_LENGTH}+ characters
          </span>
        </div>
        <div className="auth-input-wrap">
          <LockClosedIcon aria-hidden="true" />
          <input
            id="new-password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Create a strong password"
            aria-describedby="reset-password-requirements"
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_BYTES}
            required
          />
        </div>
      </div>

      <div className="auth-field">
        <label htmlFor="confirm-password">Confirm new password</label>
        <div className="auth-input-wrap">
          <LockClosedIcon aria-hidden="true" />
          <input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="Repeat your new password"
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_BYTES}
            required
          />
        </div>
      </div>

      {state ? (
        <p className="auth-error" role="alert">
          {state.message}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
