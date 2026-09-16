import { createHash } from 'node:crypto';

jest.mock('@vercel/postgres', () => {
  const clientQuery = jest.fn();
  const release = jest.fn();
  const connect = jest.fn(async () => ({ query: clientQuery, release }));
  const taggedQuery = jest.fn();
  Object.assign(taggedQuery, { query: jest.fn() });
  return {
    db: { connect },
    sql: taggedQuery,
    __testMocks: { clientQuery, release, connect },
  };
});
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/app/lib/auth/session', () => ({
  requireVerifiedSession: jest.fn(),
}));
jest.mock('@/app/lib/atlas/journeys/data', () => ({
  loadAtlasJourneySuggestions: jest.fn(),
}));

import { revalidatePath } from 'next/cache';
import { createAtlasChapterAction } from '@/app/lib/actions/chapters';
import { requireVerifiedSession } from '@/app/lib/auth/session';
import { loadAtlasJourneySuggestions } from '@/app/lib/atlas/journeys/data';
import type { AtlasChapterInput } from '@/app/lib/chapters/definitions';

const { __testMocks } = jest.requireMock('@vercel/postgres') as {
  __testMocks: {
    clientQuery: jest.Mock;
    release: jest.Mock;
    connect: jest.Mock;
  };
};

const userId = 'bc644acd-a8f0-4344-a3fe-ac065cc6bfbd';
const clientRequestId = '5e4972f0-93b8-42aa-8ed0-2007abc847fd';
const firstEntryId = '39606bb7-f299-455d-be20-b43a73092057';
const secondEntryId = '09bbcbd0-1f2e-401e-a9e4-e755466ce07b';
const chapter = {
  id: '3f179e40-cd21-47d7-aa02-2653111556d6',
  version: 1,
  shareId: '779090dc-6bef-4c23-bfd0-27731220836d',
};

const input: AtlasChapterInput = {
  clientRequestId,
  title: 'Michigan field notes',
  introduction: 'A long weekend outside.',
  memories: [
    { entryId: firstEntryId, transitionNote: '' },
    { entryId: secondEntryId, transitionNote: 'Then we headed east.' },
  ],
  coverMediaId: null,
  visibility: 'private',
  shareMap: true,
  shareLocationPrecision: 'approximate',
};

function normalizeQuery(query: unknown) {
  return String(query).replace(/\s+/g, ' ').trim();
}

function fingerprint(value: AtlasChapterInput) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        title: value.title,
        introduction: value.introduction,
        memories: value.memories,
        coverMediaId: value.coverMediaId,
        visibility: value.visibility,
        shareMap: value.shareMap,
        shareLocationPrecision: value.shareLocationPrecision,
      }),
    )
    .digest('hex');
}

