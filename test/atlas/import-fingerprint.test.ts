import { createAtlasImportPayloadFingerprint } from '@/app/lib/atlas/import-fingerprint';

describe('Atlas import payload fingerprint', () => {
  it('is stable across object key order while preserving item order', () => {
    const first = {
      chapterTitle: 'Across the water',
      chapterIntroduction: '',
      items: [
        { clientItemId: 'first', title: 'Dawn' },
        { clientItemId: 'second', title: 'Dusk' },
      ],
    };
    const same = {
      items: [
        { title: 'Dawn', clientItemId: 'first' },
        { title: 'Dusk', clientItemId: 'second' },
      ],
      chapterIntroduction: '',
      chapterTitle: 'Across the water',
    };
    const reordered = {
      ...first,
      items: [...first.items].reverse(),
    };

    expect(createAtlasImportPayloadFingerprint(first)).toBe(
      createAtlasImportPayloadFingerprint(same),
    );
    expect(createAtlasImportPayloadFingerprint(first)).not.toBe(
      createAtlasImportPayloadFingerprint(reordered),
    );
  });

  it('changes when any persisted story detail changes', () => {
    const original = {
      chapterTitle: '',
      chapterIntroduction: '',
      items: [{ clientItemId: 'first', title: 'Dawn', latitude: 43.42 }],
    };
    const edited = {
      ...original,
      items: [{ ...original.items[0], title: 'Dawn over the lake' }],
    };

    expect(createAtlasImportPayloadFingerprint(original)).not.toBe(
      createAtlasImportPayloadFingerprint(edited),
    );
  });

  it('binds cover intent and date confirmation to the request identity', () => {
    const original = {
      chapterTitle: 'Across the water',
      chapterIntroduction: '',
      coverClientItemId: 'second',
      items: [{ clientItemId: 'second', dateConfirmed: true }],
    };

    expect(createAtlasImportPayloadFingerprint(original)).not.toBe(
      createAtlasImportPayloadFingerprint({
        ...original,
        coverClientItemId: 'first',
      }),
    );
    expect(createAtlasImportPayloadFingerprint(original)).not.toBe(
      createAtlasImportPayloadFingerprint({
        ...original,
        items: [{ clientItemId: 'second', dateConfirmed: false }],
      }),
    );
  });
});
