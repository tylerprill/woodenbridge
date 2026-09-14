import { atlasEntryIdSchema } from '@/app/lib/atlas/validation';
import {
  ATLAS_JOURNEY_SUGGESTION_SOURCES,
  type AtlasJourneySuggestionSource,
} from '@/app/lib/atlas/journeys/definitions';
import { atlasJourneySuggestionKeySchema } from '@/app/lib/atlas/journeys/validation';
import { CHAPTER_MAX_MEMORIES, CHAPTER_TITLE_MAX_LENGTH } from './validation';

export const CHAPTER_EDITOR_SOURCES = ['atlas', 'import'] as const;
export type ChapterEditorSource = (typeof CHAPTER_EDITOR_SOURCES)[number];
export type ChapterSuggestionPrefill = {
  key: string;
  source: AtlasJourneySuggestionSource;
};

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseChapterEditorSource(
  value: string | string[] | undefined,
): ChapterEditorSource | null {
  const source = firstQueryValue(value);
  return source === 'atlas' || source === 'import' ? source : null;
}

export function parseChapterMemoryPrefill(
  value: string | string[] | undefined,
) {
  const requested =
    value === undefined ? [] : Array.isArray(value) ? value : [value];
  const memoryIds: string[] = [];
  const seen = new Set<string>();

  for (const candidate of requested) {
    const parsed = atlasEntryIdSchema.safeParse(candidate);
    if (!parsed.success || seen.has(parsed.data)) continue;
    seen.add(parsed.data);
    memoryIds.push(parsed.data);
    if (memoryIds.length === CHAPTER_MAX_MEMORIES) break;
  }

  return memoryIds;
}

export function parseChapterSuggestedTitle(
  value: string | string[] | undefined,
) {
  const title = firstQueryValue(value)?.trim() ?? '';
  return title.slice(0, CHAPTER_TITLE_MAX_LENGTH);
}

export function parseChapterSuggestionPrefill({
  key,
  source,
}: {
  key: string | string[] | undefined;
  source: string | string[] | undefined;
}): ChapterSuggestionPrefill | null {
  const parsedKey = atlasJourneySuggestionKeySchema.safeParse(
    firstQueryValue(key),
  );
  const candidateSource = firstQueryValue(source);
  if (
    !parsedKey.success ||
    !ATLAS_JOURNEY_SUGGESTION_SOURCES.includes(
      candidateSource as AtlasJourneySuggestionSource,
    )
  ) {
    return null;
  }
  return {
    key: parsedKey.data,
    source: candidateSource as AtlasJourneySuggestionSource,
  };
}
