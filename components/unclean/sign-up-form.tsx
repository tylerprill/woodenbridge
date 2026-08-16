'use client';

import {
  ArrowRightIcon,
  EnvelopeIcon,
  LockClosedIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { createUser } from '@/app/lib/actions';
import {
  MAX_PASSWORD_CHARACTERS,
  MIN_PASSWORD_LENGTH,
} from '@/app/lib/auth/password';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="auth-submit" type="submit" disabled={pending}>
      <span>{pending ? 'Creating your atlas…' : 'Create account'}</span>
      {pending ? (
        <span className="auth-spinner" aria-hidden="true" />
      ) : (
        <ArrowRightIcon aria-hidden="true" />
      )}
    </button>
  );
}

export default function SignUpForm() {
  const [errorMessage, dispatch] = useActionState(createUser, undefined);

  return (
    <form className="auth-form" action={dispatch}>
      <div className="auth-field-row">
        <div className="auth-field">
          <label htmlFor="first_name">First name</label>
          <div className="auth-input-wrap">
            <UserIcon aria-hidden="true" />
            <input
              id="first_name"
              name="first_name"
              type="text"
              autoComplete="given-name"
              placeholder="First name"
              required
            />
          </div>
        </div>

        <div className="auth-field">
          <label htmlFor="last_name">Last name</label>
          <div className="auth-input-wrap">
            <UserIcon aria-hidden="true" />
            <input
              id="last_name"
              name="last_name"
              type="text"
              autoComplete="family-name"
              placeholder="Last name"
              required
            />
          </div>
        </div>
      </div>

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
          <span id="password-requirements">
            {MIN_PASSWORD_LENGTH}–{MAX_PASSWORD_CHARACTERS} characters
          </span>
        </div>
        <div className="auth-input-wrap">
          <LockClosedIcon aria-hidden="true" />
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Create a password"
            aria-describedby="password-requirements"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </div>
      </div>

      {errorMessage ? (
        <p id="sign-up-error" className="auth-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
