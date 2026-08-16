import { sql } from '@vercel/postgres';
import { NewUser, User } from './definitions';
import { normalizeEmail } from './auth/password';

export async function getUser(email: string) {
  try {
    const user = await sql`
      SELECT id, first_name, last_name, email, password, email_verified_at
      FROM users
      WHERE LOWER(email) = ${normalizeEmail(email)}
      LIMIT 1
    `;
    return user.rows[0] as User;
  } catch (error) {
    console.error('Failed to fetch user:', error);
    throw new Error('Failed to fetch user.');
  }
}

export async function addUser(user: NewUser, passwordHash: string) {
  try {
    const result = await sql<Pick<User, 'id'>>`
      INSERT INTO users (first_name, last_name, email, password)
      VALUES (
        ${user.first_name},
        ${user.last_name},
        ${normalizeEmail(user.email)},
        ${passwordHash}
      )
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `;

    return result.rows[0];
  } catch (error) {
    console.error('Failed to add user:', error);
    throw new Error('Failed to add user.');
  }
}

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
