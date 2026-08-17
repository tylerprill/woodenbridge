import { createHash } from 'node:crypto';

import {
  getNewPasswordRejection,
  isPasswordCompromised,
} from '@/app/lib/auth/compromised-password';

describe('compromised-password screening', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects passwords based on account context before a network call', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(
      getNewPasswordRejection('Tyler-prill-walks-here', {
        email: 'tyler.prill@example.com',
        firstName: 'Tyler',
        lastName: 'Prill',
      }),
    ).resolves.toMatch(/name or email/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the k-anonymous range response without sending the full digest', async () => {
    const password = 'a unique test password for breach lookup';
    const digest = createHash('sha1')
      .update(password)
      .digest('hex')
      .toUpperCase();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(`${digest.slice(5)}:42\n${'F'.repeat(35)}:0`),
      );

    await expect(isPasswordCompromised(password)).resolves.toBe(true);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`,
    );
    expect(String(url)).not.toContain(digest.slice(5));
    expect(options?.headers).toMatchObject({ 'Add-Padding': 'true' });
  });

  it('fails safely when the range service is unavailable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      getNewPasswordRejection('this is an unusual offline test password'),
    ).resolves.toMatch(/could not safely check/i);
  });
});
