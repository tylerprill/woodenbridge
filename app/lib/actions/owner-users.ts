'use server';

import { randomUUID } from 'node:crypto';

import { db } from '@/app/lib/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import type { AccountStatus } from '@/app/lib/auth/account-status';
import type { AppRole } from '@/app/lib/auth/roles';
import {
  getAccountStatusChangeBlock,
  getRoleChangeBlock,
  getSessionRevocationBlock,
} from '@/app/lib/auth/owner-user-policy';
import {
  lockCurrentPrivilegedActor,
  lockPasswordResetLifecycle,
} from '@/app/lib/auth/privileged-action-authorization';
import { invalidateRecoveryStateWithinTransaction } from '@/app/lib/auth/recovery-codes';
import { requirePrivilegedStepUp } from '@/app/lib/auth/session';
import { recordSecurityEvent } from '@/app/lib/auth/security-events';
import { enqueueSecurityNotificationWithinTransaction } from '@/app/lib/auth/security-notification-outbox';
import { scheduleSecurityNotificationDelivery } from '@/app/lib/auth/security-notification-scheduler';

const OWNER_USERS_PATH = '/dashboard/owner/users';
const targetUserSchema = z.string().uuid();
const MANAGED_ROLES = ['user', 'admin'] as const;
const roleChangeSchema = z.object({
  targetUserId: targetUserSchema,
  role: z.enum(MANAGED_ROLES),
});
const managedAccountStatusSchema = z.object({
  targetUserId: targetUserSchema,
  status: z.enum(['active', 'suspended']),
});

type ActionResult =
  | 'role-updated'
  | 'no-change'
  | 'sessions-revoked'
  | 'account-suspended'
  | 'account-reactivated'
  | 'self-protected'
  | 'protected-owner'
  | 'owner-required'
  | 'admin-peer-protected'
  | 'closed-account'
  | 'not-found'
  | 'invalid'
  | 'failed';

function resultUrl(result: ActionResult) {
  const kind = [
    'role-updated',
    'sessions-revoked',
    'account-suspended',
    'account-reactivated',
    'no-change',
  ].includes(result)
    ? 'notice'
    : 'error';
  return `${OWNER_USERS_PATH}?${kind}=${result}`;
}

