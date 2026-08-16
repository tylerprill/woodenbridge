import { z } from 'zod';

export type LoginState =
  | {
      status: 'error';
      message: string;
      email: string;
    }
  | undefined;

export function getLoginEmail(formData: FormData) {
  return String(formData.get('email') ?? '')
    .trim()
    .slice(0, 254);
}

export function createLoginErrorState(
  email: string,
  message: string,
): Exclude<LoginState, undefined> {
  return {
    status: 'error',
    message,
    email,
  };
}

export const rememberedEmailSchema = z
  .string()
  .trim()
  .max(254)
  .email()
  .transform((email) => email.toLowerCase());
