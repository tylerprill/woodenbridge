import { getVerifiedSession } from '@/app/lib/auth/session';
import { loadAtlasJourneyDetail } from '@/app/lib/atlas/journeys/data';
import { atlasJourneyIdSchema } from '@/app/lib/atlas/journeys/validation';

export const runtime = 'nodejs';

const PRIVATE_JSON_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ chapterId: string }> },
) {
  const session = await getVerifiedSession();
  if (!session) {
    return Response.json(
      { error: 'unauthorized', message: 'Sign in to open that journey.' },
      { status: 401, headers: PRIVATE_JSON_HEADERS },
    );
  }

  const { chapterId } = await context.params;
  const parsedId = atlasJourneyIdSchema.safeParse(chapterId);
  if (!parsedId.success) {
    return Response.json(
      { error: 'invalid', message: 'Invalid journey.' },
      { status: 400, headers: PRIVATE_JSON_HEADERS },
    );
  }

  try {
    const journey = await loadAtlasJourneyDetail(
      session.user.id,
      parsedId.data,
    );
    if (!journey) {
      return Response.json(
        { error: 'not-found', message: 'That journey is not available.' },
        { status: 404, headers: PRIVATE_JSON_HEADERS },
      );
    }
    return Response.json({ journey }, { headers: PRIVATE_JSON_HEADERS });
  } catch (error) {
    console.error('Atlas journey detail failed:', error);
    return Response.json(
      { error: 'failed', message: 'We could not open that journey.' },
      { status: 500, headers: PRIVATE_JSON_HEADERS },
    );
  }
}
