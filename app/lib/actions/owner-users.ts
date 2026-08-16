'use server';

import { db } from '@vercel/postgres';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { APP_ROLES, type AppRole } from '@/app/lib/auth/roles';
import { getRoleChangeBlock } from '@/app/lib/auth/owner-user-policy';
import { requireOwnerSession } from '@/app/lib/auth/session';
import { recordSecurityEvent } from '@/app/lib/auth/security-events';

const OWNER_USERS_PATH = '/dashboard/owner/users';
const targetUserSchema = z.string().uuid();
const roleChangeSchema = z.object({
  targetUserId: targetUserSchema,
  role: z.enum(APP_ROLES),
});

type ActionResult =
  | 'role-updated'
  | 'no-change'
  | 'sessions-revoked'
  | 'self-protected'
  | 'last-owner-protected'
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
  const session = await requireOwnerSession();
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
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('wooden_bridge_owner_roles'))",
    );

    const targetResult = await client.query<{
      email: string;
      role: AppRole;
    }>('SELECT email, role FROM users WHERE id = $1 FOR UPDATE', [
      targetUserId,
    ]);
    const target = targetResult.rows[0];

    if (!target) {
      result = 'not-found';
    } else if (target.role === role) {
      result = 'no-change';
    } else {
      const ownerCount = await client.query<{ count: number }>(
        "SELECT COUNT(*)::integer AS count FROM users WHERE role = 'owner'",
      );
      const policyBlock = getRoleChangeBlock({
        actorUserId: session.user.id,
        targetUserId,
        currentRole: target.role,
        nextRole: role,
        ownerCount: ownerCount.rows[0]?.count ?? 0,
      });

      if (policyBlock) result = policyBlock;

      if (!policyBlock) {
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
    console.error('Owner role update failed:', error);
    result = 'failed';
  } finally {
    client.release();
  }

  if (roleChanged && result === 'role-updated') {
    recordSecurityEvent('owner.user_role_changed', 'success', {
      actorUserId: session.user.id,
      targetUserId,
      targetRole: role,
    });
  }

  revalidatePath(OWNER_USERS_PATH);
  redirect(resultUrl(result));
}

export async function revokeManagedUserSessions(formData: FormData) {
  const session = await requireOwnerSession();
  const parsedTarget = targetUserSchema.safeParse(formData.get('targetUserId'));

  if (!parsedTarget.success) redirect(resultUrl('invalid'));

  const targetUserId = parsedTarget.data;
  if (targetUserId === session.user.id) redirect(resultUrl('self-protected'));

  let actionResult: ActionResult = 'failed';

  try {
    const updateResult = await db.query(
      `
        UPDATE users
        SET session_version = session_version + 1
        WHERE id = $1
        RETURNING id
      `,
      [targetUserId],
    );

    if (updateResult.rowCount === 0) {
      actionResult = 'not-found';
    } else {
      actionResult = 'sessions-revoked';
      recordSecurityEvent('owner.sessions_revoked', 'success', {
        actorUserId: session.user.id,
        targetUserId,
      });
    }
  } catch (error) {
    console.error('Owner session revocation failed:', error);
    actionResult = 'failed';
  }

  revalidatePath(OWNER_USERS_PATH);
  redirect(resultUrl(actionResult));
}
