import {
  parseChapterEditorSource,
  parseChapterMemoryPrefill,
  parseChapterSuggestedTitle,
  parseChapterSuggestionPrefill,
} from '@/app/lib/chapters/prefill';

describe('Chapter editor deep-link prefill', () => {
  it('keeps valid memories in request order while removing duplicates', () => {
    expect(
      parseChapterMemoryPrefill([
        '00000000-0000-4000-8000-000000000002',
        'not-a-memory-id',
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
      ]),
    ).toEqual([
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000001',
    ]);
  });

  it('caps untrusted prefill input at the Chapter limit', () => {
    const requested = Array.from(
      { length: 55 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );

    expect(parseChapterMemoryPrefill(requested)).toHaveLength(50);
  });

  it('accepts only known return sources', () => {
    expect(parseChapterEditorSource('atlas')).toBe('atlas');
    expect(parseChapterEditorSource(['import', 'atlas'])).toBe('import');
    expect(parseChapterEditorSource('https://example.test')).toBeNull();
    expect(parseChapterEditorSource(undefined)).toBeNull();
  });

  it('carries only validated Journey suggestion context', () => {
    const key = 'a'.repeat(64);
    expect(
      parseChapterSuggestionPrefill({ key, source: 'photo_import' }),
    ).toEqual({ key, source: 'photo_import' });
    expect(
      parseChapterSuggestionPrefill({
        key: 'not-a-key',
        source: 'photo_import',
      }),
    ).toBeNull();
    expect(
      parseChapterSuggestionPrefill({ key, source: 'external' }),
    ).toBeNull();
  });

  it('trims and bounds suggested titles', () => {
    expect(parseChapterSuggestedTitle('  Lake Michigan weekend  ')).toBe(
      'Lake Michigan weekend',
    );
    expect(parseChapterSuggestedTitle('x'.repeat(140))).toHaveLength(100);
  });
});
