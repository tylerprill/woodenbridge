import { z } from 'zod';

export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_CHARACTERS = 128;
export const MAX_PASSWORD_BYTES = MAX_PASSWORD_CHARACTERS * 4;

export function getPasswordCharacterCount(password: string) {
  return Array.from(password.normalize('NFC')).length;
}

function hasAllowedPasswordSize(password: string) {
  const characterCount = getPasswordCharacterCount(password);
  return (
    characterCount >= MIN_PASSWORD_LENGTH &&
    characterCount <= MAX_PASSWORD_CHARACTERS &&
    new TextEncoder().encode(password).byteLength <= MAX_PASSWORD_BYTES
  );
}

export const newPasswordSchema = z
  .string()
  .refine(
    hasAllowedPasswordSize,
    `Use between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_CHARACTERS} characters for your password.`,
  );

export const loginPasswordSchema = z
  .string()
  .min(1)
  .refine(
    (password) =>
      getPasswordCharacterCount(password) <= MAX_PASSWORD_CHARACTERS &&
      new TextEncoder().encode(password).byteLength <= MAX_PASSWORD_BYTES,
  );

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
