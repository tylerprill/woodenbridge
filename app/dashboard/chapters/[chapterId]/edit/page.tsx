import { notFound } from 'next/navigation';

import { getAtlasChapterEditorData } from '@/app/lib/chapters/data';
import { ChapterEditor } from '@/components/chapters/chapter-editor';

export default async function EditChapterPage({
  params,
  searchParams,
}: {
  params: Promise<{ chapterId: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { chapterId } = await params;
  const { step } = await searchParams;
  const data = await getAtlasChapterEditorData(chapterId);
  if (!data.chapter) notFound();

  return (
    <ChapterEditor
      chapter={data.chapter}
      availableEntries={data.availableEntries}
      initialStep={step === 'arrange' ? 'arrange' : 'details'}
    />
  );
}
