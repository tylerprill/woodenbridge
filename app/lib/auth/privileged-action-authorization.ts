import 'server-only';

import type { VercelPoolClient } from '@/app/lib/db';

import { isAppRole, type AppRole } from './roles';
import { RECENT_MFA_WINDOW_SECONDS } from './session-policy';
import { isSessionReference } from './session-record';

const MANAGEMENT_MUTATION_LOCK = 'field-atlas:management-user-mutation';

type CurrentPrivilegedActor = {
  role: Extract<AppRole, 'admin' | 'owner'>;
};

/**
 * Re-establishes the privileged authorization boundary inside the mutation's
 * transaction. The render/JWT check is intentionally not trusted here: role,
 * account eligibility, the exact database session, and passkey freshness can
 * all change while a Server Action is waiting to mutate data.
 */
export async function lockCurrentPrivilegedActor(
  client: Pick<VercelPoolClient, 'query'>,
  {
    authenticatedAt,
    sessionReference,
    sessionVersion,
    userId,
  }: {
    authenticatedAt: number;
    sessionReference: string;
    sessionVersion: number;
    userId: string;
  },
): Promise<CurrentPrivilegedActor | undefined> {
  if (
    !Number.isSafeInteger(authenticatedAt) ||
    authenticatedAt <= 0 ||
    !Number.isSafeInteger(sessionVersion) ||
    sessionVersion < 0 ||
    !isSessionReference(sessionReference)
  ) {
    return undefined;
  }

  // Management mutations are deliberately low-volume. Serializing them
  // avoids cross-actor lock inversions while still allowing unrelated product
  // writes to proceed normally.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    MANAGEMENT_MUTATION_LOCK,
  ]);

  const result = await client.query<{ role: AppRole }>(
    `
      SELECT users.role
      FROM users
      INNER JOIN auth_sessions
        ON auth_sessions.user_id = users.id
       AND auth_sessions.session_hash = $2
      WHERE users.id = $1
        AND users.role IN ('admin'::user_role, 'owner'::user_role)
        AND users.account_status = 'active'
        AND users.email_verified_at IS NOT NULL
        AND users.session_version = $5
        AND auth_sessions.revoked_at IS NULL
        AND auth_sessions.absolute_expires_at > NOW()
        AND FLOOR(EXTRACT(EPOCH FROM auth_sessions.authenticated_at))::bigint = $3
        AND auth_sessions.mfa_method = 'passkey'
        AND auth_sessions.mfa_verified_at IS NOT NULL
        AND auth_sessions.mfa_verified_at <= NOW()
        AND auth_sessions.mfa_verified_at >=
          NOW() - ($4 * INTERVAL '1 second')
      FOR UPDATE OF users, auth_sessions
    `,
    [
      userId,
      sessionReference,
      authenticatedAt,
      RECENT_MFA_WINDOW_SECONDS,
      sessionVersion,
    ],
  );
  const role = result.rows[0]?.role;

  if (!isAppRole(role) || role === 'user') return undefined;

  return { role };
}

export async function lockPasswordResetLifecycle(
  client: Pick<VercelPoolClient, 'query'>,
  userId: string,
) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `password-reset-user:${userId}`,
  ]);
}