export async function setManagedUserRole(formData: FormData) {
  const session = await requirePrivilegedStepUp();
  const parsed = roleChangeSchema.safeParse({
    targetUserId: formData.get('targetUserId'),
    role: formData.get('role'),
  });

  if (!parsed.success) redirect(resultUrl('invalid'));

  const { targetUserId, role } = parsed.data;
  const client = await db.connect();
  let result: ActionResult = 'failed';
  let roleChanged = false;

  try {
    await client.query('BEGIN');
    const actor = await lockCurrentPrivilegedActor(client, {
      authenticatedAt: session.authenticatedAt,
      sessionReference: session.sessionReference,
      sessionVersion: session.sessionVersion,
      userId: session.user.id,
    });

    if (!actor) {
      result = 'failed';
    } else {
      const targetResult = await client.query<{
        role: AppRole;
      }>('SELECT role FROM users WHERE id = $1 FOR UPDATE', [targetUserId]);
      const target = targetResult.rows[0];

      if (!target) {
        result = 'not-found';
      } else if (target.role === role) {
        result = 'no-change';
      } else {
        const policyBlock = getRoleChangeBlock({
          actorUserId: session.user.id,
          actorRole: actor.role,
          targetUserId,
          currentRole: target.role,
          nextRole: role,
        });

        if (policyBlock) {
          result = policyBlock;
        } else {
          await client.query(
            `
              UPDATE users
              SET role = $2::user_role,
                  session_version = session_version + 1
              WHERE id = $1
            `,
            [targetUserId, role],
          );
          await client.query(
            `
              UPDATE auth_sessions
              SET revoked_at = COALESCE(revoked_at, clock_timestamp())
              WHERE user_id = $1
                AND revoked_at IS NULL
            `,
            [targetUserId],
          );
          if (role === 'user') {
            await invalidateRecoveryStateWithinTransaction(
              client,
              targetUserId,
            );
          }
          result = 'role-updated';
          roleChanged = true;
        }
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Management role update failed:', error);
    result = 'failed';
  } finally {
    client.release();
  }

  if (roleChanged && result === 'role-updated') {
    recordSecurityEvent('management.user_role_changed', 'success', {
      actorUserId: session.user.id,
      targetUserId,
      targetRole: role,
    });
  }

  revalidatePath(OWNER_USERS_PATH);
  redirect(resultUrl(result));
}

export async function revokeManagedUserSessions(formData: FormData) {
  const session = await requirePrivilegedStepUp();
  const parsedTarget = targetUserSchema.safeParse(formData.get('targetUserId'));

  if (!parsedTarget.success) redirect(resultUrl('invalid'));

  const targetUserId = parsedTarget.data;
  const client = await db.connect();
  let result: ActionResult = 'failed';

  try {
    await client.query('BEGIN');
    const actor = await lockCurrentPrivilegedActor(client, {
      authenticatedAt: session.authenticatedAt,
      sessionReference: session.sessionReference,
      sessionVersion: session.sessionVersion,
      userId: session.user.id,
    });

    if (!actor) {
      result = 'failed';
    } else {
      const targetResult = await client.query<{ role: AppRole }>(
        'SELECT role FROM users WHERE id = $1 FOR UPDATE',
        [targetUserId],
      );
      const target = targetResult.rows[0];

      if (!target) {
        result = 'not-found';
      } else {
        const policyBlock = getSessionRevocationBlock({
          actorUserId: session.user.id,
          actorRole: actor.role,
          targetUserId,
          targetRole: target.role,
        });

        if (policyBlock) {
          result = policyBlock;
        } else {
          await client.query(
            `
              UPDATE users
              SET session_version = session_version + 1
              WHERE id = $1
            `,
            [targetUserId],
          );
          await client.query(
            `
              UPDATE auth_sessions
              SET revoked_at = COALESCE(revoked_at, clock_timestamp())
              WHERE user_id = $1
                AND revoked_at IS NULL
            `,
            [targetUserId],
          );
          result = 'sessions-revoked';
        }
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Management session revocation failed:', error);
    result = 'failed';
  } finally {
    client.release();
  }

  if (result === 'sessions-revoked') {
    recordSecurityEvent('management.sessions_revoked', 'success', {
      actorUserId: session.user.id,
      targetUserId,
    });
  }

  revalidatePath(OWNER_USERS_PATH);
  redirect(resultUrl(result));
}

export async function setManagedUserAccountStatus(formData: FormData) {
  const session = await requirePrivilegedStepUp();
  const parsed = managedAccountStatusSchema.safeParse({
    targetUserId: formData.get('targetUserId'),
    status: formData.get('status'),
  });

  if (!parsed.success) redirect(resultUrl('invalid'));

  const { targetUserId, status } = parsed.data;
  const client = await db.connect();
  let result: ActionResult = 'failed';
  let statusChanged = false;
  const statusChangeId = randomUUID();

  try {
    await client.query('BEGIN');
    const actor = await lockCurrentPrivilegedActor(client, {
      authenticatedAt: session.authenticatedAt,
      sessionReference: session.sessionReference,
      sessionVersion: session.sessionVersion,
      userId: session.user.id,
    });

    if (!actor) {
      result = 'failed';
    } else if (targetUserId === session.user.id) {
      result =
        status === 'active'
          ? 'no-change'
          : (getAccountStatusChangeBlock({
              actorUserId: session.user.id,
              actorRole: actor.role,
              targetUserId,
              targetRole: actor.role,
              currentStatus: 'active',
            }) ?? 'self-protected');
    } else {
      // Reset issuance/redemption takes this account-scoped lock before the
      // user row. Keep the same order here to make suspension atomic without
      // creating a lock inversion.
      if (status === 'suspended') {
        await lockPasswordResetLifecycle(client, targetUserId);
      }

      const targetResult = await client.query<{
        role: AppRole;
        account_status: AccountStatus;
        email: string;
        first_name: string;
      }>(
        'SELECT role, account_status, email, first_name FROM users WHERE id = $1 FOR UPDATE',
        [targetUserId],
      );
      const target = targetResult.rows[0];

      if (!target) {
        result = 'not-found';
      } else if (target.account_status === status) {
        result = 'no-change';
      } else {
        const policyBlock = getAccountStatusChangeBlock({
          actorUserId: session.user.id,
          actorRole: actor.role,
          targetUserId,
          targetRole: target.role,
          currentStatus: target.account_status,
        });

        if (policyBlock) {
          result = policyBlock;
        } else {
          await client.query(
            `
              UPDATE users
              SET account_status = $2::account_status,
                  session_version = session_version + 1
              WHERE id = $1
            `,
            [targetUserId, status],
          );
          await client.query(
            `
              UPDATE auth_sessions
              SET revoked_at = COALESCE(revoked_at, clock_timestamp())
              WHERE user_id = $1
                AND revoked_at IS NULL
            `,
            [targetUserId],
          );
          if (status === 'suspended') {
            await client.query(
              `
                UPDATE password_reset_tokens
                SET used_at = clock_timestamp()
                WHERE user_id = $1
                  AND used_at IS NULL
              `,
              [targetUserId],
            );
            await invalidateRecoveryStateWithinTransaction(
              client,
              targetUserId,
            );
          }
          result =
            status === 'suspended'
              ? 'account-suspended'
              : 'account-reactivated';
          await enqueueSecurityNotificationWithinTransaction(client, {
            userId: targetUserId,
            kind: 'account_status_changed',
            changeId: statusChangeId,
            payload: { status },
          });
          statusChanged = true;
        }
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Management account status update failed:', error);
    result = 'failed';
  } finally {
    client.release();
  }

  if (statusChanged) {
    recordSecurityEvent('management.account_status_changed', 'success', {
      actorUserId: session.user.id,
      targetUserId,
      accountStatus: status,
    });
    scheduleSecurityNotificationDelivery();
  }

  revalidatePath(OWNER_USERS_PATH);
  redirect(resultUrl(result));
}
