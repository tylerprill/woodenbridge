'use client';

import {
  ArrowRightIcon,
  EnvelopeIcon,
  LockClosedIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { createUser } from '@/app/lib/actions';
import {
  MAX_PASSWORD_CHARACTERS,
  MIN_PASSWORD_LENGTH,
} from '@/app/lib/auth/password';
import type { SignUpState } from '@/app/lib/auth/sign-up';

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

function SignUpFieldsForm({
  action,
  state,
}: {
  action: (formData: FormData) => void;
  state: SignUpState;
}) {
  const [fields, setFields] = useState(
    state?.fields ?? {
      first_name: '',
      last_name: '',
      email: '',
    },
  );

  useEffect(() => {
    if (!state) return;

    const frame = requestAnimationFrame(() => setFields({ ...state.fields }));
    return () => cancelAnimationFrame(frame);
  }, [state]);

  return (
    <form className="auth-form" action={action}>
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
              value={fields.first_name}
              onChange={(event) =>
                setFields((current) => ({
                  ...current,
                  first_name: event.target.value,
                }))
              }
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
              value={fields.last_name}
              onChange={(event) =>
                setFields((current) => ({
                  ...current,
                  last_name: event.target.value,
                }))
              }
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
            autoComplete="username"
            placeholder="you@example.com"
            value={fields.email}
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                email: event.target.value,
              }))
            }
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

      <div className="auth-field">
        <label htmlFor="confirm-password">Confirm password</label>
        <div className="auth-input-wrap">
          <LockClosedIcon aria-hidden="true" />
          <input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="Repeat your password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </div>
      </div>

      {state ? (
        <p id="sign-up-error" className="auth-error" role="alert">
          {state.message}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}

export default function SignUpForm() {
  const [state, dispatch] = useActionState<SignUpState, FormData>(
    createUser,
    undefined,
  );

  return <SignUpFieldsForm action={dispatch} state={state} />;
}
