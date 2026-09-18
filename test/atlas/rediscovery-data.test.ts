jest.mock('@/app/lib/db', () => ({ sql: jest.fn() }));
jest.mock('@/app/lib/auth/session', () => ({
  requireVerifiedSession: jest.fn(),
}));
jest.mock('@/app/lib/atlas/media-grant', () => ({
  createAuthenticatedAtlasMediaUrls: jest.fn(),
}));

import { requireVerifiedSession } from '@/app/lib/auth/session';
import { sql } from '@/app/lib/db';
import { createAuthenticatedAtlasMediaUrls } from '@/app/lib/atlas/media-grant';
import { getRediscoveryData } from '@/app/lib/atlas/rediscovery/data';

const userId = '17d69b97-9d24-4e07-a461-271263c71c52';
const anotherUserId = 'e9025951-a32a-480f-9091-16fbf47861c0';
const entryId = 'f7c0bf19-59fc-49df-9bd7-ae405a69e49c';
const mediaId = '73834095-3f40-4bc6-9cd8-f910c891d2fd';
const now = '2026-09-15T12:00:00.000Z';

function memoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: entryId,
    title: 'A chapter of autumn light',
    description: 'A note worth revisiting.',
    place_label: 'Ann Arbor, Michigan',
    place_name: 'Ann Arbor',
    place_locality: 'Ann Arbor',
    place_region: 'Michigan',
    place_country: 'United States',
    place_country_code: ' US ',
    place_geocoder: 'nominatim',
    place_geocoded_at: new Date(now),
    visited_on: '2023-09-15',
    record_state: 'saved',
    journey_state: 'visited',
    version: 2,
    created_at: new Date(now),
    updated_at: now,
    cover_media: null,
    journey: null,
    ...overrides,
  };
}

function mediaRow() {
  return {
    id: mediaId,
    entry_id: entryId,
    storage_path: `atlas/memories/${entryId}/${mediaId}.jpg`,
    thumbnail_path: `atlas/memories/${entryId}/${mediaId}.thumbnail.webp`,
    mime_type: 'image/jpeg',
    width: 1200,
    height: 900,
    byte_size: 10_000,
    alt_text: 'Autumn sunlight through the trees',
    sort_order: 0,
    created_at: now,
  };
}

function installRows(
  total: number | string,
  rows = [memoryRow()],
  earliestDate: string | null = rows.length ? '2023-09-15' : null,
) {
  jest
    .mocked(sql)
    .mockResolvedValueOnce({
      rows: [{ total, earliest_date: earliestDate }],
    } as never)
    .mockResolvedValueOnce({ rows } as never);
}

function queryAt(index: number) {
  const [strings, ...values] = jest.mocked(sql).mock.calls[index];
  const query = Array.from(strings as unknown as string[])
    .join(' ? ')
    .replace(/\s+/g, ' ')
    .trim();
  return { query, values };
}

