import {
  ArrowLeftIcon,
  MapPinIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';

import { getAtlasChapterEditorData } from '@/app/lib/chapters/data';
import {
  parseChapterEditorSource,
  parseChapterMemoryPrefill,
  parseChapterSuggestedTitle,
  parseChapterSuggestionPrefill,
} from '@/app/lib/chapters/prefill';
import { CHAPTER_MIN_MEMORIES } from '@/app/lib/chapters/validation';
import { ChapterEditor } from '@/components/chapters/chapter-editor';
import styles from '@/components/chapters/chapters.module.css';

export default async function NewChapterPage({
  searchParams,
}: {
  searchParams: Promise<{
    memory?: string | string[];
    source?: string | string[];
    suggestion?: string | string[];
    suggestionSource?: string | string[];
    title?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const requestedMemoryIds = parseChapterMemoryPrefill(query.memory);
  const source = parseChapterEditorSource(query.source);
  const initialTitle = parseChapterSuggestedTitle(query.title);
  const journeySuggestion = parseChapterSuggestionPrefill({
    key: query.suggestion,
    source: query.suggestionSource,
  });
  const data = await getAtlasChapterEditorData(undefined, requestedMemoryIds);
  if (data.availableEntries.length < CHAPTER_MIN_MEMORIES) {
    const remainingMemories =
      CHAPTER_MIN_MEMORIES - data.availableEntries.length;

    return (
      <div
        className={`dashboard-page ${styles.journeyPrerequisitePage}`}
        data-journey-prerequisite="true"
      >
        <Link href="/dashboard/chapters" className={styles.prerequisiteBack}>
          <ArrowLeftIcon aria-hidden="true" />
          My Journeys
        </Link>
        <section
          className={styles.journeyPrerequisite}
          aria-labelledby="journey-prerequisite-title"
        >
          <span className={styles.prerequisiteIcon} aria-hidden="true">
            <MapPinIcon />
          </span>
          <p className="section-kicker">Memories come first</p>
          <h1 id="journey-prerequisite-title">
            Your journey needs memories first.
          </h1>
          <p>
            {remainingMemories === 1
              ? 'Add one more saved memory, then return to connect both places into a journey.'
              : 'Save at least two memories, then return to arrange their places into a journey.'}
          </p>
          <div className={styles.prerequisiteActions}>
            <Link href="/dashboard/import" className={styles.primaryAction}>
              <PhotoIcon aria-hidden="true" />
              Upload photos
            </Link>
            <Link href="/dashboard" prefetch={false}>
              <MapPinIcon aria-hidden="true" />
              Open your atlas
            </Link>
          </div>
        </section>
      </div>
    );
  }
  const availableIds = new Set(data.availableEntries.map((entry) => entry.id));
  const initialMemoryIds = requestedMemoryIds.filter((entryId) =>
    availableIds.has(entryId),
  );

  return (
    <ChapterEditor
      chapter={null}
      availableEntries={data.availableEntries}
      initialMemoryIds={initialMemoryIds}
      initialTitle={initialTitle}
      journeySuggestion={journeySuggestion}
      source={source}
    />
  );
}
