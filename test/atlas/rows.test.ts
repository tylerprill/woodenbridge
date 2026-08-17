import { type AtlasMediaRow, toAtlasMedia } from '@/app/lib/atlas/rows';

const row: AtlasMediaRow = {
  id: 'bf69b9f1-4868-4206-abbf-df01e6a8d033',
  entry_id: 'cfe81448-0a0d-4eb5-b015-b3e9d81baaaf',
  storage_path:
    'atlas/memories/cfe81448-0a0d-4eb5-b015-b3e9d81baaaf/bf69b9f1-4868-4206-abbf-df01e6a8d033.jpg',
  thumbnail_path:
    'atlas/memories/cfe81448-0a0d-4eb5-b015-b3e9d81baaaf/bf69b9f1-4868-4206-abbf-df01e6a8d033.thumbnail.webp',
  mime_type: 'image/jpeg',
  width: 2400,
  height: 3000,
  byte_size: 2_000_000,
  alt_text: 'A remembered place',
  sort_order: 0,
  created_at: '2026-08-16T00:00:00.000Z',
};

describe('toAtlasMedia', () => {
  it('uses the authenticated thumbnail variant when a derivative exists', () => {
    const media = toAtlasMedia(row);

    expect(media.deliveryUrl).toBe(`/api/atlas/media/${row.id}`);
    expect(media.thumbnailUrl).toBe(
      `/api/atlas/media/${row.id}?variant=thumbnail`,
    );
  });

  it('falls back to original delivery for media awaiting backfill', () => {
    const media = toAtlasMedia({ ...row, thumbnail_path: null });

    expect(media.thumbnailUrl).toBe(media.deliveryUrl);
  });
});
