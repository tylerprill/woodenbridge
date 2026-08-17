import 'server-only';

import { hash, verify } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';

const ARGON2_OPTIONS = {
  algorithm: 2,
  version: 1,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$KGausNMsbBdxTEvVM37Uwg$j/3y5zD8k9xUZUXYQobK6NJezn1J33IRhSGhX25fluI';

export function normalizePasswordForHash(password: string) {
  return password.normalize('NFC');
}

export function isLegacyPasswordHash(passwordHash: string) {
  return passwordHash.startsWith('$2a$') || passwordHash.startsWith('$2b$');
}

export function needsPasswordRehash(passwordHash: string) {
  if (isLegacyPasswordHash(passwordHash)) return true;

  const parameters = passwordHash.match(
    /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/,
  );

  if (!parameters) return true;

  return (
    Number(parameters[1]) !== 19 ||
    Number(parameters[2]) !== ARGON2_OPTIONS.memoryCost ||
    Number(parameters[3]) !== ARGON2_OPTIONS.timeCost ||
    Number(parameters[4]) !== ARGON2_OPTIONS.parallelism
  );
}

export async function hashPassword(password: string) {
  return hash(normalizePasswordForHash(password), ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string) {
  try {
    if (passwordHash.startsWith('$argon2id$')) {
      return await verify(passwordHash, normalizePasswordForHash(password));
    }

    if (isLegacyPasswordHash(passwordHash)) {
      // Preserve the exact legacy input until a successful login migrates it.
      return await bcrypt.compare(password, passwordHash);
    }

    return false;
  } catch {
    return false;
  }
}
