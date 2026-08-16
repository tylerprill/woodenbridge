import {
  createLoginErrorState,
  rememberedEmailSchema,
} from '@/app/lib/auth/login';
import {
  REMEMBERED_EMAIL_STORAGE_KEY,
  readRememberedEmail,
  writeRememberedEmail,
} from '@/app/lib/auth/remembered-email';

function createStorage() {
  const values = new Map<string, string>();

  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  };
}

describe('login recovery state', () => {
  it('returns only the email alongside a generic login error', () => {
    const state = createLoginErrorState(
      'explorer@example.com',
      'Either Email Address or Password were incorrect.',
    );

    expect(state.email).toBe('explorer@example.com');
    expect(state).not.toHaveProperty('password');
  });

  it('normalizes valid remembered email addresses', () => {
    expect(rememberedEmailSchema.parse('  Explorer@Example.COM  ')).toBe(
      'explorer@example.com',
    );
  });

  it('stores only a valid email and removes it when disabled', () => {
    const { storage, values } = createStorage();

    writeRememberedEmail(storage, 'Explorer@Example.COM');
    expect(values.get(REMEMBERED_EMAIL_STORAGE_KEY)).toBe(
      'explorer@example.com',
    );
    expect(readRememberedEmail(storage)).toBe('explorer@example.com');

    writeRememberedEmail(storage, undefined);
    expect(values.has(REMEMBERED_EMAIL_STORAGE_KEY)).toBe(false);
  });

  it('does not use malformed local-storage content', () => {
    const { storage, values } = createStorage();
    values.set(REMEMBERED_EMAIL_STORAGE_KEY, 'not-an-email');

    expect(readRememberedEmail(storage)).toBeUndefined();
  });
});
