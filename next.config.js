const { createSecurityHeaders } = require('./config/security-headers');

const securityHeaders = createSecurityHeaders({
  isProduction: process.env.NODE_ENV === 'production',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['@node-rs/argon2'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox",
          },
        ],
      },
      {
        source: '/reset-password',
        headers: [
          {
            key: 'Referrer-Policy',
            value: 'no-referrer',
          },
          {
            key: 'Cache-Control',
            value: 'no-store, max-age=0',
          },
        ],
      },
      {
        source: '/verify-email',
        headers: [
          {
            key: 'Referrer-Policy',
            value: 'no-referrer',
          },
          {
            key: 'Cache-Control',
            value: 'no-store, max-age=0',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
