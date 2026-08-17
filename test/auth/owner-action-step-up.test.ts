import { db } from '@vercel/postgres';

import {
  revokeManagedUserSessions,
  setManagedUserAccountStatus,
  setManagedUserRole,
} from '@/app/lib/actions/owner-users';
import { requirePrivilegedStepUp } from '@/app/lib/auth/session';

jest.mock('@vercel/postgres', () => ({
  db: { connect: jest.fn() },
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

const connectMock = jest.mocked(db.connect);
const requireStepUpMock = jest.mocked(requirePrivilegedStepUp);

describe('management Server Action step-up boundary', () => {
  beforeEach(() => {
    requireStepUpMock.mockRejectedValue(new Error('step-up-required'));
  });

  it.each([
    ['role changes', setManagedUserRole, { role: 'admin' }],
    ['session revocation', revokeManagedUserSessions, {}],
    [
      'account suspension',
      setManagedUserAccountStatus,
      { status: 'suspended' },
    ],
  ])(
    'blocks direct %s before opening a database transaction',
    async (_, action, fields) => {
      const formData = new FormData();
      formData.set('targetUserId', 'd4160292-6500-49c1-a2fd-82916d0e5673');

      for (const [name, value] of Object.entries(fields)) {
        formData.set(name, value);
      }

      await expect(action(formData)).rejects.toThrow('step-up-required');
      expect(requireStepUpMock).toHaveBeenCalledTimes(1);
      expect(connectMock).not.toHaveBeenCalled();
    },
  );
});
