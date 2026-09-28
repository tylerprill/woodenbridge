import { notFound } from 'next/navigation';

import {
  getAtlasChapterEditorData,
  getAtlasJourneyContinuation,
} from '@/app/lib/chapters/data';
import { parseChapterEditorSource } from '@/app/lib/chapters/prefill';
import { ChapterEditor } from '@/components/chapters/chapter-editor';

export default async function EditChapterPage({
  params,
  searchParams,
}: {
  params: Promise<{ chapterId: string }>;
  searchParams: Promise<{
    source?: string | string[];
    step?: string | string[];
    continueSegment?: string | string[];
    continueWithoutSegment?: string | string[];
  }>;
}) {
  const { chapterId } = await params;
  const query = await searchParams;
  const step = Array.isArray(query.step) ? query.step[0] : query.step;
  const requestedSegmentId = Array.isArray(query.continueSegment)
    ? query.continueSegment[0]
    : query.continueSegment;
  const preferUnsegmented =
    (Array.isArray(query.continueWithoutSegment)
      ? query.continueWithoutSegment[0]
      : query.continueWithoutSegment) === '1';
  const [data, continuationJourney] = await Promise.all([
    getAtlasChapterEditorData(chapterId),
    getAtlasJourneyContinuation(chapterId, {
      requestedSegmentId,
      preferUnsegmented,
    }),
  ]);
  if (!data.chapter) notFound();

  return (
    <ChapterEditor
      chapter={data.chapter}
      availableEntries={data.availableEntries}
      continuationJourney={continuationJourney}
      initialStep={
        step === 'continue' && continuationJourney
          ? 'continue'
          : step === 'arrange'
            ? 'arrange'
            : 'details'
      }
      source={parseChapterEditorSource(query.source)}
    />
  );
}
