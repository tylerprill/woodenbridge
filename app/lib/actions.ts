'use server';

import { auth, signIn } from '@/auth';
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
          return 'Invalid credentials.';
        default:
          return 'Something went wrong.';
      }
    }
    throw error;
  }
}

export async function createUser(
  prevState: string | undefined,
  formData: FormData,
) {
  const potentialUser = {
    first_name: formData.get('first_name'),
    last_name: formData.get('last_name'),
    email: formData.get('email'),
    password: formData.get('password'),
  } as User;

  const parsedCredentials = z
    .object({
      first_name: z.string().min(1),
      last_name: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(6),
    })
    .safeParse(potentialUser);

  if (parsedCredentials.success) {
    console.log('success');
    console.log('Emaiil', potentialUser.email);

    const existingUsers = await getUser(potentialUser.email);
    console.log('Existing User', existingUsers);

    if (existingUsers) {
      return 'Email address is already in use.';
    }

    await addUser(potentialUser);
    console.log('Successfully added user');
    await signIn('credentials', formData);
  }
}
