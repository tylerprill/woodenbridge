import 'server-only';

import { sql } from '@vercel/postgres';

import { requireRole } from '@/app/lib/auth/session';
import type { AppRole } from '@/app/lib/auth/roles';

type OwnerUserRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  email_verified_at: Date | null;
  role: AppRole;
};

type OwnerUserCounts = {
  total: number;
  verified: number;
  admins: number;
  owners: number;
};

export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: AppRole;
};

export async function getManagedUsers(searchInput = '') {
  const session = await requireRole('admin');
  const search = searchInput.trim().slice(0, 100);
  const pattern = `%${search}%`;

  const [usersResult, countsResult] = await Promise.all([
    search
      ? sql<OwnerUserRow>`
          SELECT id, first_name, last_name, email, email_verified_at, role
          FROM users
          WHERE email ILIKE ${pattern}
             OR CONCAT_WS(' ', first_name, last_name) ILIKE ${pattern}
          ORDER BY LOWER(email)
          LIMIT 100
        `
      : sql<OwnerUserRow>`
          SELECT id, first_name, last_name, email, email_verified_at, role
          FROM users
          ORDER BY LOWER(email)
          LIMIT 100
        `,
    sql<OwnerUserCounts>`
      SELECT
        COUNT(*)::integer AS total,
        COUNT(*) FILTER (WHERE email_verified_at IS NOT NULL)::integer AS verified,
        COUNT(*) FILTER (WHERE role = 'admin')::integer AS admins,
        COUNT(*) FILTER (WHERE role = 'owner')::integer AS owners
      FROM users
    `,
  ]);

  const counts = countsResult.rows[0] ?? {
    total: 0,
    verified: 0,
    admins: 0,
    owners: 0,
  };

  return {
    currentUserId: session.user.id,
    currentRole: session.role,
    counts,
    users: usersResult.rows.map<ManagedUser>((user) => ({
      id: user.id,
      name:
        `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() ||
        'Unnamed explorer',
      email: user.email,
      emailVerified: Boolean(user.email_verified_at),
      role: user.role,
    })),
  };
}
