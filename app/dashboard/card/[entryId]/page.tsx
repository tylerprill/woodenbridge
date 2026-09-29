import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { getSavedAtlasEntry } from '@/app/lib/atlas/data';
import { KeepsakeCard } from '@/components/atlas/keepsake-card';
import { MemoryActions } from '@/components/atlas/memory-actions';
import { PrintCardButton } from '@/components/atlas/print-card-button';

const getKeepsake = cache((entryId: string) => getSavedAtlasEntry(entryId));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ entryId: string }>;
}): Promise<Metadata> {
  const { entryId } = await params;
  const entry = await getKeepsake(entryId);

  return {
    title: entry
      ? `${entry.title || 'Untitled memory'} keepsake — Field Atlas`
      : 'Keepsake — Field Atlas',
    description: entry
      ? `A private Field Atlas keepsake from ${entry.placeLabel || entry.placeName || 'a remembered place'}.`
      : 'A private Field Atlas keepsake.',
  };
}

export default async function KeepsakePage({
  params,
}: {
  params: Promise<{ entryId: string }>;
}) {
  const { entryId } = await params;
  const entry = await getKeepsake(entryId);

  if (!entry) notFound();

  return (
    <div className="dashboard-page keepsake-page">
      <header className="keepsake-page-heading">
        <div className="keepsake-page-intro">
          <Link className="keepsake-page-back" href="/dashboard/places">
            <ArrowLeftIcon aria-hidden="true" />
            Back to memories
          </Link>
          <p className="section-kicker">A field keepsake</p>
          <h1>Keep the feeling close.</h1>
          <p>
            A quiet card for the place, date, and detail you chose to remember.
          </p>
        </div>
        <div className="keepsake-page-actions">
          <MemoryActions
            entryId={entry.id}
            title={entry.title}
            variant="detail"
          />
          <PrintCardButton />
        </div>
      </header>

      <KeepsakeCard entry={entry} variant="feature" />
    </div>
  );
}
