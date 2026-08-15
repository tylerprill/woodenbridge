import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthShell } from '@/components/clean/auth-shell';
import ForgotPasswordForm from '@/components/unclean/forgot-password-form';

export const metadata: Metadata = {
  title: 'Account recovery — Wooden Bridge',
  description: 'Find the available recovery options for your account.',
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      headingId="recovery-title"
      panelDescription="Enter your email to check the recovery options available for your account."
      panelEyebrow="Account recovery"
      panelTitle="Find your way back"
      storyDescription="A missed turn does not have to end the journey. Start here and we will point you toward the next step."
      storyEyebrow="Lost the trail?"
      storyNote="The surest way forward sometimes begins by retracing a step."
      storyTitle="Let’s find the way back."
      footer={
        <p className="auth-signup-prompt">
          Remembered your password? <Link href="/login">Return to sign in</Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
