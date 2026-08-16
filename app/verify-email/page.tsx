import type { Metadata } from 'next';
import Link from 'next/link';

import { auth } from '@/auth';
import { getEmailVerificationChallengeCookie } from '@/app/lib/auth/email-verification-cookie';
import { AuthShell } from '@/components/clean/auth-shell';
import VerifyEmailForm from '@/components/unclean/verify-email-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Verify your email — Field Atlas',
  description: 'Verify your email address to open your Field Atlas account.',
  referrer: 'no-referrer',
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string | string[] }>;
}) {
  const params = await searchParams;
  const session = await auth();
  const challengeId = await getEmailVerificationChallengeCookie();
  const hasChallenge = Boolean(challengeId);
  const pendingEmail =
    session?.user && session.emailVerified === false
      ? session.user.email
      : undefined;

  return (
    <AuthShell
      headingId="verify-email-title"
      panelDescription={
        hasChallenge
          ? 'Enter the short code we sent to prove this inbox belongs to you.'
          : 'Request a secure, single-use code to confirm your email address.'
      }
      panelEyebrow="One last step"
      panelTitle={hasChallenge ? 'Check your email' : 'Verify your email'}
      storyDescription="A quick confirmation keeps every field note, saved place, and future journey connected to its rightful explorer."
      storyEyebrow="Confirm your route"
      storyNote="A six-digit marker, valid for ten minutes, opens the way forward."
      storyTitle="Make sure this atlas finds its owner."
      footer={
        <p className="auth-signup-prompt">
          Already verified? <Link href="/login">Return to sign in</Link>
        </p>
      }
    >
      <VerifyEmailForm
        hasChallenge={hasChallenge}
        codeSent={params.sent === '1'}
        pendingEmail={pendingEmail}
      />
    </AuthShell>
  );
}
