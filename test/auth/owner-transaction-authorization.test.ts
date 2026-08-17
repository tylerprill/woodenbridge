import { db } from '@vercel/postgres';

import {
  revokeManagedUserSessions,
  setManagedUserAccountStatus,
  setManagedUserRole,
} from '@/app/lib/actions/owner-users';
import { requirePrivilegedStepUp } from '@/app/lib/auth/session';

const queryMock = jest.fn();
const releaseMock = jest.fn();

jest.mock('@vercel/postgres', () => ({
  db: {
    connect: jest.fn(async () => ({
      query: queryMock,
      release: releaseMock,
    })),
  },
}));

jest.mock('@/app/lib/auth/session', () => ({
  requirePrivilegedStepUp: jest.fn(),
}));

jest.mock('@/app/lib/auth/security-events', () => ({
  recordSecurityEvent: jest.fn(),
}));

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  redirect: jest.fn((destination: string) => {
    throw new Error(`redirect:${destination}`);
  }),
}));

describe('management mutation transaction authorization', () => {
  beforeEach(() => {
    jest.mocked(requirePrivilegedStepUp).mockResolvedValue({
      authenticatedAt: 1_765_000_000,
      sessionReference: 'a'.repeat(64),
      sessionVersion: 0,
      user: { id: '3d006a3a-671f-44a2-819c-ad817c4c1d74' },
      role: 'owner',
    } as never);
    queryMock.mockImplementation(async (query: string) => {
      if (query.includes('SELECT users.role')) return { rows: [] };
      return { rows: [] };
    });
  });

  it.each([
    ['role change', setManagedUserRole, { role: 'admin' }],
    ['session revocation', revokeManagedUserSessions, {}],
    [
      'account suspension',
      setManagedUserAccountStatus,
      { status: 'suspended' },
    ],
  ])(
    'blocks a %s when the already-checked actor is stale before mutation',
    async (_, action, fields) => {
      const formData = new FormData();
      formData.set('targetUserId', 'd4160292-6500-49c1-a2fd-82916d0e5673');
      for (const [name, value] of Object.entries(fields)) {
        formData.set(name, value);
      }

      await expect(action(formData)).rejects.toThrow(
        'redirect:/dashboard/owner/users?error=failed',
      );

      const statements = queryMock.mock.calls.map(([query]) => String(query));
      const begin = statements.findIndex((query) => query === 'BEGIN');
      const managementLock = statements.findIndex((query) =>
        query.includes('pg_advisory_xact_lock'),
      );
      const actorAuthorization = statements.findIndex((query) =>
        query.includes('SELECT users.role'),
      );
      const commit = statements.findIndex((query) => query === 'COMMIT');

      expect(begin).toBe(0);
      expect(managementLock).toBeGreaterThan(begin);
      expect(actorAuthorization).toBeGreaterThan(managementLock);
      expect(commit).toBeGreaterThan(actorAuthorization);
      expect(
        statements.some((query) =>
          query.includes('SELECT role FROM users WHERE id = $1 FOR UPDATE'),
        ),
      ).toBe(false);
      expect(
        statements.some((query) =>
          query.includes('SELECT role, account_status'),
        ),
      ).toBe(false);
      expect(statements.some((query) => query.includes('UPDATE users'))).toBe(
        false,
      );
      expect(
        statements.some((query) => query.includes('UPDATE auth_sessions')),
      ).toBe(false);
      expect(db.connect).toHaveBeenCalledTimes(1);
      expect(releaseMock).toHaveBeenCalledTimes(1);
    },
  );
});
