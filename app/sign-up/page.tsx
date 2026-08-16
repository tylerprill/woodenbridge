import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthShell } from '@/components/clean/auth-shell';
import SignUpForm from '@/components/unclean/sign-up-form';

export const metadata: Metadata = {
  title: 'Create an account — Wooden Bridge',
  description: 'Create an account and begin your personal field atlas.',
};

export default function SignUpPage() {
  return (
    <AuthShell
      headingId="sign-up-title"
      panelDescription="Create your account, then confirm the short code we send to your email."
      panelEyebrow="Begin your atlas"
      panelTitle="Create your account"
      storyDescription="Save remarkable bridges, remember where you have wandered, and keep the next journey close."
      storyEyebrow="Make it yours"
      storyNote="Every collection begins with a single crossing."
      storyTitle="Keep the places worth remembering."
      footer={
        <p className="auth-signup-prompt">
          Already have an atlas? <Link href="/login">Sign in</Link>
        </p>
      }
    >
      <SignUpForm />
    </AuthShell>
  );
}
