import { getAccountDisplayName } from '@/app/lib/auth/account-display';
import { requireVerifiedSession } from '@/app/lib/auth/session';
import { getAtlasData } from '@/app/lib/atlas/data';
import { atlasJourneyIdSchema } from '@/app/lib/atlas/journeys/validation';
import { AtlasWorkspace } from '@/components/atlas/atlas-workspace';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    memory?: string;
    view?: string;
    journey?: string;
    stop?: string;
  }>;
}) {
  const [session, initialData, query] = await Promise.all([
    requireVerifiedSession(),
    getAtlasData(),
    searchParams,
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
    />
  );
}
