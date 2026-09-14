jest.mock('@/app/lib/db', () => ({ sql: jest.fn() }));
jest.mock('@/app/lib/atlas/media-grant', () => ({
  createAuthenticatedAtlasMediaUrls: jest.fn(),
}));

import { sql } from '@/app/lib/db';
import { createAuthenticatedAtlasMediaUrls } from '@/app/lib/atlas/media-grant';
import {
  loadAtlasJourneyDetail,
  loadAtlasJourneyIndex,
  mapAtlasJourneyIndexRows,
} from '@/app/lib/atlas/journeys/data';

const updatedAt = '2026-05-12T12:00:00.000Z';

function row(overrides: Record<string, unknown> = {}) {
  return {
    chapter_id: 'chapter-a',
    chapter_title: 'Michigan field notes',
    chapter_version: 3,
    chapter_updated_at: updatedAt,
    entry_id: 'entry-a',
    position: 0,
    entry_title: 'First memory',
    place_label: 'Ann Arbor, Michigan',
    place_name: 'Ann Arbor',
    visited_on: '2026-05-10',
    latitude: 42.2808,
    longitude: -83.743,
    ...overrides,
  };
}

describe('Atlas journey data mapping', () => {
  beforeEach(() => {
    jest.mocked(sql).mockReset();
    jest.mocked(createAuthenticatedAtlasMediaUrls).mockReset();
  });

  it('preserves authored Chapter order instead of visit-date order', () => {
    const [journey] = mapAtlasJourneyIndexRows([
      row({
        entry_id: 'entry-b',
        entry_title: 'Second authored stop',
        position: 1,
        visited_on: '2026-05-01',
      }),
      row({
        entry_id: 'entry-a',
        entry_title: 'First authored stop',
        position: 0,
        visited_on: '2026-05-10',
      }),
    ]);

    expect(journey.stops.map((stop) => stop.entryId)).toEqual([
      'entry-a',
      'entry-b',
    ]);
    expect(journey).toMatchObject({
      memoryCount: 2,
      drawable: true,
      startDate: '2026-05-01',
      endDate: '2026-05-10',
    });
  });

  it('keeps a degraded Chapter visible without serializing an unavailable stop', () => {
    const [journey] = mapAtlasJourneyIndexRows([
      row(),
      row({
        entry_id: null,
        entry_title: null,
        latitude: null,
        longitude: null,
        position: 1,
      }),
    ]);

    expect(journey.stops).toHaveLength(1);
    expect(journey.memoryCount).toBe(1);
    expect(journey.drawable).toBe(false);
  });

  it('rejects non-finite coordinates at the DTO boundary', () => {
    const [journey] = mapAtlasJourneyIndexRows([
      row({ latitude: 'not-a-number' }),
    ]);

    expect(journey.stops).toEqual([]);
    expect(journey.drawable).toBe(false);
  });

  it('loads one lightweight thumbnail per stop without returning an original URL', async () => {
    const userId = 'e9025951-a32a-480f-9091-16fbf47861c0';
    const chapterId = '44adf8e4-69a6-4e38-aefc-1bc060d78438';
    jest.mocked(sql).mockResolvedValue({
      rows: [
        {
          ...row({ chapter_id: chapterId }),
          chapter_introduction: 'A remembered path.',
          entry_description: 'The first field note.',
          transition_note: 'Then north.',
          media_id: '73834095-3f40-4bc6-9cd8-f910c891d2fd',
          storage_path:
            'atlas/memories/entry-a/73834095-3f40-4bc6-9cd8-f910c891d2fd.jpg',
          thumbnail_path:
            'atlas/memories/entry-a/73834095-3f40-4bc6-9cd8-f910c891d2fd.thumbnail.webp',
          mime_type: 'image/jpeg',
          alt_text: 'A trail through the trees',
        },
      ],
    } as never);
    jest.mocked(createAuthenticatedAtlasMediaUrls).mockReturnValue({
      deliveryUrl: '/api/atlas/media/original-secret',
      thumbnailUrl: '/api/atlas/media/thumb-grant',
    });

    const detail = await loadAtlasJourneyDetail(userId, chapterId);

    expect(detail?.stops[0]).toMatchObject({
      description: 'The first field note.',
      transitionNote: 'Then north.',
      thumbnailUrl: '/api/atlas/media/thumb-grant',
      thumbnailAlt: 'A trail through the trees',
    });
    expect(JSON.stringify(detail)).not.toContain('original-secret');
    expect(sql).toHaveBeenCalledTimes(1);
    expect(jest.mocked(sql).mock.calls[0].slice(1)).toEqual(
      expect.arrayContaining([userId, chapterId]),
    );
  });

  it('loads the route index in one ownership-scoped query with selected fallback', async () => {
    const userId = 'e9025951-a32a-480f-9091-16fbf47861c0';
    const selectedJourneyId = '44adf8e4-69a6-4e38-aefc-1bc060d78438';
    jest.mocked(sql).mockResolvedValue({ rows: [row()] } as never);

    const index = await loadAtlasJourneyIndex(userId, {
      search: 'Michigan',
      selectedJourneyId,
      limit: 25,
      includeSuggestions: false,
    });

    expect(index.journeys).toHaveLength(1);
    expect(index.suggestions).toEqual([]);
    expect(sql).toHaveBeenCalledTimes(1);
    const [strings, ...values] = jest.mocked(sql).mock.calls[0];
    const query = Array.from(strings as unknown as string[]).join(' ? ');
    expect(query).toContain('chapter.user_id =');
    expect(query).not.toContain('atlas_media');
    expect(values).toEqual(
      expect.arrayContaining([userId, 'Michigan', selectedJourneyId, 25]),
    );
  });
});
