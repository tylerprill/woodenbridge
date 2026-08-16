import type { Metadata } from 'next';
import Link from 'next/link';

import { isPasswordResetTokenValid } from '@/app/lib/auth/reset-password';
import { AuthShell } from '@/components/clean/auth-shell';
import ResetPasswordForm from '@/components/unclean/reset-password-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Choose a new password — Field Atlas',
  description: 'Choose a new password for your Field Atlas account.',
  referrer: 'no-referrer',
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : '';
  const isValid = await isPasswordResetTokenValid(token);

  return (
    <AuthShell
      headingId="reset-password-title"
      panelDescription={
        isValid
          ? 'Choose a strong new password. Completing this step will sign your account out everywhere else.'
          : 'This reset link is invalid, expired, or has already been used.'
      }
      panelEyebrow="Account recovery"
      panelTitle={isValid ? 'Choose a new password' : 'The trail has gone cold'}
      storyDescription="A fresh key gets you back into your atlas while closing every old route into your account."
      storyEyebrow="Secure route"
      storyNote="Reset links expire after 30 minutes and disappear after one use."
      storyTitle="Make the next journey yours."
      footer={
        <p className="auth-signup-prompt">
          {isValid ? (
            <>
              Remembered it? <Link href="/login">Return to sign in</Link>
            </>
          ) : (
            <Link href="/forgot-password">Request a new reset link</Link>
          )}
        </p>
      }
    >
      {isValid ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p className="auth-notice auth-reset-expired" role="alert">
          For your security, reset links work once and expire after 30 minutes.
          Request another link to continue.
        </p>
      )}
    </AuthShell>
  );
}
