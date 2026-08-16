import { sql } from '@vercel/postgres';
import bcrypt from 'bcryptjs';
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

export async function addUser(user: NewUser) {
  try {
    const hashedPassword = await bcrypt.hash(user.password, 12);

    const result = await sql<Pick<User, 'id'>>`
      INSERT INTO users (first_name, last_name, email, password)
      VALUES (
        ${user.first_name},
        ${user.last_name},
        ${normalizeEmail(user.email)},
        ${hashedPassword}
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
