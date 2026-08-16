import { z } from 'zod';

import { newPasswordSchema, normalizeEmail } from '@/app/lib/auth/password';

export type SignUpFields = {
  first_name: string;
  last_name: string;
  email: string;
};

export type SignUpInput = SignUpFields & {
  password: string;
  confirmPassword: string;
};

export type SignUpState =
  | {
      status: 'error';
      message: string;
      fields: SignUpFields;
      submission: number;
    }
  | undefined;

export const signUpSchema = z
  .object({
    first_name: z
      .string()
      .trim()
      .min(1, 'Enter your first name.')
      .max(100, 'Use no more than 100 characters for your first name.'),
    last_name: z
      .string()
      .trim()
      .min(1, 'Enter your last name.')
      .max(100, 'Use no more than 100 characters for your last name.'),
    email: z
      .string()
      .trim()
      .max(254, 'Enter a valid email address.')
      .email('Enter a valid email address.')
      .transform(normalizeEmail),
    password: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The passwords do not match.',
  });

export function getSignUpInput(formData: FormData): SignUpInput {
  return {
    first_name: String(formData.get('first_name') ?? ''),
    last_name: String(formData.get('last_name') ?? ''),
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
    confirmPassword: String(formData.get('confirmPassword') ?? ''),
  };
}

export function createSignUpErrorState(
  previousState: SignUpState,
  input: SignUpInput,
  message: string,
): Exclude<SignUpState, undefined> {
  return {
    status: 'error',
    message,
    fields: {
      first_name: input.first_name,
      last_name: input.last_name,
      email: input.email,
    },
    submission: (previousState?.submission ?? 0) + 1,
  };
}
