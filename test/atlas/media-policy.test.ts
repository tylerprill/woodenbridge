import {
  ATLAS_MEDIA_MAX_BYTES,
  areAtlasMediaPathsPaired,
  atlasMediaRegistrationSchema,
  createAtlasMediaPath,
  createAtlasThumbnailPath,
  getAtlasThumbnailDimensions,
  isAtlasMediaPath,
  isAtlasThumbnailPath,
} from '@/app/lib/atlas/media-policy';

describe('atlas media policy', () => {
  const entryId = 'f7c0bf19-59fc-49df-9bd7-ae405a69e49c';
  const photoId = '2df8f2d8-9fae-4c86-9578-3ed6179e262b';

  it('creates a constrained pathname for a memory photo', () => {
    const pathname = createAtlasMediaPath(entryId, photoId, 'image/webp');

    expect(pathname).toBe(`atlas/memories/${entryId}/${photoId}.webp`);
    expect(isAtlasMediaPath(pathname, entryId)).toBe(true);
  });

  it('rejects another memory prefix and unsafe file names', () => {
    const pathname = createAtlasMediaPath(entryId, photoId, 'image/jpeg');

    expect(
      isAtlasMediaPath(pathname, '1a172d1e-0f6a-4ea2-9bfa-cdb716eec9df'),
    ).toBe(false);
    expect(
      isAtlasMediaPath(`atlas/memories/${entryId}/../secret.jpg`, entryId),
    ).toBe(false);
    expect(
      isAtlasMediaPath(`atlas/memories/${entryId}/${photoId}.svg`, entryId),
    ).toBe(false);
  });

  it('creates and pairs a constrained WebP thumbnail pathname', () => {
    const pathname = createAtlasMediaPath(entryId, photoId, 'image/jpeg');
    const thumbnailPathname = createAtlasThumbnailPath(entryId, photoId);

    expect(thumbnailPathname).toBe(
      `atlas/memories/${entryId}/${photoId}.thumbnail.webp`,
    );
    expect(isAtlasThumbnailPath(thumbnailPathname, entryId)).toBe(true);
    expect(areAtlasMediaPathsPaired(pathname, thumbnailPathname, entryId)).toBe(
      true,
    );
    expect(
      areAtlasMediaPathsPaired(
        pathname,
        createAtlasThumbnailPath(
          entryId,
          '40504744-8e58-49c8-b4e7-bcb029a96dc5',
        ),
        entryId,
      ),
    ).toBe(false);
  });

  it('constrains thumbnails without enlarging small originals', () => {
    expect(getAtlasThumbnailDimensions(4000, 3000)).toEqual({
      width: 1024,
      height: 768,
    });
    expect(getAtlasThumbnailDimensions(640, 480)).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('constrains image dimensions and metadata', () => {
    const input = {
      entryId,
      pathname: createAtlasMediaPath(entryId, photoId, 'image/png'),
      thumbnailPathname: createAtlasThumbnailPath(entryId, photoId),
      width: 2048,
      height: 1365,
      altText: 'A quiet path through Kyoto',
    };

    expect(atlasMediaRegistrationSchema.safeParse(input).success).toBe(true);
    expect(
      atlasMediaRegistrationSchema.safeParse({ ...input, width: 50_000 })
        .success,
    ).toBe(false);
    expect(ATLAS_MEDIA_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});
