import { randomBytes } from 'node:crypto';

import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from 'next/server';

import { auth } from './auth';
import {
  CSP_NONCE_HEADER,
  createContentSecurityPolicy,
} from '@/app/lib/security/content-security-policy';

type AuthProxy = (
  request: NextRequest,
  event: NextFetchEvent,
) => Promise<Response | null | undefined>;

const runAuthProxy = auth as unknown as AuthProxy;

function copyAuthResponseHeaders(source: Response, target: NextResponse) {
  source.headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();

    if (
      normalizedKey === 'content-security-policy' ||
      normalizedKey === 'set-cookie' ||
      normalizedKey.startsWith('x-middleware-')
    ) {
      return;
    }

    target.headers.set(key, value);
  });

  for (const cookie of source.headers.getSetCookie()) {
    target.headers.append('set-cookie', cookie);
  }
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const nonce = randomBytes(16).toString('base64');
  const contentSecurityPolicy = createContentSecurityPolicy({
    nonce,
    isDevelopment: process.env.NODE_ENV === 'development',
  });
  const authResponse = await runAuthProxy(request, event);

  if (authResponse?.headers.get('x-middleware-next') !== '1') {
    const response = authResponse ?? NextResponse.next();
    response.headers.set('Content-Security-Policy', contentSecurityPolicy);
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  copyAuthResponseHeaders(authResponse, response);
  response.headers.set('Content-Security-Policy', contentSecurityPolicy);

  return response;
}

export const config = {
  matcher: [
    {
      source:
        '/((?!api|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|robots.txt|sitemap.xml|.*\\.png$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
