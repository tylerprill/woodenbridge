import type { Metadata } from 'next';
import {
  ArrowRightOnRectangleIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';

import { logOutEverywhere } from '@/app/lib/actions/auth';
import { getUserPasskeys } from '@/app/lib/auth/passkeys';
import {
  getActiveRecoveryGrant,
  getRecoveryCodeSummary,
} from '@/app/lib/auth/recovery-codes';
import { isPasskeyVerificationRecent } from '@/app/lib/auth/session-policy';
import { requireVerifiedSession } from '@/app/lib/auth/session';
import { PasskeySecurityPanel } from '@/components/auth/passkey-security-panel';

export const metadata: Metadata = {
  title: 'Account security — Field Atlas',
  description: 'Passkeys and authenticated-session controls for Field Atlas.',
};

async function signOutEverywhereFromForm() {
  'use server';
  await logOutEverywhere();
}

function getSafeReturnPath(value?: string | string[]) {
  return typeof value === 'string' &&
    value.startsWith('/dashboard/') &&
    !value.startsWith('//')
    ? value
    : undefined;
}

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{
    required?: string | string[];
    returnTo?: string | string[];
  }>;
}) {
  const [session, params] = await Promise.all([
    requireVerifiedSession(),
    searchParams,
  ]);
  const isPrivileged = session.role === 'admin' || session.role === 'owner';
  const [passkeys, recoveryCodeSummary, recoveryGrant] = await Promise.all([
    getUserPasskeys(session.user.id),
    isPrivileged ? getRecoveryCodeSummary(session.user.id) : null,
    isPrivileged
      ? getActiveRecoveryGrant({
          userId: session.user.id,
          sessionReference: session.sessionReference,
        })
      : null,
  ]);
  const isRecentlyVerified = isPasskeyVerificationRecent(
    session.mfaVerifiedAt,
    session.mfaMethod,
  );
  const returnTo = getSafeReturnPath(params.returnTo);
  const protectionRequired = isPrivileged && params.required === 'passkey';

  const sessionControl = (
    <section className="security-sessions">
      <div>
        <p className="section-kicker">Session control</p>
        <h2>
          {isPrivileged ? 'Sign out every device' : 'Your signed-in devices'}
        </h2>
        <p>
          {isPrivileged
            ? 'Immediately revoke every browser session connected to this account, including this one.'
            : 'If a phone or computer no longer feels familiar, revoke every Field Atlas session—including this one.'}
        </p>
      </div>
      <form action={signOutEverywhereFromForm}>
        <button type="submit">
          <ArrowRightOnRectangleIcon aria-hidden="true" />
          Sign out everywhere
        </button>
      </form>
    </section>
  );

  return (
    <div className="dashboard-page security-page">
      <header className="dashboard-page-heading security-heading">
        <div>
          <p className="section-kicker">
            {isPrivileged ? 'Account protection' : 'Your account'}
          </p>
          <h1>{isPrivileged ? 'Security.' : 'Account & security.'}</h1>
          <p>
            {isPrivileged
              ? 'Keep access to your atlas anchored to devices you trust, with a short verification window for sensitive actions.'
              : 'Confirm which account is open and keep control of every device signed in to your atlas.'}
          </p>
        </div>
        <span className="owner-access-badge">
          <ShieldCheckIcon aria-hidden="true" />{' '}
          {isPrivileged ? 'Protected management' : 'Personal account'}
        </span>
      </header>

      {protectionRequired ? (
        <p className="security-gate-notice" role="status">
          {passkeys.length
            ? 'Verify with a passkey to continue to protected management.'
            : 'Add a passkey before opening protected management.'}
        </p>
      ) : null}

      {isPrivileged ? (
        <>
          <PasskeySecurityPanel
            isPrivileged
            isRecentlyVerified={isRecentlyVerified}
            mfaVerifiedAt={session.mfaVerifiedAt}
            passkeys={passkeys}
            recoveryCodeSummary={recoveryCodeSummary}
            recoveryGrant={recoveryGrant}
            returnTo={returnTo}
          />
          {sessionControl}
        </>
      ) : (
        <>
          <div className="security-personal-grid">
            <section className="security-account-summary">
              <span className="security-card-icon" aria-hidden="true">
                <ShieldCheckIcon />
              </span>
              <div>
                <p className="section-kicker">Signed-in account</p>
                <h2>Your personal atlas</h2>
                <p className="security-account-email">{session.user.email}</p>
                <p>
                  Your email is verified and this private workspace is available
                  only after sign-in.
                </p>
              </div>
            </section>
            {sessionControl}
          </div>

          {passkeys.length ? (
            <div className="security-legacy-credentials">
              <PasskeySecurityPanel
                isPrivileged={false}
                isRecentlyVerified={false}
                mfaVerifiedAt={null}
                passkeys={passkeys}
                recoveryCodeSummary={null}
                recoveryGrant={null}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
