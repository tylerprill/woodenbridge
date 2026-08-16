import { notFound } from 'next/navigation';

import { getAtlasChapterEditorData } from '@/app/lib/chapters/data';
import { ChapterEditor } from '@/components/chapters/chapter-editor';

export default async function EditChapterPage({
  params,
}: {
  params: Promise<{ chapterId: string }>;
}) {
  const { chapterId } = await params;
  const data = await getAtlasChapterEditorData(chapterId);
  if (!data.chapter) notFound();

  return (
    <ChapterEditor
      chapter={data.chapter}
      availableEntries={data.availableEntries}
    />
  );
}
