export const APP_ROLES = ['user', 'admin', 'owner'] as const;

export type AppRole = (typeof APP_ROLES)[number];

const roleRank: Record<AppRole, number> = {
  user: 0,
  admin: 1,
  owner: 2,
};

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && APP_ROLES.includes(value as AppRole);
}

export function hasRequiredRole(currentRole: AppRole, requiredRole: AppRole) {
  return roleRank[currentRole] >= roleRank[requiredRole];
}
