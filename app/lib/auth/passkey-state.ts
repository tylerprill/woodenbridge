import 'server-only';

import { sql } from '@/app/lib/db';

export async function hasUserPasskey(userId: string) {
  const result = await sql`
    SELECT 1
    FROM user_passkeys
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  return result.rowCount === 1;
}
