import type { Metadata } from 'next';
import Link from 'next/link';

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
  const verificationComplete = params.verified === 'success';

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
          <Link href={withPostAuthIntent('/sign-up', intent)}>
            Create an account
          </Link>
        </p>
      }
    >
      <LoginForm
        intent={intent}
        resetComplete={resetComplete}
        verificationComplete={verificationComplete}
      />
    </AuthShell>
  );
}
