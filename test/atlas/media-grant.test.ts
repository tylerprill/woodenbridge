import {
  createAtlasMediaGrant,
  createAuthenticatedAtlasMediaUrls,
  verifyAtlasMediaGrant,
  type AtlasMediaGrantSource,
} from '@/app/lib/atlas/media-grant';

const source: AtlasMediaGrantSource = {
  id: 'bf69b9f1-4868-4206-abbf-df01e6a8d033',
  entryId: 'cfe81448-0a0d-4eb5-b015-b3e9d81baaaf',
  storagePath:
    'atlas/memories/cfe81448-0a0d-4eb5-b015-b3e9d81baaaf/bf69b9f1-4868-4206-abbf-df01e6a8d033.jpg',
  thumbnailPath:
    'atlas/memories/cfe81448-0a0d-4eb5-b015-b3e9d81baaaf/bf69b9f1-4868-4206-abbf-df01e6a8d033.thumbnail.webp',
  mimeType: 'image/jpeg',
};
const userId = 'a6fcbd7c-6d0f-4f76-b03b-5056af3d5d72';

describe('authenticated Atlas media grants', () => {
  beforeAll(() => {
    process.env.AUTH_SECRET = 'test-auth-secret-with-enough-entropy';
  });

  it('round-trips signed metadata for the intended user and media', () => {
    const grant = createAtlasMediaGrant(source, userId, 1_800_000_000);

    expect(
      verifyAtlasMediaGrant(grant, {
        mediaId: source.id,
        userId,
        now: 1_800_000_001,
      }),
    ).toEqual(source);
  });

  it('rejects tampering, another user, another media item, and expiration', () => {
    const now = 1_800_000_000;
    const grant = createAtlasMediaGrant(source, userId, now);
    const expiresAt = Math.floor(now / 3600) * 3600 + 12 * 60 * 60;

    expect(
      verifyAtlasMediaGrant(`${grant.slice(0, -1)}x`, {
        mediaId: source.id,
        userId,
        now,
      }),
    ).toBeNull();
    expect(
      verifyAtlasMediaGrant(grant, {
        mediaId: source.id,
        userId: '52b1eae2-33cd-4ff6-ab8c-209044902c01',
        now,
      }),
    ).toBeNull();
    expect(
      verifyAtlasMediaGrant(grant, {
        mediaId: '7d7762db-25db-4887-8a87-04ce90df1db3',
        userId,
        now,
      }),
    ).toBeNull();
    expect(
      verifyAtlasMediaGrant(grant, {
        mediaId: source.id,
        userId,
        now: expiresAt,
      }),
    ).toBeNull();
  });

  it('builds separate original and thumbnail URLs with one stable grant', () => {
    const urls = createAuthenticatedAtlasMediaUrls(source, userId);
    const original = new URL(urls.deliveryUrl, 'https://fieldatlas.test');
    const thumbnail = new URL(urls.thumbnailUrl, 'https://fieldatlas.test');

    expect(original.searchParams.get('grant')).toBeTruthy();
    expect(thumbnail.searchParams.get('grant')).toBe(
      original.searchParams.get('grant'),
    );
    expect(thumbnail.searchParams.get('variant')).toBe('thumbnail');
  });
});
