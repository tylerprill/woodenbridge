import bcrypt from 'bcryptjs';

import {
  MAX_PASSWORD_CHARACTERS,
  MIN_PASSWORD_LENGTH,
  getPasswordCharacterCount,
  newPasswordSchema,
} from '@/app/lib/auth/password';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  isLegacyPasswordHash,
  needsPasswordRehash,
  verifyPassword,
} from '@/app/lib/auth/password-hash';

describe('password policy and storage', () => {
  it('enforces the character boundaries by Unicode code point', () => {
    expect(
      newPasswordSchema.safeParse('a'.repeat(MIN_PASSWORD_LENGTH - 1)).success,
    ).toBe(false);
    expect(
      newPasswordSchema.safeParse('a'.repeat(MIN_PASSWORD_LENGTH)).success,
    ).toBe(true);
    expect(
      newPasswordSchema.safeParse('🪵'.repeat(MAX_PASSWORD_CHARACTERS)).success,
    ).toBe(true);
    expect(
      newPasswordSchema.safeParse('a'.repeat(MAX_PASSWORD_CHARACTERS + 1))
        .success,
    ).toBe(false);
    expect(getPasswordCharacterCount('e\u0301')).toBe(1);
  });

  it('hashes new passwords with Argon2id and normalizes equivalent Unicode', async () => {
    const passwordHash = await hashPassword(
      `walk-across-caf\u00e9-${'x'.repeat(8)}`,
    );

    expect(passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(
      verifyPassword(passwordHash, `walk-across-cafe\u0301-${'x'.repeat(8)}`),
    ).resolves.toBe(true);
    await expect(
      verifyPassword(passwordHash, 'a different password'),
    ).resolves.toBe(false);
  });

  it('accepts legacy bcrypt hashes only for migration after a valid login', async () => {
    const legacyHash = await bcrypt.hash(
      'a sufficiently long old password',
      10,
    );

    expect(isLegacyPasswordHash(legacyHash)).toBe(true);
    expect(needsPasswordRehash(legacyHash)).toBe(true);
    await expect(
      verifyPassword(legacyHash, 'a sufficiently long old password'),
    ).resolves.toBe(true);
    await expect(
      verifyPassword(legacyHash, 'incorrect password'),
    ).resolves.toBe(false);
  });

  it('identifies Argon2 hashes that need the current work-factor policy', async () => {
    const currentHash = await hashPassword('a sufficiently long new password');

    expect(needsPasswordRehash(currentHash)).toBe(false);
    expect(
      needsPasswordRehash(
        currentHash.replace('m=19456,t=2,p=1', 'm=12288,t=3,p=1'),
      ),
    ).toBe(true);
    expect(needsPasswordRehash('not-a-supported-password-hash')).toBe(true);
  });

  it('uses a valid dummy hash for unknown-account timing work', async () => {
    await expect(
      verifyPassword(DUMMY_PASSWORD_HASH, 'definitely not the dummy password'),
    ).resolves.toBe(false);
  });
});
