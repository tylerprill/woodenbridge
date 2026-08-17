import {
  sendPasskeyChangedEmail,
  sendPrivilegedRecoveryEmail,
  sendWelcomeEmail,
} from '@/app/lib/auth/recovery-email';

const originalEnvironment = process.env;

describe('transactional email delivery', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnvironment,
      EMAIL_DELIVERY: 'resend',
      RESEND_API_KEY: 're_test_key',
      RESEND_FROM_EMAIL: 'account@prill.io',
      RESEND_REPLY_TO_EMAIL: 'security@prill.io',
    };
  });

  afterEach(() => {
    process.env = originalEnvironment;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('retries a transient provider failure with the same idempotency key', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const delivery = sendWelcomeEmail({
      to: 'traveler@example.com',
      firstName: 'Ada',
      userId: 'user-123',
    });

    await jest.advanceTimersByTimeAsync(250);
    await delivery;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = fetchMock.mock.calls[0]?.[1];
    const secondRequest = fetchMock.mock.calls[1]?.[1];
    expect(firstRequest?.headers).toMatchObject({
      'Idempotency-Key': 'welcome-user-123',
    });
    expect(secondRequest?.headers).toMatchObject({
      'Idempotency-Key': 'welcome-user-123',
    });
  });

  it('does not retry a permanent validation failure', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 422 }));

    await expect(
      sendWelcomeEmail({
        to: 'traveler@example.com',
        firstName: 'Ada',
        userId: 'user-456',
      }),
    ).rejects.toThrow('Transactional email delivery failed.');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the configured reply-to address without changing the sender brand', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    await sendWelcomeEmail({
      to: 'traveler@example.com',
      firstName: 'Ada',
      userId: 'user-789',
    });

    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      from: 'Field Atlas <account@prill.io>',
      reply_to: 'security@prill.io',
      to: ['traveler@example.com'],
    });
  });

  it('escapes passkey labels in security-notification HTML', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    await sendPasskeyChangedEmail({
      to: 'traveler@example.com',
      firstName: 'Ada',
      passkeyLabel: '<img src=x onerror=alert(1)>',
      changeId: 'passkey-123',
      action: 'added',
    });

    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    expect(body.html).not.toContain('<img src=x');
    expect(body.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(request?.headers).toMatchObject({
      'Idempotency-Key': 'passkey-added-passkey-123',
    });
  });

  it('sends recovery-use notifications without including a saved code', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    await sendPrivilegedRecoveryEmail({
      to: 'traveler@example.com',
      firstName: 'Ada',
      event: 'code-used',
      changeId: 'event-123',
      remainingCodes: 7,
    });

    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    expect(body.text).toContain('7 unused recovery codes remain');
    expect(body.text).not.toMatch(/FA-[A-Z0-9-]{20,}/);
    expect(request?.headers).toMatchObject({
      'Idempotency-Key': 'privileged-recovery-code-used-event-123',
    });
  });

  it('uses the exact Vercel preview origin instead of production links', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_URL = 'field-atlas-feature-123.vercel.app';
    process.env.APP_URL = 'https://woodenbridge.vercel.app';
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    await sendWelcomeEmail({
      to: 'traveler@example.com',
      firstName: 'Ada',
      userId: 'preview-user',
    });

    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    expect(body.text).toContain(
      'https://field-atlas-feature-123.vercel.app/dashboard',
    );
    expect(body.text).not.toContain(
      'https://woodenbridge.vercel.app/dashboard',
    );
  });
});
