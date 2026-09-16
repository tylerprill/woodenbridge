/**
 * @jest-environment jsdom
 */

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';

import { findRecentlyVerifiedEmailByChallenge } from '@/app/lib/auth/email-verification';
import { getVerifiedLoginChallengeCookie } from '@/app/lib/auth/email-verification-cookie';
import LoginPage from '@/app/login/page';

jest.mock('@/app/lib/auth/email-verification', () => ({
  findRecentlyVerifiedEmailByChallenge: jest.fn(),
}));

jest.mock('@/app/lib/auth/email-verification-cookie', () => ({
  getVerifiedLoginChallengeCookie: jest.fn(),
}));

jest.mock('@/components/clean/auth-shell', () => ({
  AuthShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/unclean/login-form', () => ({
  __esModule: true,
  default: ({
    initialEmail = '',
    verificationComplete = false,
  }: {
    initialEmail?: string;
    verificationComplete?: boolean;
  }) => (
    <div>
      <input aria-label="Prefilled email" readOnly value={initialEmail} />
      {verificationComplete ? <p>Your email is verified.</p> : null}
    </div>
  ),
}));

const getHandoffCookie = jest.mocked(getVerifiedLoginChallengeCookie);
const findVerifiedEmail = jest.mocked(findRecentlyVerifiedEmailByChallenge);

describe('verified login page handoff', () => {
  beforeEach(() => {
    getHandoffCookie.mockReset();
    findVerifiedEmail.mockReset();
  });

  it('does not inspect or prefill a handoff during an ordinary login', async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByLabelText('Prefilled email')).toHaveValue('');
    expect(getHandoffCookie).not.toHaveBeenCalled();
    expect(findVerifiedEmail).not.toHaveBeenCalled();
  });

  it('prefills only when verified success has a valid opaque handoff', async () => {
    const challengeId = 'c'.repeat(43);
    getHandoffCookie.mockResolvedValueOnce(challengeId);
    findVerifiedEmail.mockResolvedValueOnce('new.explorer@example.com');

    render(
      await LoginPage({
        searchParams: Promise.resolve({
          intent: 'photo-import',
          verified: 'success',
        }),
      }),
    );

    expect(getHandoffCookie).toHaveBeenCalledTimes(1);
    expect(findVerifiedEmail).toHaveBeenCalledWith(challengeId);
    expect(screen.getByLabelText('Prefilled email')).toHaveValue(
      'new.explorer@example.com',
    );
    expect(screen.getByText('Your email is verified.')).toBeVisible();
  });

  it('does not prefill a forged success URL without the browser handoff', async () => {
    getHandoffCookie.mockResolvedValueOnce(undefined);

    render(
      await LoginPage({
        searchParams: Promise.resolve({ verified: 'success' }),
      }),
    );

    expect(screen.getByLabelText('Prefilled email')).toHaveValue('');
    expect(findVerifiedEmail).not.toHaveBeenCalled();
    expect(
      screen.queryByText('Your email is verified.'),
    ).not.toBeInTheDocument();
  });
});
