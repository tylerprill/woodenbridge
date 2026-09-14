import { getAtlasChapterEditorData } from '@/app/lib/chapters/data';
import {
  parseChapterEditorSource,
  parseChapterMemoryPrefill,
  parseChapterSuggestedTitle,
  parseChapterSuggestionPrefill,
} from '@/app/lib/chapters/prefill';
import { ChapterEditor } from '@/components/chapters/chapter-editor';

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
