import type { Metadata } from 'next';
import Link from 'next/link';

import { findRecentlyVerifiedEmailByChallenge } from '@/app/lib/auth/email-verification';
import { getVerifiedLoginChallengeCookie } from '@/app/lib/auth/email-verification-cookie';
import {
  getPostAuthIntent,
  withPostAuthIntent,
} from '@/app/lib/auth/post-auth-intent';
import { AuthShell } from '@/components/clean/auth-shell';
import LoginForm from '@/components/unclean/login-form';

export const metadata: Metadata = {
  title: 'Sign in — Field Atlas',
  description: 'Sign in to continue building your personal field atlas.',
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    intent?: string | string[];
    reset?: string | string[];
    verified?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const intent = getPostAuthIntent(params.intent);
  const resetComplete = params.reset === 'success';
  const verificationRequested = params.verified === 'success';
  let verifiedEmail: string | undefined;

  if (verificationRequested) {
    const verifiedChallengeId = await getVerifiedLoginChallengeCookie();

    if (verifiedChallengeId) {
      try {
        verifiedEmail =
          await findRecentlyVerifiedEmailByChallenge(verifiedChallengeId);
      } catch (error) {
        console.error('Verified login destination lookup failed:', error);
      }
    }
  }

  return (
    <AuthShell
      headingId="login-title"
      panelDescription="Enter the email and password connected to your account."
      panelEyebrow="Your collection"
      panelTitle="Sign in to continue"
      storyDescription="Return to the places you have saved and the journeys still on your horizon."
      storyEyebrow="Welcome back"
      storyNote="The best stories rarely begin with a straight line."
      storyTitle="Your next memory is waiting."
      footer={
        <p className="auth-signup-prompt">
          New to the atlas?{' '}
          <Link href={withPostAuthIntent('/sign-up', intent)} prefetch={false}>
            Create an account
          </Link>
        </p>
      }
    >
      <LoginForm
        intent={intent}
        initialEmail={verifiedEmail}
        resetComplete={resetComplete}
        verificationComplete={Boolean(verifiedEmail)}
      />
    </AuthShell>
  );
}
