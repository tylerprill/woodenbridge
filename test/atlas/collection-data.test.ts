jest.mock('@/app/lib/db', () => ({ sql: jest.fn() }));
jest.mock('@/app/lib/auth/session', () => ({
  requireVerifiedSession: jest.fn(),
}));
jest.mock('@/app/lib/atlas/media-grant', () => ({
  createAuthenticatedAtlasMediaUrls: jest.fn(),
}));

import { requireVerifiedSession } from '@/app/lib/auth/session';
import { sql } from '@/app/lib/db';
import { getAtlasCollectionData } from '@/app/lib/atlas/data';

const userId = '17d69b97-9d24-4e07-a461-271263c71c52';

function entryRow() {
  return {
    id: 'f7c0bf19-59fc-49df-9bd7-ae405a69e49c',
    title: 'Sunrise at the pass',
    description: 'First light on the road.',
    place_label: 'Twin Lakes, Colorado',
    place_name: 'Twin Lakes',
    place_locality: 'Twin Lakes',
    place_region: 'Colorado',
    place_country: 'United States',
    place_country_code: 'US',
    place_geocoder: 'test',
    place_geocoded_at: '2026-04-19T14:00:00.000Z',
    visited_on: '2026-04-19',
    occurred_time: '06:42:00',
    occurred_utc_offset_minutes: -360,
    record_state: 'saved',
    journey_state: 'visited',
    latitude: 39.082,
    longitude: -106.382,
    version: 2,
    created_at: '2026-04-20T00:00:00.000Z',
    updated_at: '2026-04-20T00:00:00.000Z',
  };
}

function queryAt(index: number) {
  const [strings, ...values] = jest.mocked(sql).mock.calls[index];
  return {
    query: Array.from(strings as unknown as string[])
      .join(' ? ')
      .replace(/\s+/g, ' ')
      .trim(),
    values,
  };
}

describe('Memories collection chronology', () => {
  beforeEach(() => {
    jest.mocked(sql).mockReset();
    jest.mocked(requireVerifiedSession).mockResolvedValue({
      user: { id: userId },
    } as Awaited<ReturnType<typeof requireVerifiedSession>>);
  });

  it('maps occurrence time and uses the requested deterministic sort in both page queries', async () => {
    jest
      .mocked(sql)
      .mockResolvedValueOnce({ rows: [entryRow()] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [{ total: 1, visited: 1, future: 0 }],
      } as never);

    const data = await getAtlasCollectionData({
      filter: 'all',
      sort: 'oldest',
      page: 1,
    });

    expect(data.entries[0]).toMatchObject({
      visitedOn: '2026-04-19',
      occurredTime: '06:42',
      occurredUtcOffsetMinutes: -360,
    });
    for (const index of [0, 1]) {
      const query = queryAt(index);
      expect(query.query).toContain(
        "CASE WHEN ? = 'oldest' THEN visited_on END ASC NULLS LAST",
      );
      expect(query.query).toContain('(occurred_time IS NULL) ASC');
      expect(query.query).toContain(
        "CASE WHEN ? = 'oldest' THEN occurred_time END ASC",
      );
      expect(query.query).toContain('id ASC');
      expect(query.values).toContain('oldest');
    }
  });
});
