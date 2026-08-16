import type { AppRole } from './roles';

export type RoleChangeBlock =
  'self-protected' | 'last-owner-protected' | undefined;

export function getRoleChangeBlock({
  actorUserId,
  targetUserId,
  currentRole,
  nextRole,
  ownerCount,
}: {
  actorUserId: string;
  targetUserId: string;
  currentRole: AppRole;
  nextRole: AppRole;
  ownerCount: number;
}): RoleChangeBlock {
  if (actorUserId === targetUserId && nextRole !== 'owner') {
    return 'self-protected';
  }

  if (currentRole === 'owner' && nextRole === 'user' && ownerCount <= 1) {
    return 'last-owner-protected';
  }

  return undefined;
}
