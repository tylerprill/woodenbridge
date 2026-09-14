import { getVerifiedSession } from '@/app/lib/auth/session';
import {
  dismissAtlasJourneySuggestion,
  loadAtlasJourneySuggestions,
} from '@/app/lib/atlas/journeys/data';
import { atlasJourneySuggestionKeySchema } from '@/app/lib/atlas/journeys/validation';

export const runtime = 'nodejs';

const PRIVATE_JSON_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
};

function isSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ suggestionKey: string }> },
) {
  const session = await getVerifiedSession();
  if (!session) {
    return Response.json(
      {
        error: 'unauthorized',
        message: 'Sign in to update journey suggestions.',
      },
      { status: 401, headers: PRIVATE_JSON_HEADERS },
    );
  }
  if (!isSameOrigin(request)) {
    return Response.json(
      { error: 'invalid', message: 'Invalid request origin.' },
      { status: 403, headers: PRIVATE_JSON_HEADERS },
    );
  }

  const { suggestionKey } = await context.params;
  const parsedKey = atlasJourneySuggestionKeySchema.safeParse(suggestionKey);
  if (!parsedKey.success) {
    return Response.json(
      { error: 'invalid', message: 'Invalid journey suggestion.' },
      { status: 400, headers: PRIVATE_JSON_HEADERS },
    );
  }

  try {
    const suggestions = await loadAtlasJourneySuggestions(session.user.id, {
      applyFeedback: false,
    });
    const suggestion = suggestions.find(
      (candidate) => candidate.key === parsedKey.data,
    );
    if (!suggestion) {
      return Response.json(
        {
          error: 'not-found',
          message: 'That journey suggestion is no longer available.',
        },
        { status: 404, headers: PRIVATE_JSON_HEADERS },
      );
    }

    await dismissAtlasJourneySuggestion(session.user.id, suggestion);
    return Response.json(
      { dismissed: true },
      { headers: PRIVATE_JSON_HEADERS },
    );
  } catch (error) {
    console.error('Atlas journey suggestion dismissal failed:', error);
    return Response.json(
      { error: 'failed', message: 'We could not dismiss that suggestion.' },
      { status: 500, headers: PRIVATE_JSON_HEADERS },
    );
  }
}
