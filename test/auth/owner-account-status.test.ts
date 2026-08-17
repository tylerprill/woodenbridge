import { db } from '@vercel/postgres';

import {
  setManagedUserAccountStatus,
  setManagedUserRole,
} from '@/app/lib/actions/owner-users';
import { recordSecurityEvent } from '@/app/lib/auth/security-events';
import { scheduleSecurityNotificationDelivery } from '@/app/lib/auth/security-notification-scheduler';
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
jest.mock('@/app/lib/auth/security-notification-scheduler', () => ({
  scheduleSecurityNotificationDelivery: jest.fn(),
}));

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  redirect: jest.fn((destination: string) => {
    throw new Error(`redirect:${destination}`);
  }),
}));

describe('managed account suspension', () => {
  beforeEach(() => {
    jest.mocked(requirePrivilegedStepUp).mockResolvedValue({
      authenticatedAt: 1_765_000_000,
      sessionReference: 'a'.repeat(64),
      sessionVersion: 0,
      user: { id: '3d006a3a-671f-44a2-819c-ad817c4c1d74' },
      role: 'owner',
    } as never);
    queryMock.mockImplementation(async (query: string) => {
      if (query.includes('SELECT users.role')) {
        return { rows: [{ role: 'owner' }] };
      }
      if (query.includes('SELECT role, account_status')) {
        return {
          rows: [
            {
              role: 'user',
              account_status: 'active',
              email: 'traveler@example.com',
              first_name: 'Field',
            },
          ],
        };
      }
      if (query.includes('SELECT role FROM users')) {
        return { rows: [{ role: 'admin' }] };
      }

      return { rows: [] };
    });
  });

  it('revokes every server session in the same transaction that suspends access', async () => {
    const targetUserId = 'd4160292-6500-49c1-a2fd-82916d0e5673';
    const formData = new FormData();
    formData.set('targetUserId', targetUserId);
    formData.set('status', 'suspended');

    await expect(setManagedUserAccountStatus(formData)).rejects.toThrow(
      'redirect:/dashboard/owner/users?notice=account-suspended',
    );

    const statements = queryMock.mock.calls.map(([query]) => String(query));
    const actorAuthorization = statements.findIndex((query) =>
      query.includes('SELECT users.role'),
    );
    const resetLifecycleLock = statements.findIndex(
      (query, index) =>
        index > actorAuthorization &&
        query.includes('pg_advisory_xact_lock') &&
        queryMock.mock.calls[index]?.[1]?.includes(
          `password-reset-user:${targetUserId}`,
        ),
    );
    const targetLock = statements.findIndex((query) =>
      query.includes('SELECT role, account_status'),
    );
    const statusUpdate = statements.findIndex((query) =>
      query.includes('SET account_status = $2::account_status'),
    );
    const sessionRevocation = statements.findIndex((query) =>
      query.includes('UPDATE auth_sessions'),
    );
    const recoverySetRevocation = statements.findIndex((query) =>
      query.includes('UPDATE privileged_recovery_code_sets'),
    );
    const passwordResetInvalidation = statements.findIndex((query) =>
      query.includes('UPDATE password_reset_tokens'),
    );
    const recoveryGrantRevocation = statements.findIndex((query) =>
      query.includes('UPDATE privileged_passkey_recovery_grants'),
    );
    const notificationEnqueue = statements.findIndex((query) =>
      query.includes('INSERT INTO security_notification_outbox'),
    );
    const commit = statements.findIndex((query) => query === 'COMMIT');

    expect(actorAuthorization).toBeGreaterThan(0);
    expect(resetLifecycleLock).toBeGreaterThan(actorAuthorization);
    expect(targetLock).toBeGreaterThan(resetLifecycleLock);
    expect(statusUpdate).toBeGreaterThan(targetLock);
    expect(sessionRevocation).toBeGreaterThan(statusUpdate);
    expect(passwordResetInvalidation).toBeGreaterThan(sessionRevocation);
    expect(recoverySetRevocation).toBeGreaterThan(passwordResetInvalidation);
    expect(recoveryGrantRevocation).toBeGreaterThan(recoverySetRevocation);
    expect(notificationEnqueue).toBeGreaterThan(recoveryGrantRevocation);
    expect(commit).toBeGreaterThan(notificationEnqueue);
    expect(queryMock.mock.calls[statusUpdate]?.[1]).toEqual([
      targetUserId,
      'suspended',
    ]);
    expect(recordSecurityEvent).toHaveBeenCalledWith(
      'management.account_status_changed',
      'success',
      expect.objectContaining({
        targetUserId,
        accountStatus: 'suspended',
      }),
    );
    expect(scheduleSecurityNotificationDelivery).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[notificationEnqueue]?.[1]).toEqual([
      targetUserId,
      'account_status_changed',
      expect.any(String),
      JSON.stringify({ status: 'suspended' }),
    ]);
    expect(db.connect).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('invalidates recovery codes and grants in the admin-demotion transaction', async () => {
    const targetUserId = 'd4160292-6500-49c1-a2fd-82916d0e5673';
    const formData = new FormData();
    formData.set('targetUserId', targetUserId);
    formData.set('role', 'user');

    await expect(setManagedUserRole(formData)).rejects.toThrow(
      'redirect:/dashboard/owner/users?notice=role-updated',
    );

    const statements = queryMock.mock.calls.map(([query]) => String(query));
    const roleUpdate = statements.findIndex((query) =>
      query.includes('SET role = $2::user_role'),
    );
    const sessionRevocation = statements.findIndex((query) =>
      query.includes('UPDATE auth_sessions'),
    );
    const recoverySetRevocation = statements.findIndex((query) =>
      query.includes('UPDATE privileged_recovery_code_sets'),
    );
    const recoveryGrantRevocation = statements.findIndex((query) =>
      query.includes('UPDATE privileged_passkey_recovery_grants'),
    );
    const commit = statements.findIndex((query) => query === 'COMMIT');

    expect(roleUpdate).toBeGreaterThan(0);
    expect(sessionRevocation).toBeGreaterThan(roleUpdate);
    expect(recoverySetRevocation).toBeGreaterThan(sessionRevocation);
    expect(recoveryGrantRevocation).toBeGreaterThan(recoverySetRevocation);
    expect(commit).toBeGreaterThan(recoveryGrantRevocation);
  });

  it('fails generically without touching the target when the actor becomes stale inside the transaction', async () => {
    queryMock.mockImplementation(async (query: string) => {
      if (query.includes('SELECT users.role')) return { rows: [] };
      return { rows: [] };
    });
    const formData = new FormData();
    formData.set('targetUserId', 'd4160292-6500-49c1-a2fd-82916d0e5673');
    formData.set('status', 'suspended');

    await expect(setManagedUserAccountStatus(formData)).rejects.toThrow(
      'redirect:/dashboard/owner/users?error=failed',
    );

    const statements = queryMock.mock.calls.map(([query]) => String(query));
    expect(
      statements.some((query) => query.includes('SELECT users.role')),
    ).toBe(true);
    expect(
      statements.some((query) => query.includes('SELECT role, account_status')),
    ).toBe(false);
    expect(statements.some((query) => query.includes('UPDATE users'))).toBe(
      false,
    );
    expect(
      statements.some((query) => query.includes('UPDATE auth_sessions')),
    ).toBe(false);
    expect(
      statements.some((query) =>
        query.includes('UPDATE password_reset_tokens'),
      ),
    ).toBe(false);
  });

  it('uses the locked database role instead of a stale owner claim for policy', async () => {
    queryMock.mockImplementation(async (query: string) => {
      if (query.includes('SELECT users.role')) {
        return { rows: [{ role: 'admin' }] };
      }
      if (query.includes('SELECT role FROM users')) {
        return { rows: [{ role: 'user' }] };
      }
      return { rows: [] };
    });
    const formData = new FormData();
    formData.set('targetUserId', 'd4160292-6500-49c1-a2fd-82916d0e5673');
    formData.set('role', 'admin');

    await expect(setManagedUserRole(formData)).rejects.toThrow(
      'redirect:/dashboard/owner/users?error=owner-required',
    );

    const statements = queryMock.mock.calls.map(([query]) => String(query));
    expect(
      statements.some((query) => query.includes('SET role = $2::user_role')),
    ).toBe(false);
    expect(
      statements.some((query) => query.includes('UPDATE auth_sessions')),
    ).toBe(false);
  });
});
