import {
  atlasChapterInputSchema,
  atlasChapterUpdateSchema,
  CHAPTER_MAX_MEMORIES,
} from '@/app/lib/chapters/validation';

const memoryIds = [
  '5a4ea1bb-4a42-43c4-bca4-8278f4971486',
  'f96b9b51-15ca-4fd7-98c9-d60a4ccb64ef',
];

describe('chapter validation', () => {
  it('normalizes a valid chapter', () => {
    const parsed = atlasChapterInputSchema.parse({
      title: '  A Michigan field season  ',
      introduction: '  The long way home.  ',
      entryIds: memoryIds,
    });

    expect(parsed).toEqual({
      title: 'A Michigan field season',
      introduction: 'The long way home.',
      entryIds: memoryIds,
    });
  });

  it('requires at least two memories', () => {
    const parsed = atlasChapterInputSchema.safeParse({
      title: 'A chapter',
      introduction: '',
      entryIds: memoryIds.slice(0, 1),
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects duplicate memories', () => {
    const parsed = atlasChapterInputSchema.safeParse({
      title: 'A chapter',
      introduction: '',
      entryIds: [memoryIds[0], memoryIds[0]],
    });

    expect(parsed.success).toBe(false);
  });

  it('caps the chapter size', () => {
    const entryIds = Array.from({ length: CHAPTER_MAX_MEMORIES + 1 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    const parsed = atlasChapterInputSchema.safeParse({
      title: 'A chapter',
      introduction: '',
      entryIds,
    });

    expect(parsed.success).toBe(false);
  });

  it('requires a positive optimistic-lock version for updates', () => {
    const parsed = atlasChapterUpdateSchema.safeParse({
      id: 'c202ab58-61c3-455d-8cee-6bd9f29a7e94',
      version: 0,
      title: 'A chapter',
      introduction: '',
      entryIds: memoryIds,
    });

    expect(parsed.success).toBe(false);
  });
});
