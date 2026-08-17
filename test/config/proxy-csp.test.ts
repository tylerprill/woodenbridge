import { NextRequest, NextResponse } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';

import { auth } from '@/auth';
import { config, proxy } from '@/proxy';

jest.mock('@/auth', () => ({
  auth: jest.fn(),
}));

const authProxy = auth as unknown as jest.MockedFunction<
  (request: NextRequest, event: unknown) => Promise<Response>
>;

function request(path = '/') {
  return new NextRequest(new URL(path, 'https://woodenbridge.example'));
}

function nonceFromPolicy(policy: string) {
  return policy.match(/'nonce-([^']+)'/)?.[1];
}

describe('CSP proxy composition', () => {
  it('forwards one nonce to rendering and returns the matching enforced policy', async () => {
    const authResponse = NextResponse.next();
    authResponse.headers.append(
      'set-cookie',
      'authjs.session-token=refreshed; Path=/; HttpOnly; SameSite=Lax',
    );
    authProxy.mockResolvedValueOnce(authResponse);

    const response = await proxy(request('/sign-up'), {} as never);
    const policy = response.headers.get('content-security-policy') ?? '';
    const nonce = nonceFromPolicy(policy);

    expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(
      response.headers.get('x-middleware-request-content-security-policy'),
    ).toBe(policy);
    expect(response.headers.getSetCookie()).toContain(
      'authjs.session-token=refreshed; Path=/; HttpOnly; SameSite=Lax',
    );
  });

  it('uses an unpredictable nonce for each document request', async () => {
    authProxy
      .mockResolvedValueOnce(NextResponse.next())
      .mockResolvedValueOnce(NextResponse.next());

    const first = await proxy(request('/login'), {} as never);
    const second = await proxy(request('/login'), {} as never);
    const firstNonce = nonceFromPolicy(
      first.headers.get('content-security-policy') ?? '',
    );
    const secondNonce = nonceFromPolicy(
      second.headers.get('content-security-policy') ?? '',
    );

    expect(firstNonce).toBeTruthy();
    expect(secondNonce).toBeTruthy();
    expect(firstNonce).not.toBe(secondNonce);
  });

  it('preserves authentication redirects and still hardens the response', async () => {
    authProxy.mockResolvedValueOnce(
      NextResponse.redirect(
        new URL('/login?callbackUrl=%2Fdashboard', request('/dashboard').url),
      ),
    );

    const response = await proxy(request('/dashboard'), {} as never);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login?callbackUrl=');
    expect(response.headers.get('content-security-policy')).toContain(
      "script-src 'self' 'nonce-",
    );
  });

  it.each([
    '/dashboard',
    '/dashboard/archive.v2',
    '/sign-up',
    '/shared/chapters/example',
  ])('matches document route %s', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(
      true,
    );
  });

  it.each([
    '/api/auth/session',
    '/_next/static/chunks/app.js',
    '/_next/image',
    '/icon.svg',
    '/manifest.webmanifest',
    '/robots.txt',
    '/sitemap.xml',
  ])('does not spend auth or nonce work on asset route %s', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(
      false,
    );
  });

  it.each([{ 'next-router-prefetch': '1' }, { purpose: 'prefetch' }])(
    'skips Link prefetch requests with headers %p',
    (headers) => {
      expect(
        unstable_doesMiddlewareMatch({
          config,
          nextConfig: {},
          url: '/dashboard',
          headers,
        }),
      ).toBe(false);
    },
  );
});
