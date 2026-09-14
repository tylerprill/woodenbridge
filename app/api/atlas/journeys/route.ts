import { getVerifiedSession } from '@/app/lib/auth/session';
import { loadAtlasJourneyIndex } from '@/app/lib/atlas/journeys/data';
import { atlasJourneyListOptionsSchema } from '@/app/lib/atlas/journeys/validation';

export const runtime = 'nodejs';

const PRIVATE_JSON_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
};

export async function GET(request: Request) {
  const session = await getVerifiedSession();
  if (!session) {
    return Response.json(
      { error: 'unauthorized', message: 'Sign in to open your journeys.' },
      { status: 401, headers: PRIVATE_JSON_HEADERS },
    );
  }

  const searchParams = new URL(request.url).searchParams;
  const rawLimit = searchParams.get('limit');
  const rawSuggestions = searchParams.get('suggestions');
  if (
    (rawLimit !== null && !/^\d+$/.test(rawLimit)) ||
    (rawSuggestions !== null && !['0', '1'].includes(rawSuggestions))
  ) {
    return Response.json(
      { error: 'invalid', message: 'Invalid journey query.' },
      { status: 400, headers: PRIVATE_JSON_HEADERS },
    );
  }

  const parsed = atlasJourneyListOptionsSchema.safeParse({
    search: searchParams.get('search') ?? undefined,
    selectedJourneyId: searchParams.get('selected'),
    limit: rawLimit === null ? undefined : Number(rawLimit),
    includeSuggestions: rawSuggestions === '1',
  });
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid', message: 'Invalid journey query.' },
      { status: 400, headers: PRIVATE_JSON_HEADERS },
    );
  }

  try {
    const index = await loadAtlasJourneyIndex(session.user.id, parsed.data);
    return Response.json(index, { headers: PRIVATE_JSON_HEADERS });
  } catch (error) {
    console.error('Atlas journey index failed:', error);
    return Response.json(
      { error: 'failed', message: 'We could not open your journeys.' },
      { status: 500, headers: PRIVATE_JSON_HEADERS },
    );
  }
}
