import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthShell } from '@/components/clean/auth-shell';
import LoginForm from '@/components/unclean/login-form';

export const metadata: Metadata = {
  title: 'Sign in — Field Atlas',
  description: 'Sign in to continue building your personal field atlas.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    reset?: string | string[];
    verified?: string | string[];
  }>;
}) {
  const params = await searchParams;
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
          New to the atlas? <Link href="/sign-up">Create an account</Link>
        </p>
      }
    >
      <LoginForm
        resetComplete={resetComplete}
        verificationComplete={verificationComplete}
      />
    </AuthShell>
  );
}