describe('On this day private bounded data', () => {
  beforeEach(() => {
    jest.mocked(sql).mockReset();
    jest.mocked(requireVerifiedSession).mockReset();
    jest.mocked(requireVerifiedSession).mockResolvedValue({
      user: { id: userId },
    } as Awaited<ReturnType<typeof requireVerifiedSession>>);
    jest.mocked(createAuthenticatedAtlasMediaUrls).mockReset();
    jest.mocked(createAuthenticatedAtlasMediaUrls).mockReturnValue({
      deliveryUrl: '/api/atlas/media/private-original',
      thumbnailUrl: '/api/atlas/media/private-thumbnail',
    });
  });

  it('requires a verified owner session before any database access', async () => {
    jest
      .mocked(requireVerifiedSession)
      .mockRejectedValue(new Error('Login required'));
    await expect(getRediscoveryData({ date: '2026-09-15' })).rejects.toThrow(
      'Login required',
    );
    expect(sql).not.toHaveBeenCalled();
  });

  it('authorizes invalid input before rejecting it and never queries malformed dates', async () => {
    await expect(getRediscoveryData({ date: '2026-02-31' })).rejects.toThrow(
      RangeError,
    );
    expect(requireVerifiedSession).toHaveBeenCalledTimes(1);
    expect(sql).not.toHaveBeenCalled();
  });

  it('counts exact previous-year matches and returns presentation-only entries', async () => {
    installRows('25');
    const data = await getRediscoveryData({ date: '2026-09-15' });
    expect(data).toMatchObject({
      date: '2026-09-15',
      earliestDate: '2023-09-15',
      mode: 'anniversary',
      total: 25,
      page: 1,
      pageSize: 24,
      totalPages: 2,
    });
    expect(data.memories[0]).toEqual({
      entry: {
        id: entryId,
        title: 'A chapter of autumn light',
        description: 'A note worth revisiting.',
        placeLabel: 'Ann Arbor, Michigan',
        placeName: 'Ann Arbor',
        placeLocality: 'Ann Arbor',
        placeRegion: 'Michigan',
        placeCountry: 'United States',
        placeCountryCode: 'US',
        placeGeocoder: 'nominatim',
        placeGeocodedAt: now,
        visitedOn: '2023-09-15',
        recordState: 'saved',
        journeyState: 'visited',
        version: 2,
        createdAt: now,
        updatedAt: now,
        media: [],
      },
      journey: null,
    });
    expect(sql).toHaveBeenCalledTimes(2);
    const count = queryAt(0);
    expect(count.query).toContain('entry.visited_on < ? ::date');
    expect(count.query).toContain('EXTRACT(MONTH FROM entry.visited_on) =');
    expect(count.query).toContain('EXTRACT(DAY FROM entry.visited_on) =');
    expect(count.values).toEqual([userId, '2026-01-01', 9, 15]);
  });

  it.each([
    [undefined, 1, 0],
    [0, 1, 0],
    [-5, 1, 0],
    [Number.NaN, 1, 0],
    [Number.POSITIVE_INFINITY, 1, 0],
    [1.9, 1, 0],
    [2, 2, 24],
    [99, 3, 48],
    [Number.MAX_SAFE_INTEGER, 3, 48],
  ])(
    'clamps requested page %p before selecting rows',
    async (page, expectedPage, offset) => {
      installRows(49);
      const data = await getRediscoveryData({ date: '2026-09-15', page });
      expect(data.page).toBe(expectedPage);
      expect(data.totalPages).toBe(3);
      expect(queryAt(1).values.slice(6, 8)).toEqual([24, offset]);
    },
  );

  it('does not invent anniversaries when only recent memories exist', async () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      memoryRow({ id: `recent-${index}`, visited_on: '2026-09-14' }),
    );
    installRows(0, rows);
    const data = await getRediscoveryData({ date: '2026-09-15', page: 99 });
    expect(data).toMatchObject({
      mode: 'recent',
      earliestDate: '2023-09-15',
      total: 6,
      page: 1,
      pageSize: 6,
      totalPages: 1,
    });
    const selection = queryAt(1);
    expect(selection.query).toContain('entry.visited_on <= ? ::date');
    expect(selection.values.slice(0, 8)).toEqual([
      userId,
      '2026-09-15',
      'recent',
      '2026-01-01',
      9,
      15,
      6,
      0,
    ]);
    expect(data.memories.map(({ entry }) => entry.visitedOn)).toEqual(
      Array(6).fill('2026-09-14'),
    );
  });

  it('returns a truthful empty recent state for an empty account', async () => {
    installRows(0, []);
    await expect(getRediscoveryData({ date: '2026-09-15' })).resolves.toEqual({
      date: '2026-09-15',
      earliestDate: null,
      mode: 'recent',
      total: 0,
      page: 1,
      pageSize: 6,
      totalPages: 1,
      memories: [],
    });
  });

  it.each([0, 5])(
    'applies owner, saved, visited, deletion and incomplete-import guards in both queries (total %s)',
    async (total) => {
      installRows(total);
      await getRediscoveryData({ date: '2026-09-15' });
      for (const index of [0, 1]) {
        const { query, values } = queryAt(index);
        expect(query).toContain('entry.user_id =');
        expect(query).toContain("entry.record_state = 'saved'");
        expect(query).toContain("entry.journey_state = 'visited'");
        expect(query).toContain('entry.deleted_at IS NULL');
        expect(query).toContain(
          'AND NOT EXISTS ( SELECT 1 FROM atlas_import_items',
        );
        expect(query).toContain('import_batch.user_id = import_item.user_id');
        expect(query).toContain('import_item.user_id = entry.user_id');
        expect(query).toContain("import_batch.status <> 'completed'");
        expect(values).toContain(userId);
        expect(query).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/);
      }
    },
  );

  it('uses exact February 29 without February 28 aliases or timestamp timezone conversion', async () => {
    installRows(2, [memoryRow({ visited_on: '2020-02-29' })]);
    await getRediscoveryData({ date: '2024-02-29' });
    expect(queryAt(0).values).toEqual([userId, '2024-01-01', 2, 29]);
    expect(queryAt(1).values.slice(1, 6)).toEqual([
      '2024-02-29',
      'anniversary',
      '2024-01-01',
      2,
      29,
    ]);
    for (const index of [0, 1]) {
      expect(queryAt(index).query).not.toContain('AT TIME ZONE');
      expect(queryAt(index).query).not.toContain('to_char');
      expect(queryAt(index).query).not.toContain('INTERVAL');
    }
  });

  it('loads one ownership-scoped cover and one most-recent existing journey per bounded entry', async () => {
    const cover = mediaRow();
    installRows(1, [
      memoryRow({
        cover_media: cover,
        journey: {
          id: 'journey-id',
          title: 'Authored journey',
          user_id: userId,
        },
        latitude: 42,
        longitude: -83,
        user_id: userId,
      }),
    ]);
    const data = await getRediscoveryData({ date: '2026-09-15' });
    expect(data.memories[0].entry.media).toHaveLength(1);
    expect(data.memories[0].entry.media[0]).toMatchObject({
      id: mediaId,
      entryId,
      altText: cover.alt_text,
      thumbnailUrl: '/api/atlas/media/private-thumbnail',
    });
    expect(data.memories[0].journey).toEqual({
      id: 'journey-id',
      title: 'Authored journey',
    });
    expect(createAuthenticatedAtlasMediaUrls).toHaveBeenCalledTimes(1);
    expect(createAuthenticatedAtlasMediaUrls).toHaveBeenCalledWith(
      expect.objectContaining({ id: mediaId, entryId }),
      userId,
    );
    const { query, values } = queryAt(1);
    expect(query.indexOf('LIMIT ? OFFSET ?')).toBeLessThan(
      query.indexOf('LEFT JOIN LATERAL'),
    );
    expect(query).toContain('media.entry_id = entry.id AND media.user_id =');
    expect(query).toContain('AND media.thumbnail_path IS NOT NULL');
    expect(query).toContain(
      'ORDER BY media.sort_order, media.created_at, media.id LIMIT 1',
    );
    expect(query).toContain('chapter.user_id = chapter_entry.user_id');
    expect(query).toContain('chapter_entry.user_id =');
    expect(query).toContain('AND chapter.user_id =');
    expect(query).toContain(
      'ORDER BY chapter.updated_at DESC, chapter.id DESC LIMIT 1',
    );
    expect(query).not.toContain('chapter.deleted_at');
    expect(values.filter((value) => value === userId)).toHaveLength(5);
    const serialized = JSON.stringify(data);
    for (const forbidden of [
      'storage_path',
      'thumbnail_path',
      'user_id',
      'latitude',
      'longitude',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toContain(cover.storage_path);
    expect(serialized).not.toContain(cover.thumbnail_path);
    expect(query).not.toContain('atlas_preferences');
    expect(query).not.toContain('ST_X');
    expect(query).not.toContain('ST_Y');
    expect(query).not.toContain('5000');
  });

  it('never uses legacy original-only media as a rediscovery thumbnail preview', async () => {
    installRows(1, [
      memoryRow({ cover_media: { ...mediaRow(), thumbnail_path: null } }),
    ]);
    const data = await getRediscoveryData({ date: '2026-09-15' });

    expect(data.memories[0].entry.media).toEqual([]);
    expect(createAuthenticatedAtlasMediaUrls).not.toHaveBeenCalled();
    expect(queryAt(1).query).toContain('AND media.thumbnail_path IS NOT NULL');
    expect(JSON.stringify(data)).not.toContain('private-original');
    expect(data.memories[0].entry.title).toBe('A chapter of autumn light');
  });

  it('uses the current verified owner on every request without cross-account caching', async () => {
    jest
      .mocked(requireVerifiedSession)
      .mockResolvedValueOnce({ user: { id: userId } } as Awaited<
        ReturnType<typeof requireVerifiedSession>
      >)
      .mockResolvedValueOnce({ user: { id: anotherUserId } } as Awaited<
        ReturnType<typeof requireVerifiedSession>
      >);
    jest.mocked(sql).mockImplementation(async (_strings, ...values) => {
      const owner = values[0];
      const query = Array.from(_strings as unknown as string[]).join(' ');
      if (owner !== userId && owner !== anotherUserId)
        throw new Error('Unscoped query.');
      return {
        rows: query.includes('COUNT(*)')
          ? [{ total: 1, earliest_date: '2023-09-15' }]
          : [
              memoryRow({
                id: owner === userId ? 'owner-a-memory' : 'owner-b-memory',
              }),
            ],
      } as never;
    });

    const first = await getRediscoveryData({ date: '2026-09-15' });
    const second = await getRediscoveryData({ date: '2026-09-15' });
    expect(first.memories[0].entry.id).toBe('owner-a-memory');
    expect(second.memories[0].entry.id).toBe('owner-b-memory');
    expect(requireVerifiedSession).toHaveBeenCalledTimes(2);
    expect(sql).toHaveBeenCalledTimes(4);
    expect(queryAt(2).values[0]).toBe(anotherUserId);
    expect(
      queryAt(3).values.filter((value) => value === anotherUserId),
    ).toHaveLength(5);
  });

  it('normalizes date/string fields and has no-media and no-journey fallbacks', async () => {
    installRows(1, [
      memoryRow({
        visited_on: new Date('2023-09-15T00:00:00.000Z'),
        place_label: null,
        place_name: null,
        place_locality: null,
        place_region: null,
        place_country: null,
        place_country_code: ' ',
        place_geocoder: null,
        place_geocoded_at: null,
      }),
    ]);
    const [{ entry, journey }] = (
      await getRediscoveryData({ date: '2026-09-15' })
    ).memories;
    expect(entry).toMatchObject({
      placeLabel: '',
      placeName: null,
      placeCountryCode: null,
      placeGeocodedAt: null,
      visitedOn: '2023-09-15',
      media: [],
    });
    expect(journey).toBeNull();
    expect(createAuthenticatedAtlasMediaUrls).not.toHaveBeenCalled();
  });
});
