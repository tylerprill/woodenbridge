import { notFound } from 'next/navigation';

import { getAtlasChapterEditorData } from '@/app/lib/chapters/data';
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
  }>;
}) {
  const { chapterId } = await params;
  const query = await searchParams;
  const data = await getAtlasChapterEditorData(chapterId);
  if (!data.chapter) notFound();

  return (
    <ChapterEditor
      chapter={data.chapter}
      availableEntries={data.availableEntries}
      initialStep={query.step === 'arrange' ? 'arrange' : 'details'}
      source={parseChapterEditorSource(query.source)}
    />
  );
}
