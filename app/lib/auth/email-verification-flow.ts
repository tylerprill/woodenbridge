import 'server-only';

import { after } from 'next/server';

import {
  createDecoyVerificationChallengeId,
  createEmailVerificationChallenge,
  getEmailVerificationEmailHash,
  invalidateEmailVerificationChallenge,
  recordEmailVerificationRequest,
  type EmailVerificationUser,
} from '@/app/lib/auth/email-verification';
import { sendEmailVerificationEmail } from '@/app/lib/auth/recovery-email';

export async function issueEmailVerification({
  email,
  ipHash,
  user,
  fallbackChallengeId,
}: {
  email: string;
  ipHash: string;
  user?: EmailVerificationUser;
  fallbackChallengeId?: string;
}) {
  const emailHash = getEmailVerificationEmailHash(email);
  const allowed = await recordEmailVerificationRequest(emailHash, ipHash);

  if (!allowed || !user || user.email_verified_at) {
    return fallbackChallengeId ?? createDecoyVerificationChallengeId();
  }

  const { challengeId, code } = await createEmailVerificationChallenge(user.id);

  after(async () => {
    try {
      await sendEmailVerificationEmail({
        to: user.email,
        firstName: user.first_name,
        code,
        challengeId,
      });
    } catch (error) {
      await invalidateEmailVerificationChallenge(challengeId);
      console.error('Email verification delivery failed:', error);
    }
  });

  return challengeId;
}
