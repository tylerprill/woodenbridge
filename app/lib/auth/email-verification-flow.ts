import 'server-only';

import { after } from 'next/server';

import {
  createDecoyVerificationChallengeId,
  createPendingRegistrationChallenge,
  getEmailVerificationEmailHash,
  invalidatePendingRegistrationChallenge,
  recordEmailVerificationRequest,
  type PendingRegistrationProposal,
} from '@/app/lib/auth/email-verification';
import { sendEmailVerificationEmail } from '@/app/lib/auth/recovery-email';

export async function issuePendingRegistrationVerification({
  registration,
  ipHash,
  fallbackChallengeId,
}: {
  registration: PendingRegistrationProposal;
  ipHash: string;
  fallbackChallengeId?: string;
}) {
  const emailHash = getEmailVerificationEmailHash(registration.email);
  const allowed = await recordEmailVerificationRequest(emailHash, ipHash);

  if (!allowed) {
    return fallbackChallengeId ?? createDecoyVerificationChallengeId();
  }

  const challenge = await createPendingRegistrationChallenge(registration);

  // A verified account is deliberately indistinguishable from an unknown
  // address at the HTTP layer, and its credential is never replaced.
  if (!challenge) {
    return fallbackChallengeId ?? createDecoyVerificationChallengeId();
  }

  const { challengeId, code } = challenge;

  after(async () => {
    try {
      await sendEmailVerificationEmail({
        to: registration.email,
        firstName: registration.firstName,
        code,
        challengeId,
      });
    } catch (error) {
      await invalidatePendingRegistrationChallenge(challengeId);
      console.error('Email verification delivery failed:', error);
    }
  });

  return challengeId;
}
