'use server';

import { db } from '@vercel/postgres';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import type { AppRole } from '@/app/lib/auth/roles';
import {
  getRoleChangeBlock,
  getSessionRevocationBlock,
} from '@/app/lib/auth/owner-user-policy';
import { requireRole } from '@/app/lib/auth/session';
import { recordSecurityEvent } from '@/app/lib/auth/security-events';

const OWNER_USERS_PATH = '/dashboard/owner/users';
const targetUserSchema = z.string().uuid();
const MANAGED_ROLES = ['user', 'admin'] as const;
const roleChangeSchema = z.object({
  targetUserId: targetUserSchema,
  role: z.enum(MANAGED_ROLES),
});

type ActionResult =
  | 'role-updated'
  | 'no-change'
  | 'sessions-revoked'
  | 'self-protected'
  | 'protected-owner'
  | 'owner-required'
  | 'admin-peer-protected'
  | 'not-found'
  | 'invalid'
  | 'failed';

function resultUrl(result: ActionResult) {
  const kind = ['role-updated', 'sessions-revoked', 'no-change'].includes(
    result,
  )
    ? 'notice'
    : 'error';
  return `${OWNER_USERS_PATH}?${kind}=${result}`;
}

export async function setManagedUserRole(formData: FormData) {
  const session = await requireRole('admin');
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
        actorRole: session.role,
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
        result = 'role-updated';
        roleChanged = true;
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
  const session = await requireRole('admin');
  const parsedTarget = targetUserSchema.safeParse(formData.get('targetUserId'));

  if (!parsedTarget.success) redirect(resultUrl('invalid'));

  const targetUserId = parsedTarget.data;
  const client = await db.connect();
  let result: ActionResult = 'failed';

  try {
    await client.query('BEGIN');
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
        actorRole: session.role,
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
        result = 'sessions-revoked';
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
