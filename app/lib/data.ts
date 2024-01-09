import { sql } from '@vercel/postgres';
import bcrypt from 'bcryptjs';
import { User } from './definitions';

export async function getUser(email: string) {
  try {
    const user = await sql`SELECT * FROM users WHERE email = ${email} `;
    return user.rows[0] as User;
  } catch (error) {
    console.error('Failed to fetch user:', error);
    throw new Error('Failed to fetch user.');
  }
}

export async function addUser(user: User) {
  try {
    const hashedPassword = await bcrypt.hash(user.password, 10);

    await sql`INSERT INTO users (first_name, last_name, email, password)
    VALUES (${user.first_name}, ${user.last_name}, ${user.email}, ${hashedPassword})
    ON CONFLICT (id) DO NOTHING;`;
  } catch (error) {
    console.error('Failed to add user:', error);
    throw new Error('Failed to add user.');
  }
}
