import { z } from 'zod';

export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_BYTES = 72;

export const newPasswordSchema = z
  .string()
  .min(
    MIN_PASSWORD_LENGTH,
    `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`,
  )
  .refine(
    (password) => Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES,
    `Use a password no longer than ${MAX_PASSWORD_BYTES} bytes.`,
  );

export const loginPasswordSchema = z
  .string()
  .min(1)
  .refine(
    (password) => Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES,
  );

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
