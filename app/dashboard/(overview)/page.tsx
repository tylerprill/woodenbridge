import { getAccountDisplayName } from '@/app/lib/auth/account-display';
import { requireVerifiedSession } from '@/app/lib/auth/session';
import { getAtlasData } from '@/app/lib/atlas/data';
import { atlasJourneyIdSchema } from '@/app/lib/atlas/journeys/validation';
import { getAtlasJourneyContinuation } from '@/app/lib/chapters/data';
import { atlasChapterIdSchema } from '@/app/lib/chapters/validation';
import { AtlasWorkspace } from '@/components/atlas/atlas-workspace';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    memory?: string;
    view?: string;
    journey?: string;
    stop?: string;
    new?: string;
    continueJourney?: string;
  }>;
}) {
  const query = await searchParams;
  const continuationId = atlasChapterIdSchema.safeParse(query.continueJourney);
  const [session, initialData, continuationJourney] = await Promise.all([
    requireVerifiedSession(),
    getAtlasData(),
    query.new === 'memory' && continuationId.success
      ? getAtlasJourneyContinuation(continuationId.data)
      : Promise.resolve(null),
  ]);
  const displayName = getAccountDisplayName(session.user);
  const initialMode = query.view === 'journeys' ? 'journeys' : 'places';
  const initialSelectedId =
    initialMode === 'places' &&
    initialData.entries.some((entry) => entry.id === query.memory)
      ? query.memory
      : null;
  const journeyId = atlasJourneyIdSchema.safeParse(query.journey);
  const stopId = atlasJourneyIdSchema.safeParse(query.stop);

  return (
    <AtlasWorkspace
      displayName={displayName}
      initialData={initialData}
      initialSelectedId={initialSelectedId}
      initialMode={initialMode}
      initialJourneyId={journeyId.success ? journeyId.data : null}
      initialJourneyStopId={stopId.success ? stopId.data : null}
      initialPlacementMode={
        initialMode === 'places' &&
        !initialSelectedId &&
        query.new === 'memory' &&
        (!query.continueJourney || Boolean(continuationJourney))
      }
      continuationJourney={continuationJourney}
    />
  );
}
