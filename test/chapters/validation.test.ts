import {
  atlasChapterInputSchema,
  atlasChapterUpdateSchema,
  CHAPTER_MAX_MEMORIES,
  CHAPTER_TRANSITION_MAX_LENGTH,
} from '@/app/lib/chapters/validation';

const memoryIds = [
  '5a4ea1bb-4a42-43c4-bca4-8278f4971486',
  'f96b9b51-15ca-4fd7-98c9-d60a4ccb64ef',
];

function chapterInput(overrides: Record<string, unknown> = {}) {
  return {
    title: 'A chapter',
    introduction: '',
    memories: memoryIds.map((entryId) => ({ entryId, transitionNote: '' })),
    coverMediaId: null,
    visibility: 'private',
    shareMap: true,
    shareLocationPrecision: 'approximate',
    ...overrides,
  };
}

describe('chapter validation', () => {
  it('normalizes a valid chapter', () => {
    const parsed = atlasChapterInputSchema.parse(
      chapterInput({
        title: '  A Michigan field season  ',
        introduction: '  The long way home.  ',
        memories: [
          { entryId: memoryIds[0], transitionNote: '' },
          {
            entryId: memoryIds[1],
            transitionNote: '  Then the road opened.  ',
          },
        ],
      }),
    );

    expect(parsed).toEqual({
      title: 'A Michigan field season',
      introduction: 'The long way home.',
      memories: [
        { entryId: memoryIds[0], transitionNote: '' },
        { entryId: memoryIds[1], transitionNote: 'Then the road opened.' },
      ],
      coverMediaId: null,
      visibility: 'private',
      shareMap: true,
      shareLocationPrecision: 'approximate',
    });
  });

  it('requires at least two memories', () => {
    const parsed = atlasChapterInputSchema.safeParse(
      chapterInput({
        memories: [{ entryId: memoryIds[0], transitionNote: '' }],
      }),
    );

    expect(parsed.success).toBe(false);
  });

  it('rejects duplicate memories', () => {
    const parsed = atlasChapterInputSchema.safeParse(
      chapterInput({
        memories: [
          { entryId: memoryIds[0], transitionNote: '' },
          { entryId: memoryIds[0], transitionNote: '' },
        ],
      }),
    );

    expect(parsed.success).toBe(false);
  });

  it('caps the chapter size', () => {
    const memories = Array.from(
      { length: CHAPTER_MAX_MEMORIES + 1 },
      (_, index) => ({
        entryId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        transitionNote: '',
      }),
    );
    const parsed = atlasChapterInputSchema.safeParse(
      chapterInput({ memories }),
    );

    expect(parsed.success).toBe(false);
  });

  it('requires a positive optimistic-lock version for updates', () => {
    const parsed = atlasChapterUpdateSchema.safeParse(
      chapterInput({
        id: 'c202ab58-61c3-455d-8cee-6bd9f29a7e94',
        version: 0,
      }),
    );

    expect(parsed.success).toBe(false);
  });

  it('rejects unknown sharing states', () => {
    expect(
      atlasChapterInputSchema.safeParse(chapterInput({ visibility: 'public' }))
        .success,
    ).toBe(false);
    expect(
      atlasChapterInputSchema.safeParse(
        chapterInput({ shareLocationPrecision: 'street' }),
      ).success,
    ).toBe(false);
  });

  it('cannot retain exact sharing precision while the map is disabled', () => {
    const parsed = atlasChapterInputSchema.parse(
      chapterInput({
        visibility: 'shared',
        shareMap: false,
        shareLocationPrecision: 'exact',
      }),
    );

    expect(parsed.shareMap).toBe(false);
    expect(parsed.shareLocationPrecision).toBe('approximate');
  });

  it('caps prose between memories', () => {
    const parsed = atlasChapterInputSchema.safeParse(
      chapterInput({
        memories: [
          { entryId: memoryIds[0], transitionNote: '' },
          {
            entryId: memoryIds[1],
            transitionNote: 'x'.repeat(CHAPTER_TRANSITION_MAX_LENGTH + 1),
          },
        ],
      }),
    );

    expect(parsed.success).toBe(false);
  });
});
