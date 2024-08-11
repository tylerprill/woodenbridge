'use server';
import { signOut } from '@/auth';

export async function logOut(options?: { redirectTo?: string }) {
  await signOut(options);
}
