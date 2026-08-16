import { getAccountDisplayName } from '@/app/lib/auth/account-display';
import { requireVerifiedSession } from '@/app/lib/auth/session';
import { getAtlasData } from '@/app/lib/atlas/data';
import { AtlasWorkspace } from '@/components/atlas/atlas-workspace';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ memory?: string }>;
}) {
  const [session, initialData, query] = await Promise.all([
    requireVerifiedSession(),
    getAtlasData(),
    searchParams,
  ]);
  const displayName = getAccountDisplayName(session.user);
  const initialSelectedId = initialData.entries.some(
    (entry) => entry.id === query.memory,
  )
    ? query.memory
    : null;

  return (
    <AtlasWorkspace
      displayName={displayName}
      initialData={initialData}
      initialSelectedId={initialSelectedId}
    />
  );
}
