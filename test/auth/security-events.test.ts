import { after } from 'next/server';

import { persistSecurityEvent } from '@/app/lib/auth/security-event-store';
import { recordSecurityEvent } from '@/app/lib/auth/security-events';

jest.mock('next/server', () => ({
  after: jest.fn((callback: () => unknown) => callback()),
}));
jest.mock('@/app/lib/auth/security-event-store', () => ({
  persistSecurityEvent: jest.fn(),
}));

const scheduleAfterResponse = jest.mocked(after);
const persistEvent = jest.mocked(persistSecurityEvent);

describe('security event durability', () => {
  it('emits correlated structured logs and schedules the database audit copy', async () => {
    const info = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    persistEvent.mockResolvedValue(undefined);

    recordSecurityEvent('management.sessions_revoked', 'success', {
      actorUserId: '8d9a33dd-08d0-46dc-92e8-d2d1d9e49c17',
      targetUserId: '4a8c1c39-5f7e-40cb-9e5a-8508af1a2bed',
    });
    await Promise.resolve();

    expect(scheduleAfterResponse).toHaveBeenCalledTimes(1);
    expect(persistEvent).toHaveBeenCalledTimes(1);

    const databaseEntry = persistEvent.mock.calls[0][0];
    const logEntry = JSON.parse(String(info.mock.calls[0][0]));

    expect(databaseEntry).toMatchObject({
      category: 'authentication',
      event: 'management.sessions_revoked',
      outcome: 'success',
    });
    expect(logEntry).toMatchObject({
      eventId: databaseEntry.eventId,
      event: databaseEntry.event,
      outcome: databaseEntry.outcome,
      service: 'field-atlas-web',
    });
    expect(logEntry).not.toHaveProperty('password');
  });

  it('records a correlated log error when database persistence fails', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    persistEvent.mockRejectedValueOnce(new Error('database unavailable'));

    recordSecurityEvent('login.rate_limited', 'limited');
    await Promise.resolve();
    await Promise.resolve();

    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({
      event: 'security_event.persistence_failed',
      outcome: 'failure',
      service: 'field-atlas-web',
    });
  });
});
