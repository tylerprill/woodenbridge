import type { AppRole } from './roles';

export type RoleChangeBlock =
  'self-protected' | 'protected-owner' | 'owner-required' | undefined;

export function getRoleChangeBlock({
  actorUserId,
  actorRole,
  targetUserId,
  currentRole,
  nextRole,
}: {
  actorUserId: string;
  actorRole: AppRole;
  targetUserId: string;
  currentRole: AppRole;
  nextRole: AppRole;
}): RoleChangeBlock {
  if (currentRole === 'owner') return 'protected-owner';
  if (actorUserId === targetUserId) return 'self-protected';
  if (actorRole !== 'owner') return 'owner-required';
  if (nextRole === 'owner') return 'protected-owner';

  return undefined;
}

export type SessionRevocationBlock =
  'self-protected' | 'protected-owner' | 'admin-peer-protected' | undefined;

export function getSessionRevocationBlock({
  actorUserId,
  actorRole,
  targetUserId,
  targetRole,
}: {
  actorUserId: string;
  actorRole: AppRole;
  targetUserId: string;
  targetRole: AppRole;
}): SessionRevocationBlock {
  if (targetRole === 'owner') return 'protected-owner';
  if (actorUserId === targetUserId) return 'self-protected';
  if (actorRole === 'admin' && targetRole === 'admin') {
    return 'admin-peer-protected';
  }

  return undefined;
}
