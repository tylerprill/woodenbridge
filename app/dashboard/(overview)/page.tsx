import { getAccountDisplayName } from '@/app/lib/auth/account-display';
import { requireVerifiedSession } from '@/app/lib/auth/session';
import { getAtlasData } from '@/app/lib/atlas/data';
import { atlasJourneyIdSchema } from '@/app/lib/atlas/journeys/validation';
import { continueJourneyEditorHref } from '@/app/lib/chapters/links';
import { atlasChapterIdSchema } from '@/app/lib/chapters/validation';
import { AtlasWorkspace } from '@/components/atlas/atlas-workspace';
import { redirect } from 'next/navigation';

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
    continueSegment?: string;
    continueWithoutSegment?: string;
  }>;
}) {
  const query = await searchParams;
  const continuationId = atlasChapterIdSchema.safeParse(query.continueJourney);
  if (query.new === 'memory' && continuationId.success) {
    redirect(
      continueJourneyEditorHref(continuationId.data, {
        segmentId: query.continueSegment,
        withoutSegment: query.continueWithoutSegment === '1',
      }),
    );
  }

  const [session, initialData] = await Promise.all([
    requireVerifiedSession(),
    getAtlasData(),
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
        initialMode === 'places' && !initialSelectedId && query.new === 'memory'
      }
    />
  );
}
