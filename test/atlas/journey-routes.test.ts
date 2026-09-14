import { GET as getJourneyIndex } from '@/app/api/atlas/journeys/route';
import { GET as getJourneyDetail } from '@/app/api/atlas/journeys/[chapterId]/route';
import { POST as dismissSuggestion } from '@/app/api/atlas/journeys/suggestions/[suggestionKey]/dismiss/route';
import { getVerifiedSession } from '@/app/lib/auth/session';
import {
  dismissAtlasJourneySuggestion,
  loadAtlasJourneyDetail,
  loadAtlasJourneyIndex,
  loadAtlasJourneySuggestions,
} from '@/app/lib/atlas/journeys/data';

jest.mock('@/app/lib/auth/session', () => ({
  getVerifiedSession: jest.fn(),
}));
jest.mock('@/app/lib/atlas/journeys/data', () => ({
  dismissAtlasJourneySuggestion: jest.fn(),
  loadAtlasJourneyDetail: jest.fn(),
  loadAtlasJourneyIndex: jest.fn(),
  loadAtlasJourneySuggestions: jest.fn(),
}));

const userId = '8dc3a7ee-4b30-4f87-9dd5-3e796f27c449';
const chapterId = '4d493754-8998-4b2d-b415-d4fab07620f5';
const suggestionKey = 'a'.repeat(64);
const suggestion = {
  key: suggestionKey,
  algorithmVersion: 1,
  source: 'atlas_history' as const,
  reason: 'nearby_dates_and_places' as const,
  explanation: 'These memories may belong together.',
  suggestedTitle: 'Ann Arbor memories',
  startDate: '2026-05-10',
  endDate: '2026-05-11',
  memoryCount: 2,
  entryIds: ['entry-a', 'entry-b'],
};

describe('Atlas journey API routes', () => {
  beforeEach(() => {
    jest.mocked(getVerifiedSession).mockResolvedValue({
      user: { id: userId },
    } as never);
    jest.mocked(loadAtlasJourneyIndex).mockResolvedValue({
      journeys: [],
      suggestions: [],
    });
    jest.mocked(loadAtlasJourneyDetail).mockResolvedValue(null);
    jest.mocked(loadAtlasJourneySuggestions).mockResolvedValue([suggestion]);
    jest.mocked(dismissAtlasJourneySuggestion).mockResolvedValue(undefined);
  });

  it('requires a verified owner session before loading coordinates', async () => {
    jest.mocked(getVerifiedSession).mockResolvedValue(null);

    const response = await getJourneyIndex(
      new Request('https://fieldatlas.test/api/atlas/journeys'),
    );

    expect(response.status).toBe(401);
    expect(loadAtlasJourneyIndex).not.toHaveBeenCalled();
  });

  it('validates and normalizes list options', async () => {
    const response = await getJourneyIndex(
      new Request(
        `https://fieldatlas.test/api/atlas/journeys?search=%20Kyoto%20&selected=${chapterId}&limit=18&suggestions=1`,
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(loadAtlasJourneyIndex).toHaveBeenCalledWith(userId, {
      search: 'Kyoto',
      selectedJourneyId: chapterId,
      limit: 18,
      includeSuggestions: true,
    });
  });

  it('rejects malformed selected ids and limits', async () => {
    const invalidId = await getJourneyIndex(
      new Request(
        'https://fieldatlas.test/api/atlas/journeys?selected=not-a-uuid',
      ),
    );
    const invalidLimit = await getJourneyIndex(
      new Request('https://fieldatlas.test/api/atlas/journeys?limit=5.5'),
    );

    expect(invalidId.status).toBe(400);
    expect(invalidLimit.status).toBe(400);
    expect(loadAtlasJourneyIndex).not.toHaveBeenCalled();
  });

  it('returns one owner-scoped journey detail without revealing misses', async () => {
    const missing = await getJourneyDetail(
      new Request(`https://fieldatlas.test/api/atlas/journeys/${chapterId}`),
      { params: Promise.resolve({ chapterId }) },
    );

    expect(missing.status).toBe(404);
    expect(loadAtlasJourneyDetail).toHaveBeenCalledWith(userId, chapterId);
  });

  it('requires same-origin POSTs for suggestion feedback', async () => {
    const response = await dismissSuggestion(
      new Request(
        `https://fieldatlas.test/api/atlas/journeys/suggestions/${suggestionKey}/dismiss`,
        {
          method: 'POST',
          headers: { Origin: 'https://attacker.test' },
        },
      ),
      { params: Promise.resolve({ suggestionKey }) },
    );

    expect(response.status).toBe(403);
    expect(loadAtlasJourneySuggestions).not.toHaveBeenCalled();
    expect(dismissAtlasJourneySuggestion).not.toHaveBeenCalled();
  });

  it('revalidates a suggestion before persisting its dismissal', async () => {
    const response = await dismissSuggestion(
      new Request(
        `https://fieldatlas.test/api/atlas/journeys/suggestions/${suggestionKey}/dismiss`,
        {
          method: 'POST',
          headers: { Origin: 'https://fieldatlas.test' },
        },
      ),
      { params: Promise.resolve({ suggestionKey }) },
    );

    expect(response.status).toBe(200);
    expect(loadAtlasJourneySuggestions).toHaveBeenCalledWith(userId, {
      applyFeedback: false,
    });
    expect(dismissAtlasJourneySuggestion).toHaveBeenCalledWith(
      userId,
      suggestion,
    );
  });
});
