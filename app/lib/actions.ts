'use server';

import { signIn } from '@/auth';
import { AuthError } from 'next-auth';

import { z } from 'zod';
import { getUser, addUser } from './data';
import { User } from './definitions';

export async function authenticate(
  prevState: string | undefined,
  formData: FormData,
) {
  try {
    await signIn('credentials', formData);
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin':
          return 'Either Email Address or Password were incorrect.';
        default:
          return 'Something went wrong.';
      }
    }
    throw error;
  }
}

export async function checkRecoveryOptions(
  prevState: string | undefined,
  formData: FormData,
) {
  const parsedEmail = z
    .string()
    .trim()
    .email('Enter a valid email address.')
    .safeParse(formData.get('email'));

  if (!parsedEmail.success) {
    return parsedEmail.error.issues[0]?.message ?? 'Check your email address.';
  }

  return 'Recovery email delivery is not connected yet, so no message was sent. Your account and password are unchanged.';
}

export async function createUser(
  prevState: string | undefined,
  formData: FormData,
) {
  const potentialUser = {
    first_name: String(formData.get('first_name') ?? ''),
    last_name: String(formData.get('last_name') ?? ''),
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  };

  const parsedCredentials = z
    .object({
      first_name: z.string().trim().min(1, 'Enter your first name.'),
      last_name: z.string().trim().min(1, 'Enter your last name.'),
      email: z.string().trim().email('Enter a valid email address.'),
      password: z
        .string()
        .min(6, 'Use at least 6 characters for your password.'),
    })
    .safeParse(potentialUser);

  if (!parsedCredentials.success) {
    return parsedCredentials.error.issues[0]?.message ?? 'Check your details.';
  }

  const user = parsedCredentials.data as User;
  const existingUser = await getUser(user.email);

  if (existingUser) {
    return 'An account already exists for this email address.';
  }

  formData.set('first_name', user.first_name);
  formData.set('last_name', user.last_name);
  formData.set('email', user.email);

  await addUser(user);
  await signIn('credentials', formData);
}