describe('Atlas Chapter creation idempotency', () => {
  beforeEach(() => {
    __testMocks.clientQuery.mockReset();
    __testMocks.release.mockReset();
    __testMocks.connect.mockClear();
    jest.mocked(revalidatePath).mockReset();
    jest.mocked(loadAtlasJourneySuggestions).mockReset();
    jest.mocked(loadAtlasJourneySuggestions).mockResolvedValue([]);
    jest.mocked(requireVerifiedSession).mockResolvedValue({
      user: { id: userId },
    } as Awaited<ReturnType<typeof requireVerifiedSession>>);
  });

  it('persists the request id and fingerprint for a new Chapter', async () => {
    __testMocks.clientQuery.mockImplementation(
      async (query: unknown, values?: unknown[]) => {
        const text = normalizeQuery(query);
        if (text.includes('client_request_fingerprint AS')) return { rows: [] };
        if (text.startsWith('SELECT id FROM atlas_entries')) {
          return { rows: [{ id: firstEntryId }, { id: secondEntryId }] };
        }
        if (text.includes('INSERT INTO atlas_chapters')) {
          expect(values?.[7]).toBe(clientRequestId);
          expect(values?.[8]).toBe(fingerprint(input));
          return { rows: [chapter] };
        }
        return { rows: [] };
      },
    );

    await expect(createAtlasChapterAction(input)).resolves.toEqual({
      ok: true,
      data: chapter,
    });
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes('INSERT INTO atlas_chapter_entries'),
      ),
    ).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard');
  });

  it('records accepted Journey suggestions in the Chapter transaction', async () => {
    const suggestionKey = 'a'.repeat(64);
    jest.mocked(loadAtlasJourneySuggestions).mockResolvedValue([
      {
        key: suggestionKey,
        algorithmVersion: 1,
        source: 'atlas_history',
        reason: 'nearby_dates_and_places',
        explanation: 'These memories are dated together.',
        suggestedTitle: 'Michigan memories',
        startDate: '2026-05-10',
        endDate: '2026-05-11',
        memoryCount: 2,
        entryIds: [secondEntryId, firstEntryId],
      },
    ]);
    __testMocks.clientQuery.mockImplementation(async (query: unknown) => {
      const text = normalizeQuery(query);
      if (text.includes('client_request_fingerprint AS')) return { rows: [] };
      if (text.startsWith('SELECT id FROM atlas_entries')) {
        return { rows: [{ id: firstEntryId }, { id: secondEntryId }] };
      }
      if (text.includes('INSERT INTO atlas_chapters')) {
        return { rows: [chapter] };
      }
      return { rows: [] };
    });

    await expect(
      createAtlasChapterAction({
        ...input,
        journeySuggestion: {
          key: suggestionKey,
          source: 'atlas_history',
        },
      }),
    ).resolves.toEqual({ ok: true, data: chapter });

    const feedbackIndex = __testMocks.clientQuery.mock.calls.findIndex(
      ([query]) =>
        normalizeQuery(query).includes(
          'INSERT INTO atlas_journey_suggestion_feedback',
        ),
    );
    const feedbackCall = __testMocks.clientQuery.mock.calls[feedbackIndex];
    expect(feedbackCall?.[1]).toEqual([
      userId,
      suggestionKey,
      1,
      'atlas_history',
      chapter.id,
    ]);
    const commitIndex = __testMocks.clientQuery.mock.calls.findIndex(
      ([query]) => normalizeQuery(query) === 'COMMIT',
    );
    expect(feedbackIndex).toBeGreaterThanOrEqual(0);
    expect(feedbackIndex).toBeLessThan(commitIndex);
    expect(loadAtlasJourneySuggestions).toHaveBeenCalledWith(userId, {
      applyFeedback: false,
    });
  });

  it('omits stale suggestion feedback without blocking Chapter creation', async () => {
    const suggestionKey = 'b'.repeat(64);
    jest.mocked(loadAtlasJourneySuggestions).mockResolvedValue([
      {
        key: suggestionKey,
        algorithmVersion: 1,
        source: 'atlas_history',
        reason: 'nearby_dates_and_places',
        explanation: 'These memories are dated together.',
        suggestedTitle: 'Michigan memories',
        startDate: '2026-05-10',
        endDate: '2026-05-11',
        memoryCount: 2,
        entryIds: [firstEntryId, '1130e0d5-32b7-4d67-9220-2befc550cc4d'],
      },
    ]);
    __testMocks.clientQuery.mockImplementation(async (query: unknown) => {
      const text = normalizeQuery(query);
      if (text.includes('client_request_fingerprint AS')) return { rows: [] };
      if (text.startsWith('SELECT id FROM atlas_entries')) {
        return { rows: [{ id: firstEntryId }, { id: secondEntryId }] };
      }
      if (text.includes('INSERT INTO atlas_chapters')) {
        return { rows: [chapter] };
      }
      return { rows: [] };
    });

    await expect(
      createAtlasChapterAction({
        ...input,
        journeySuggestion: {
          key: suggestionKey,
          source: 'atlas_history',
        },
      }),
    ).resolves.toEqual({ ok: true, data: chapter });

    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes(
          'INSERT INTO atlas_journey_suggestion_feedback',
        ),
      ),
    ).toBe(false);
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes('INSERT INTO atlas_chapter_entries'),
      ),
    ).toBe(true);
  });

  it('keeps Chapter creation available when suggestion validation fails', async () => {
    const suggestionKey = 'c'.repeat(64);
    const validationError = new Error('suggestion lookup unavailable');
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    jest.mocked(loadAtlasJourneySuggestions).mockRejectedValue(validationError);
    __testMocks.clientQuery.mockImplementation(async (query: unknown) => {
      const text = normalizeQuery(query);
      if (text.includes('client_request_fingerprint AS')) return { rows: [] };
      if (text.startsWith('SELECT id FROM atlas_entries')) {
        return { rows: [{ id: firstEntryId }, { id: secondEntryId }] };
      }
      if (text.includes('INSERT INTO atlas_chapters')) {
        return { rows: [chapter] };
      }
      return { rows: [] };
    });

    await expect(
      createAtlasChapterAction({
        ...input,
        journeySuggestion: {
          key: suggestionKey,
          source: 'atlas_history',
        },
      }),
    ).resolves.toEqual({ ok: true, data: chapter });

    expect(consoleError).toHaveBeenCalledWith(
      'Atlas journey suggestion validation failed:',
      validationError,
    );
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes(
          'INSERT INTO atlas_journey_suggestion_feedback',
        ),
      ),
    ).toBe(false);
    consoleError.mockRestore();
  });

  it('returns the original Chapter without rewriting its entries on retry', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: unknown) => {
      const text = normalizeQuery(query);
      if (text.includes('client_request_fingerprint AS')) {
        return {
          rows: [
            {
              ...chapter,
              clientRequestFingerprint: `${fingerprint(input)}   `,
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(createAtlasChapterAction(input)).resolves.toEqual({
      ok: true,
      data: chapter,
    });
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).startsWith('INSERT'),
      ),
    ).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects reuse of a request id with different normalized content', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: unknown) => {
      const text = normalizeQuery(query);
      if (text.includes('client_request_fingerprint AS')) {
        return {
          rows: [
            {
              ...chapter,
              clientRequestFingerprint: fingerprint(input),
            },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await createAtlasChapterAction({
      ...input,
      title: 'A different chapter',
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'conflict',
      message:
        'That save request was already used for a different journey. Refresh and try again.',
    });
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).startsWith('INSERT'),
      ),
    ).toBe(false);
  });

  it('keeps legacy callers valid while storing no idempotency metadata', async () => {
    __testMocks.clientQuery.mockImplementation(
      async (query: unknown, values?: unknown[]) => {
        const text = normalizeQuery(query);
        if (text.startsWith('SELECT id FROM atlas_entries')) {
          return { rows: [{ id: firstEntryId }, { id: secondEntryId }] };
        }
        if (text.includes('INSERT INTO atlas_chapters')) {
          expect(values?.slice(7)).toEqual([null, null]);
          return { rows: [chapter] };
        }
        return { rows: [] };
      },
    );

    const { clientRequestId: _requestId, ...legacyInput } = input;
    await expect(createAtlasChapterAction(legacyInput)).resolves.toEqual({
      ok: true,
      data: chapter,
    });
  });
});
