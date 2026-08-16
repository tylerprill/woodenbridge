'use client';

import {
  ArrowRightIcon,
  EnvelopeIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import {
  useActionState,
  useEffect,
  useState,
  useTransition,
  type FormEvent,
} from 'react';

import { authenticate } from '@/app/lib/actions';
import type { LoginState } from '@/app/lib/auth/login';
import {
  readRememberedEmail,
  writeRememberedEmail,
} from '@/app/lib/auth/remembered-email';

function SubmitButton({ pending }: { pending: boolean }) {
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
  verificationComplete = false,
}: {
  resetComplete?: boolean;
  verificationComplete?: boolean;
}) {
  const [state, dispatch] = useActionState<LoginState, FormData>(
    authenticate,
    undefined,
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberEmail, setRememberEmail] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const rememberedEmail = readRememberedEmail(window.localStorage);
    if (!rememberedEmail) return;

    const frame = requestAnimationFrame(() => {
      setEmail(rememberedEmail);
      setRememberEmail(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!state) return;

    const frame = requestAnimationFrame(() => {
      setEmail(state.email);
      setPassword('');
    });
    return () => cancelAnimationFrame(frame);
  }, [state]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(() => dispatch(formData));
  }

  return (
    <form className="auth-form" action={dispatch} onSubmit={handleSubmit}>
      {resetComplete ? (
        <p className="auth-notice" role="status">
          Your password has been changed. Sign in with your new password.
        </p>
      ) : null}

      {verificationComplete ? (
        <p className="auth-notice" role="status">
          Your email is verified. Sign in to open your atlas.
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
            autoComplete="username"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => {
              const nextEmail = event.target.value;
              setEmail(nextEmail);
              if (rememberEmail) {
                writeRememberedEmail(window.localStorage, nextEmail);
              }
            }}
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
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
      </div>

      <div className="auth-remember-row">
        <label className="auth-remember-control">
          <input
            type="checkbox"
            checked={rememberEmail}
            onChange={(event) => {
              const checked = event.target.checked;
              setRememberEmail(checked);
              writeRememberedEmail(
                window.localStorage,
                checked ? email : undefined,
              );
            }}
          />
          <span>Remember me</span>
        </label>
        <span>Stores only your email on this device.</span>
      </div>

      {state ? (
        <p id="login-error" className="auth-error" role="alert">
          {state.message}
        </p>
      ) : null}

      <SubmitButton pending={pending} />

      <p className="auth-inline-help">
        Waiting for a verification code?{' '}
        <Link href="/verify-email">Verify your email</Link>
      </p>
    </form>
  );
}
