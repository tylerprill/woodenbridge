import { redirect } from 'next/navigation';

export default async function LegacyCollectionRoute({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string }>;
}) {
  const query = await searchParams;
  const params = new URLSearchParams();

  if (query.view === 'visited' || query.view === 'ahead') {
    params.set('view', query.view);
  }

  const page = Number.parseInt(query.page ?? '', 10);
  if (Number.isFinite(page) && page > 1) params.set('page', String(page));

  const suffix = params.toString();
  redirect(suffix ? `/dashboard/places?${suffix}` : '/dashboard/places');
}
