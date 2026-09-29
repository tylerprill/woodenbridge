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
    segment_id: null,
    position: 0,
    entry_title: 'First memory',
    place_label: 'Ann Arbor, Michigan',
    place_name: 'Ann Arbor',
    visited_on: '2026-05-10',
    latitude: 42.2808,
    longitude: -83.743,
    segments: [],
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
    expect(journey.segments).toEqual([]);
    expect(journey.stops.every((stop) => stop.segmentId === null)).toBe(true);
  });

  it('flattens unassigned memories before authored Segments and preserves empty Segments', () => {
    const segments = [
      { id: 'segment-b', title: 'The lakeshore', position: 1 },
      { id: 'segment-empty', title: 'The return', position: 2 },
      { id: 'segment-a', title: 'The road north', position: 0 },
    ];
    const [journey] = mapAtlasJourneyIndexRows([
      row({
        entry_id: 'entry-b-2',
        entry_title: 'Lakeshore second',
        segment_id: 'segment-b',
        position: 6,
        visited_on: '2026-05-08',
        segments,
      }),
      row({
        entry_id: 'entry-a-2',
        entry_title: 'Road north second',
        segment_id: 'segment-a',
        position: 4,
        visited_on: '2026-05-04',
        segments: null,
      }),
      row({
        entry_id: 'entry-unknown',
        entry_title: 'Unknown Segment',
        segment_id: 'missing-segment',
        position: 1,
        visited_on: '2026-05-01',
        segments: null,
      }),
      row({
        entry_id: 'entry-unassigned',
        entry_title: 'Before the first Segment',
        segment_id: null,
        position: 3,
        visited_on: '2026-05-03',
        segments: null,
      }),
      row({
        entry_id: 'entry-a-1',
        entry_title: 'Road north first',
        segment_id: 'segment-a',
        position: 2,
        visited_on: '2026-05-02',
        segments: null,
      }),
      row({
        entry_id: 'entry-b-1',
        entry_title: 'Lakeshore first',
        segment_id: 'segment-b',
        position: 5,
        visited_on: '2026-05-07',
        segments: null,
      }),
    ]);

    expect(journey.stops.map((stop) => [stop.entryId, stop.segmentId])).toEqual(
      [
        ['entry-unknown', null],
        ['entry-unassigned', null],
        ['entry-a-1', 'segment-a'],
        ['entry-a-2', 'segment-a'],
        ['entry-b-1', 'segment-b'],
        ['entry-b-2', 'segment-b'],
      ],
    );
    expect(journey.segments).toEqual([
      {
        id: 'segment-a',
        title: 'The road north',
        position: 0,
        memoryCount: 2,
        startDate: '2026-05-02',
        endDate: '2026-05-04',
      },
      {
        id: 'segment-b',
        title: 'The lakeshore',
        position: 1,
        memoryCount: 2,
        startDate: '2026-05-07',
        endDate: '2026-05-08',
      },
      {
        id: 'segment-empty',
        title: 'The return',
        position: 2,
        memoryCount: 0,
        startDate: null,
        endDate: null,
      },
    ]);
  });

  it('ignores malformed and duplicate Segment metadata', () => {
    const [journey] = mapAtlasJourneyIndexRows([
      row({
        segment_id: 'segment-valid',
        segments: [
          { id: 'segment-valid', title: 'Valid Segment', position: '0' },
          { id: 'segment-valid', title: 'Duplicate', position: 1 },
          { id: 'segment-invalid', title: null, position: 2 },
          { id: 'segment-position', title: 'Bad position', position: 'nope' },
        ],
      }),
    ]);

    expect(journey.segments).toEqual([
      {
        id: 'segment-valid',
        title: 'Valid Segment',
        position: 0,
        memoryCount: 1,
        startDate: '2026-05-10',
        endDate: '2026-05-10',
      },
    ]);
    expect(journey.stops[0].segmentId).toBe('segment-valid');
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

  it('preserves Segment metadata for a Journey without memories', () => {
    const [journey] = mapAtlasJourneyIndexRows([
      row({
        entry_id: null,
        entry_title: null,
        latitude: null,
        longitude: null,
        position: null,
        segments: [
          { id: 'segment-empty', title: 'The quiet return', position: 0 },
        ],
      }),
    ]);

    expect(journey.stops).toEqual([]);
    expect(journey.segments).toEqual([
      {
        id: 'segment-empty',
        title: 'The quiet return',
        position: 0,
        memoryCount: 0,
        startDate: null,
        endDate: null,
      },
    ]);
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
          ...row({
            chapter_id: chapterId,
            segment_id: 'segment-a',
            segments: [
              { id: 'segment-a', title: 'Trail morning', position: 0 },
            ],
          }),
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
      segmentId: 'segment-a',
      description: 'The first field note.',
      transitionNote: 'Then north.',
      thumbnailUrl: '/api/atlas/media/thumb-grant',
      thumbnailAlt: 'A trail through the trees',
    });
    expect(JSON.stringify(detail)).not.toContain('original-secret');
    expect(detail?.segments).toEqual([
      {
        id: 'segment-a',
        title: 'Trail morning',
        position: 0,
        memoryCount: 1,
        startDate: '2026-05-10',
        endDate: '2026-05-10',
      },
    ]);
    expect(sql).toHaveBeenCalledTimes(1);
    const [strings, ...values] = jest.mocked(sql).mock.calls[0];
    const query = Array.from(strings as unknown as string[]).join(' ? ');
    expect(query).toContain('atlas_chapter_segments');
    expect(query).toContain('journey_segment.user_id =');
    expect(query).toContain('chapter_entry.segment_id');
    expect(query).toContain('ROW_NUMBER() OVER');
    expect(query).toContain('THEN chapter_segments.segments');
    expect(query).toContain('ELSE NULL');
    expect(query).toContain('chapter_entry.position NULLS FIRST');
    expect(values).toEqual(expect.arrayContaining([userId, chapterId]));
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
    expect(query).toContain('atlas_chapter_segments');
    expect(query).toContain('journey_segment.user_id =');
    expect(query).toContain('chapter_entry.segment_id');
    expect(query).toContain('ROW_NUMBER() OVER');
    expect(query).toContain('THEN chapter_segments.segments');
    expect(query).toContain('ELSE NULL');
    expect(query).toContain('chapter_entry.position NULLS FIRST');
    expect(query).not.toContain('atlas_media');
    expect(values).toEqual(
      expect.arrayContaining([userId, 'Michigan', selectedJourneyId, 25]),
    );
  });
});
