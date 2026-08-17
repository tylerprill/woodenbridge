import { headers } from 'next/headers';

import { WebsiteJsonLd } from '@/components/seo/website-json-ld';

jest.mock('next/headers', () => ({
  headers: jest.fn(),
}));

const requestHeaders = jest.mocked(headers);

describe('website structured data CSP', () => {
  it('adds the request nonce to the inline JSON-LD script', async () => {
    requestHeaders.mockResolvedValueOnce(
      new Headers({ 'x-nonce': 'vV6h8z6f4yF0YlMJzVOT4Q==' }) as never,
    );

    const script = await WebsiteJsonLd();

    expect(script.type).toBe('script');
    expect(script.props.nonce).toBe('vV6h8z6f4yF0YlMJzVOT4Q==');
    expect(script.props.type).toBe('application/ld+json');
    expect(script.props.dangerouslySetInnerHTML.__html).not.toContain('<');
  });
});
