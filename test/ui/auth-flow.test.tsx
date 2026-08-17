/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';

import type { SignUpState } from '@/app/lib/auth/sign-up';
import { SignUpFieldsForm } from '@/components/unclean/sign-up-form';
import VerifyEmailForm, {
  VerificationCodeForm,
} from '@/components/unclean/verify-email-form';

jest.mock('@/app/lib/actions', () => ({
  createUser: jest.fn(),
}));

jest.mock('@/app/lib/actions/email-verification', () => ({
  resendEmailVerification: jest.fn(),
  restartEmailVerification: jest.fn(),
  submitEmailVerificationCode: jest.fn(),
}));

describe('account creation and verification UI', () => {
  it('retains identity fields but never restores passwords after a signup error', () => {
    const state: Exclude<SignUpState, undefined> = {
      status: 'error',
      message: 'The passwords do not match.',
      fields: {
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'ada@example.com',
      },
      submission: 1,
    };

    render(<SignUpFieldsForm action={jest.fn()} state={state} />);

    expect(screen.getByLabelText('First name')).toHaveValue('Ada');
    expect(screen.getByLabelText('Last name')).toHaveValue('Lovelace');
    expect(screen.getByLabelText('Email address')).toHaveValue(
      'ada@example.com',
    );
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The passwords do not match.',
    );
  });

  it('uses a constrained one-time-code field and exposes resend recovery', () => {
    render(<VerificationCodeForm codeSent />);

    const code = screen.getByLabelText('Verification code');
    expect(code).toHaveAttribute('inputmode', 'numeric');
    expect(code).toHaveAttribute('pattern', '[0-9]{6}');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('maxlength', '6');
    expect(
      screen.getByRole('button', { name: 'Send another code' }),
    ).toBeEnabled();
    expect(screen.getByText(/expires in 10 minutes/i)).toBeVisible();
  });

  it('returns a browser without a challenge to account creation', () => {
    render(<VerifyEmailForm hasChallenge={false} codeSent={false} />);

    expect(
      screen.getByRole('link', { name: 'Return to create account' }),
    ).toHaveAttribute('href', '/sign-up');
    expect(
      screen.getByText(/stays separate from active accounts/i),
    ).toBeVisible();
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
  });
});
