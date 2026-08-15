'use client';

import {
  ArrowRightIcon,
  EnvelopeIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { authenticate } from '@/app/lib/actions';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="auth-submit" type="submit" disabled={pending}>
      <span>{pending ? 'Signing in…' : 'Sign in'}</span>
      {pending ? (
        <span className="auth-spinner" aria-hidden="true" />
      ) : (
        <ArrowRightIcon aria-hidden="true" />
      )}
    </button>
  );
}

export default function LoginForm({
  resetComplete = false,
}: {
  resetComplete?: boolean;
}) {
  const [errorMessage, dispatch] = useActionState(authenticate, undefined);

  return (
    <form className="auth-form" action={dispatch}>
      {resetComplete ? (
        <p className="auth-notice" role="status">
          Your password has been changed. Sign in with your new password.
        </p>
      ) : null}

      <div className="auth-field">
        <label htmlFor="email">Email address</label>
        <div className="auth-input-wrap">
          <EnvelopeIcon aria-hidden="true" />
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </div>
      </div>

      <div className="auth-field">
        <div className="auth-label-row">
          <label htmlFor="password">Password</label>
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
        <div className="auth-input-wrap">
          <LockClosedIcon aria-hidden="true" />
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            minLength={6}
            required
          />
        </div>
      </div>

      {errorMessage ? (
        <p id="login-error" className="auth-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
