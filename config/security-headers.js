function createSecurityHeaders({ isProduction }) {
  return [
    {
      key: 'Cross-Origin-Opener-Policy',
      value: 'same-origin',
    },
    {
      key: 'Origin-Agent-Cluster',
      value: '?1',
    },
    {
      key: 'Permissions-Policy',
      value: [
        'accelerometer=()',
        'browsing-topics=()',
        'camera=()',
        'geolocation=()',
        'gyroscope=()',
        'magnetometer=()',
        'microphone=()',
        'payment=()',
        'publickey-credentials-create=(self)',
        'publickey-credentials-get=(self)',
        'serial=()',
        'usb=()',
      ].join(', '),
    },
    {
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin',
    },
    ...(isProduction
      ? [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ]
      : []),
    {
      key: 'X-Content-Type-Options',
      value: 'nosniff',
    },
    {
      key: 'X-Frame-Options',
      value: 'DENY',
    },
    {
      key: 'X-Permitted-Cross-Domain-Policies',
      value: 'none',
    },
  ];
}

module.exports = { createSecurityHeaders };
