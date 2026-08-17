import { sql } from '@/app/lib/db';

export async function upgradeUserPasswordHash(
  userId: string,
  previousHash: string,
  nextHash: string,
) {
  await sql`
    UPDATE users
    SET password = ${nextHash}
    WHERE id = ${userId} AND password = ${previousHash}
  `;
}
