import { notFound } from 'next/navigation';

import { getAtlasChapter } from '@/app/lib/chapters/data';
import { ChapterReader } from '@/components/chapters/chapter-reader';

export default async function ChapterPage({
  params,
  searchParams,
}: {
  params: Promise<{ chapterId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { chapterId } = await params;
  const { saved } = await searchParams;
  const chapter = await getAtlasChapter(chapterId);
  if (!chapter) notFound();

  return (
    <ChapterReader
      chapter={chapter}
      mode="owner"
      saveNotice={
        saved === 'created' || saved === 'updated' ? saved : undefined
      }
    />
  );
}
